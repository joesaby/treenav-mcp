/**
 * Shared MCP tool & resource registration
 *
 * Extracted from server.ts so both stdio and HTTP transports share
 * identical tool implementations — and integration tests can wire up
 * a McpServer + InMemoryTransport without any real I/O.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocumentStore } from "./store";
import type { GrepOutcome, FacetCounts } from "./types";
import type { RefreshSummary } from "./refresh";
import { formatSearchResults } from "./search-formatter.js";
import { compileContext } from "./compile-context.js";

/** Optional capabilities injected by the hosting entrypoint. */
export interface RegisterToolsOptions {
  /**
   * Re-scan the configured roots and reload the store. When provided, the
   * `refresh_index` tool is registered. Library embedders that manage
   * their own indexing can omit it.
   */
  refresh?: () => Promise<RefreshSummary>;
}

/** Compact facet-count rendering for list_documents output. */
function formatFacetCounts(counts: FacetCounts, maxValuesPerKey = 8): string {
  const keys = Object.keys(counts);
  if (keys.length === 0) return "";
  const lines = keys.sort().map((key) => {
    const entries = Object.entries(counts[key]).sort((a, b) => b[1] - a[1]);
    const shown = entries
      .slice(0, maxValuesPerKey)
      .map(([val, n]) => `${val} (${n})`)
      .join(", ");
    const more = entries.length > maxValuesPerKey ? `, +${entries.length - maxValuesPerKey} more` : "";
    return `  ${key}: ${shown}${more}`;
  });
  return `\n\nFacets in this result set (use as \`filters\` in search_documents/list_documents):\n${lines.join("\n")}`;
}

/**
 * Render a grep_documents outcome as agent-friendly text:
 *   path:line  [doc_id → node_id]  node title
 *     <context_before>
 *   > <line>
 *     <context_after>
 */
export function formatGrepResult(outcome: GrepOutcome, pattern: string): string {
  if (outcome.hits.length === 0) {
    const suffix = outcome.aborted
      ? " (scan aborted by time budget — narrow the pattern or use filters)"
      : "";
    return `No matches for "${pattern}" across ${outcome.docs_scanned} document(s)${suffix}.\n\nIf this was a literal search, try search_documents("${pattern}") — stemming or glossary expansion may rescue terms that don't match literally.`;
  }

  const blocks = outcome.hits.map((h) => {
    const header = `${h.file_path}:${h.line_no}  [${h.doc_id} → ${h.node_id}]  ${h.node_title}`;
    const before = h.context_before
      .map((l, i) => `  ${h.line_no - h.context_before.length + i} | ${l}`)
      .join("\n");
    const match = `> ${h.line_no} | ${h.line}`;
    const after = h.context_after
      .map((l, i) => `  ${h.line_no + 1 + i} | ${l}`)
      .join("\n");
    return [header, before, match, after].filter(Boolean).join("\n");
  });

  const notes: string[] = [];
  if (outcome.truncated) notes.push("result limit hit — raise `limit` or narrow `path_glob`/`filters`");
  if (outcome.aborted) notes.push("scan aborted by time budget — simplify the pattern");

  const summary = `Found ${outcome.hits.length} match(es) for "${pattern}" across ${outcome.docs_scanned} doc(s) / ${outcome.nodes_scanned} section(s)${notes.length ? ` — ${notes.join("; ")}` : ""}.`;

  return `${summary}\n\n${blocks.join("\n\n")}\n\nEach hit carries a node_id — call get_node_content(doc_id, [node_id]) to read the full section (include_descendants=true for its subsections too).`;
}

/**
 * Register all treenav tools and resources on the given MCP server.
 *
 * Read tools:
 *   1. compile_context  — Composed retrieval (search + outlines in one call);
 *                         the recommended starting point
 *   2. search_documents — Keyword search across all docs
 *   3. grep_documents   — Literal/regex match (the `grep -n` of the index)
 *   4. get_tree         — Hierarchical outline of a document
 *   5. get_node_content — Retrieve text from specific tree nodes
 *                         (include_descendants=true for whole subtrees)
 *   6. lookup_row       — O(1) key→row lookup for structured (CSV/JSONL) data
 *   7. find_symbol      — Code-aware symbol search
 *   8. list_documents   — Browse the catalog + discover available facets
 *   9. refresh_index    — Re-scan roots, reload on change (when enabled)
 *   —. navigate_tree    — DEPRECATED alias of
 *                         get_node_content(include_descendants=true)
 *
 * Resources:
 *   - index-stats (md-tree://stats) — JSON index statistics
 */
export function registerTools(
  server: McpServer,
  store: DocumentStore,
  options: RegisterToolsOptions = {}
): void {
  // ── Tool 1: list_documents ─────────────────────────────────────────

  server.tool(
    "list_documents",
    "List indexed documents and discover the available filter facets. Filter by tag, keyword, collection, or facet values. Returns document metadata (no content) plus facet counts for the result set — call this first when you need to know which facets/values exist before filtering search_documents.",
    {
      query: z
        .string()
        .optional()
        .describe("Filter documents by keyword in title, description, or path"),
      tag: z
        .string()
        .optional()
        .describe("Filter documents by frontmatter tag"),
      collection: z
        .string()
        .optional()
        .describe("Limit to one collection (e.g. 'docs', 'code', or a DOCS_ROOTS collection name)"),
      filters: z
        .record(z.union([z.string(), z.array(z.string())]))
        .optional()
        .describe('Facet filters, same shape as search_documents. Example: { "type": "runbook" }'),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(30)
        .describe("Max results to return"),
      offset: z
        .number()
        .min(0)
        .default(0)
        .describe("Pagination offset"),
    },
    async ({ query, tag, collection, filters, limit, offset }) => {
      const result = store.listDocuments({ query, tag, collection, filters, limit, offset });

      const summary = result.documents
        .map(
          (d) =>
            `• [${d.doc_id}] ${d.title} (${d.heading_count} sections, ${d.word_count} words)\n  path: ${d.file_path}${d.tags.length ? `\n  tags: ${d.tags.join(", ")}` : ""}${d.references?.length ? `\n  links to: ${d.references.slice(0, 5).join(", ")}${d.references.length > 5 ? ` (+${d.references.length - 5} more)` : ""}` : ""}`
        )
        .join("\n\n");

      const facetBlock = formatFacetCounts(result.facet_counts);

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${result.total} documents (showing ${Math.min(offset + 1, result.total)}-${Math.min(offset + limit, result.total)}):\n\n${summary}${facetBlock}\n\nUse get_tree with a doc_id to explore a document's section hierarchy.`,
          },
        ],
      };
    }
  );

  // ── Tool 2: search_documents ───────────────────────────────────────

  server.tool(
    "search_documents",
    "Search across all indexed documents by keyword. Matches against section titles and content. Returns ranked results with snippets. Use filters to narrow by frontmatter facets (e.g., type, category, tags). Query terms are automatically expanded using the glossary if one is configured.",
    {
      query: z
        .string()
        .describe("Search query — use specific terms for best results"),
      doc_id: z
        .string()
        .optional()
        .describe("Limit search to a specific document"),
      collection: z
        .string()
        .optional()
        .describe("Limit search to one collection (e.g. 'docs', 'code', or a DOCS_ROOTS collection name — see list_documents facet counts)"),
      filters: z
        .record(z.union([z.string(), z.array(z.string())]))
        .optional()
        .describe(
          'Facet filters to narrow results. Keys are frontmatter fields (e.g., "type", "tags", "category"). Values can be a string or array of strings. Example: { "type": "runbook", "tags": ["auth", "jwt"] }'
        ),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(15)
        .describe("Max results"),
    },
    async ({ query, doc_id, collection, filters, limit }) => {
      const results = store.searchDocuments(query, { limit, doc_id, collection, filters });
      const text = formatSearchResults(results, store, query);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ── Tool 2b: grep_documents ────────────────────────────────────────

  server.tool(
    "grep_documents",
    "Literal or regex match across indexed document content — the grep-style counterpart to search_documents. Use this when you already know the EXACT string, symbol, error code, CLI flag, or config key you are looking for and don't want BM25 ranking, stemming, or glossary expansion in the way. Returns file path, line number, node_id, and matching lines with context. Fall back to search_documents for conceptual queries (e.g. 'how do we rotate tokens') where wording varies.",
    {
      pattern: z
        .string()
        .min(1)
        .describe("Literal string by default; set regex=true to treat as a RegExp source"),
      regex: z
        .boolean()
        .default(false)
        .describe("If true, treat pattern as a regex. Nested quantifiers and lookarounds are rejected to prevent ReDoS."),
      case_insensitive: z.boolean().default(false),
      doc_id: z.string().optional().describe("Limit scan to one document"),
      path_glob: z
        .string()
        .optional()
        .describe("Glob over the file_path, e.g. '**/runbooks/**' or 'auth/*.md'"),
      filters: z
        .record(z.union([z.string(), z.array(z.string())]))
        .optional()
        .describe('Same facet filters as search_documents, e.g. { "type": "runbook" }'),
      context: z
        .number()
        .min(0)
        .max(5)
        .default(1)
        .describe("Lines of context on each side of a match"),
      limit: z.number().min(1).max(200).default(50),
    },
    async ({ pattern, regex, case_insensitive, doc_id, path_glob, filters, context, limit }) => {
      try {
        const outcome = store.grepDocuments({
          pattern,
          regex,
          case_insensitive,
          doc_id,
          path_glob,
          filters,
          context,
          limit,
        });
        return {
          content: [{ type: "text" as const, text: formatGrepResult(outcome, pattern) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `grep_documents error: ${err.message}` }],
        };
      }
    }
  );

  // ── Tool 3: get_tree ───────────────────────────────────────────────

  server.tool(
    "get_tree",
    "Get the hierarchical section tree of a document. Returns an indented outline showing all headings, their node IDs, and word counts. This is the document's 'table of contents' — examine it to identify which sections contain the information you need, then use get_node_content to retrieve specific sections.",
    {
      doc_id: z
        .string()
        .describe("Document ID (from list_documents or search_documents)"),
    },
    async ({ doc_id }) => {
      const tree = store.getTree(doc_id);

      if (!tree) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Document "${doc_id}" not found. Use list_documents to see available documents.`,
            },
          ],
        };
      }

      // Format as indented tree for the agent to reason over
      const outline = tree.nodes
        .map((n) => {
          const indent = "  ".repeat(n.level - 1);
          return `${indent}[${n.node_id}] ${"#".repeat(n.level)} ${n.title} (${n.word_count} words)\n${indent}  ${n.summary ? `Summary: ${n.summary.slice(0, 120)}…` : ""}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Document: ${tree.title}\nDoc ID: ${tree.doc_id}\nSections: ${tree.nodes.length}\n\n${outline}\n\nTo read a section's full content, call get_node_content("${doc_id}", ["node_id"]).\nTo get a section and all its subsections, add include_descendants=true.`,
          },
        ],
      };
    }
  );

  // ── Tool 4: get_node_content ───────────────────────────────────────

  server.tool(
    "get_node_content",
    "Retrieve the full text content of one or more specific sections. Pass the node IDs obtained from get_tree or search_documents. Set include_descendants=true to also get every subsection under each node (the whole subtree) in one call.",
    {
      doc_id: z.string().describe("Document ID"),
      node_ids: z
        .array(z.string())
        .min(1)
        .max(10)
        .describe(
          "Array of node IDs to retrieve content for (from get_tree output)"
        ),
      include_descendants: z
        .boolean()
        .default(false)
        .describe(
          "If true, each node is returned together with all of its descendant sections"
        ),
    },
    async ({ doc_id, node_ids, include_descendants }) => {
      if (!store.hasDocument(doc_id)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Document "${doc_id}" not found.`,
            },
          ],
        };
      }

      // Resolve requested nodes, expanding to subtrees when asked.
      // Dedupe across overlapping subtrees while preserving order.
      const seen = new Set<string>();
      const nodes: NonNullable<ReturnType<typeof store.getNodeContent>>["nodes"] = [];
      for (const node_id of node_ids) {
        const batch = include_descendants
          ? store.getSubtree(doc_id, node_id)?.nodes ?? []
          : store.getNodeContent(doc_id, [node_id])?.nodes ?? [];
        for (const n of batch) {
          if (seen.has(n.node_id)) continue;
          seen.add(n.node_id);
          nodes.push(n);
        }
      }

      if (nodes.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No matching nodes found for IDs: ${node_ids.join(", ")}. Use get_tree("${doc_id}") to see available node IDs.`,
            },
          ],
        };
      }

      const formatted = nodes
        .map(
          (n) =>
            `━━━ ${n.title} [${n.node_id}] (H${n.level}) ━━━\n\n${n.content || "(empty section)"}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: formatted,
          },
        ],
      };
    }
  );

  // ── Tool 5: navigate_tree ──────────────────────────────────────────

  server.tool(
    "navigate_tree",
    "DEPRECATED — use get_node_content with include_descendants=true instead; this alias will be removed in a future major release. Gets a tree node and ALL its descendant sections with full content.",
    {
      doc_id: z.string().describe("Document ID"),
      node_id: z
        .string()
        .describe("Root node ID — will return this node and all children"),
    },
    async ({ doc_id, node_id }) => {
      const result = store.getSubtree(doc_id, node_id);

      if (!result) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Document "${doc_id}" not found or node "${node_id}" doesn't exist.`,
            },
          ],
        };
      }

      const formatted = result.nodes
        .map((n) => {
          const indent = "  ".repeat(Math.max(0, n.level - result.nodes[0].level));
          return `${indent}${"#".repeat(n.level)} ${n.title} [${n.node_id}]\n${indent}${n.content || "(empty)"}`;
        })
        .join("\n\n");

      const totalWords = result.nodes.reduce((s, n) => s + n.word_count, 0);

      return {
        content: [
          {
            type: "text" as const,
            text: `Subtree: ${result.nodes[0].title} (${result.nodes.length} sections, ${totalWords} words)\n\n${formatted}`,
          },
        ],
      };
    }
  );

  // ── Tool 7: lookup_row ─────────────────────────────────────────────

  server.tool(
    "lookup_row",
    "Look up a structured data row by exact key (e.g. PROJ-44, ITEM-1234). Returns the canonical record from CSV/JSONL data. Use this when you have a known identifier — it's O(1) and deterministic, unlike search_documents which returns ranked results.",
    {
      key: z.string().describe("Exact row key to look up (case-insensitive)"),
      doc_id: z
        .string()
        .optional()
        .describe("Narrow lookup to a specific dataset document"),
    },
    async ({ key, doc_id }) => {
      const result = store.lookupRow(key, doc_id);

      if (!result) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No row found for key "${key}".${doc_id ? ` (searched in ${doc_id})` : ""} Try search_documents("${key}") for a broader search.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `━━━ ${result.node.title} [${result.node.node_id}] ━━━\nSource: ${result.doc_id}\n\n${result.node.content}\n\nUse search_documents("${key}") to find related documents across all collections.`,
          },
        ],
      };
    }
  );

  // ── Tool 8: find_symbol ────────────────────────────────────────────

  server.tool(
    "find_symbol",
    "Search for code symbols (classes, functions, interfaces, types, methods) across indexed source files. Filters by symbol kind and language. Returns matching symbols with their signatures and file locations. Requires CODE_ROOT to be configured.",
    {
      query: z
        .string()
        .describe("Symbol name or keyword to search for"),
      kind: z
        .enum(["class", "interface", "function", "method", "type", "enum", "variable"])
        .optional()
        .describe("Filter by symbol kind"),
      language: z
        .string()
        .optional()
        .describe("Filter by programming language (e.g., 'typescript', 'python', 'go')"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(15)
        .describe("Max results"),
    },
    async ({ query, kind, language, limit }) => {
      // Build facet filters for code-specific search
      const filters: Record<string, string | string[]> = {
        content_type: "code",
      };
      if (kind) filters["symbol_kind"] = kind;
      if (language) filters["language"] = language;

      const results = store.searchDocuments(query, { limit, filters });

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No symbols found for "${query}"${kind ? ` (kind: ${kind})` : ""}${language ? ` (language: ${language})` : ""}. Make sure CODE_ROOT is configured and code files are indexed.`,
            },
          ],
        };
      }

      const formatted = results
        .map(
          (r, i) =>
            // RRF-fused scores live in ~[0, 0.05]; render 4 decimals so the
            // ordering hint survives the new score scale.
            `${i + 1}. ${r.node_title} [${r.node_id}]\n   File: ${r.file_path}\n   Score: ${r.score.toFixed(4)}\n   Signature: ${r.snippet}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Symbol search for "${query}" (${results.length} matches):\n\n${formatted}\n\nUse get_tree(doc_id) to see the full file structure, or get_node_content(doc_id, [node_id]) to read a symbol's source code.`,
          },
        ],
      };
    }
  );

  // ── Tool 9: compile_context ────────────────────────────────────────

  server.tool(
    "compile_context",
    "START HERE for retrieval. Composed one-call search: runs a search/grep/lookup/symbol pass against the requested sources (docs, code, rows), returns ranked hits partitioned by source, plus outline trees for the top hits. Collapses the typical search → get_tree → get_node_content loop; use the individual tools afterwards to drill into specific sections. For unknown query shape, keep mode='auto' and treenav routes the call. Provenance brackets [doc_id → node_id] on every hit; budget is enforced and reported.",
    {
      intent: z.string().min(1).describe("The query — natural language, literal, regex, structured key, or symbol name."),
      mode: z
        .enum(["auto", "search", "grep", "lookup", "symbol"])
        .default("auto")
        .describe("Routing mode. 'auto' picks search/grep/lookup/symbol from the intent shape. Use an explicit mode to override."),
      sources: z
        .array(z.enum(["docs", "code", "rows", "all"]))
        .default(["all"])
        .describe("Which corpora to search. ['all'] expands to docs+code+rows."),
      filters: z
        .record(z.union([z.string(), z.array(z.string())]))
        .optional()
        .describe('Facet filters, same shape as search_documents. Example: { "type": "runbook" }'),
      output: z
        .object({
          top_k_per_source: z.number().min(1).max(10).default(3),
          include_snippets: z.boolean().default(true),
          include_outlines_for_top: z.number().min(0).max(5).default(2),
          include_full_content_for_top: z.number().min(0).max(5).default(0),
          max_tokens: z.number().min(100).max(8000).default(2000),
        })
        .default({}),
    },
    async ({ intent, mode, sources, filters, output }) => {
      const { text } = compileContext(store, {
        intent,
        mode,
        sources,
        filters,
        output,
      });
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ── Tool 10: refresh_index (only when the host provides a refresher) ─

  if (options.refresh) {
    const refresh = options.refresh;
    server.tool(
      "refresh_index",
      "Re-scan the configured docs/code roots and reload the index if anything changed on disk. Use this after files have been created, edited, or deleted so search results reflect the current state. Cheap when nothing changed (content-hash comparison). Returns counts of added/changed/removed documents.",
      {},
      async () => {
        try {
          const s = await refresh();
          const text = s.reloaded
            ? `Index refreshed in ${s.duration_ms}ms: ${s.added} added, ${s.changed} changed, ${s.removed} removed, ${s.unchanged} unchanged (${s.total} documents total).`
            : `Index already up to date (${s.total} documents, checked in ${s.duration_ms}ms).`;
          return { content: [{ type: "text" as const, text }] };
        } catch (err: any) {
          return {
            content: [{ type: "text" as const, text: `refresh_index error: ${err.message}` }],
          };
        }
      }
    );
  }

  // ── Resources: expose index stats ──────────────────────────────────

  server.resource("index-stats", "md-tree://stats", async (uri) => {
    const stats = store.getStats();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  });
}
