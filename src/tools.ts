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
import type { GrepOutcome } from "./types";
import { formatSearchResults } from "./search-formatter.js";
import {
  CuratorError,
  draftWikiEntry,
  findSimilar,
  writeWikiEntry,
  type WikiOptions,
} from "./curator.js";

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

  return `${summary}\n\n${blocks.join("\n\n")}\n\nEach hit carries a node_id — call get_node_content(doc_id, [node_id]) or navigate_tree(doc_id, node_id) to read the full section.`;
}

/**
 * Register all treenav-mcp tools and resources on the given MCP server.
 *
 * Read tools (always registered):
 *   1. list_documents   — Browse the document catalog
 *   2. search_documents — Keyword search across all docs
 *   3. grep_documents   — Literal/regex match (the `grep -n` of the index)
 *   4. get_tree         — Hierarchical outline of a document
 *   5. get_node_content — Retrieve text from specific tree nodes
 *   6. navigate_tree    — Get a subtree (node + all descendants)
 *   7. lookup_row       — O(1) key→row lookup for structured (CSV/JSONL) data
 *   8. find_symbol      — Code-aware symbol search
 *
 * Curation tools (only when options.wiki is provided, i.e. WIKI_WRITE=1):
 *   9.  find_similar     — BM25 dedupe check for prospective content
 *   10. draft_wiki_entry — Structural scaffold for a new entry (no write)
 *   11. write_wiki_entry — Validated write + incremental re-index
 *
 * Resources:
 *   - index-stats (md-tree://stats) — JSON index statistics
 */
export function registerTools(
  server: McpServer,
  store: DocumentStore,
  options?: { wiki?: WikiOptions }
): void {
  // ── Tool 1: list_documents ─────────────────────────────────────────

  server.tool(
    "list_documents",
    "List all indexed markdown documents. Filter by tag or keyword in title/path. Returns document metadata without content — use get_tree to explore a specific document's structure.",
    {
      query: z
        .string()
        .optional()
        .describe("Filter documents by keyword in title, description, or path"),
      tag: z
        .string()
        .optional()
        .describe("Filter documents by frontmatter tag"),
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
    async ({ query, tag, limit, offset }) => {
      const result = store.listDocuments({ query, tag, limit, offset });

      const summary = result.documents
        .map(
          (d) =>
            `• [${d.doc_id}] ${d.title} (${d.heading_count} sections, ${d.word_count} words)\n  path: ${d.file_path}${d.tags.length ? `\n  tags: ${d.tags.join(", ")}` : ""}${d.references?.length ? `\n  links to: ${d.references.slice(0, 5).join(", ")}${d.references.length > 5 ? ` (+${d.references.length - 5} more)` : ""}` : ""}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${result.total} documents (showing ${offset + 1}-${Math.min(offset + limit, result.total)}):\n\n${summary}\n\nUse get_tree with a doc_id to explore a document's section hierarchy.`,
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
    async ({ query, doc_id, filters, limit }) => {
      const results = store.searchDocuments(query, { limit, doc_id, filters });
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
            text: `Document: ${tree.title}\nDoc ID: ${tree.doc_id}\nSections: ${tree.nodes.length}\n\n${outline}\n\nTo read a section's full content, call get_node_content("${doc_id}", ["node_id"]).\nTo get a section and all its subsections, call navigate_tree("${doc_id}", "node_id").`,
          },
        ],
      };
    }
  );

  // ── Tool 4: get_node_content ───────────────────────────────────────

  server.tool(
    "get_node_content",
    "Retrieve the full text content of one or more specific sections. Pass the node IDs obtained from get_tree or search_documents. This returns the actual content under those headings.",
    {
      doc_id: z.string().describe("Document ID"),
      node_ids: z
        .array(z.string())
        .min(1)
        .max(10)
        .describe(
          "Array of node IDs to retrieve content for (from get_tree output)"
        ),
    },
    async ({ doc_id, node_ids }) => {
      const result = store.getNodeContent(doc_id, node_ids);

      if (!result) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Document "${doc_id}" not found.`,
            },
          ],
        };
      }

      if (result.nodes.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No matching nodes found for IDs: ${node_ids.join(", ")}. Use get_tree("${doc_id}") to see available node IDs.`,
            },
          ],
        };
      }

      const formatted = result.nodes
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
    "Get a tree node and ALL its descendant sections with full content. Use this when you need to read an entire section including all its subsections. More efficient than calling get_node_content repeatedly for each child.",
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

  // ── Curation tools (opt-in via WIKI_WRITE=1) ───────────────────────

  if (options?.wiki) {
    registerCurationTools(server, store, options.wiki);
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

// ── Curation tool implementations ────────────────────────────────────
//
// These are only registered when WIKI_WRITE=1 is set. They preserve the
// project's core principle — zero LLM calls inside treenav — by exposing
// deterministic BM25 / validation primitives that let a calling agent
// curate a Karpathy-style wiki using its own LLM.
//
// See docs/adr/0001-llm-curated-wiki.md and docs/wiki-curation-spec.md.

function jsonBlock(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

function errorResult(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const message =
    err instanceof CuratorError
      ? `${err.code}: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function registerCurationTools(
  server: McpServer,
  store: DocumentStore,
  wiki: WikiOptions
): void {
  // ── Tool 7: find_similar ─────────────────────────────────────────

  server.tool(
    "find_similar",
    "Dedupe check for prospective wiki content. Runs arbitrary text through the BM25 engine and returns the top-N overlapping entries. Use this BEFORE drafting or writing a new entry to avoid creating a duplicate. Requires WIKI_WRITE=1.",
    {
      content: z
        .string()
        .min(1)
        .describe(
          "Text to check for duplicates — the full raw source you're about to curate, or a draft body"
        ),
      limit: z
        .number()
        .min(1)
        .max(20)
        .default(5)
        .describe("Max matches to return"),
      threshold: z
        .number()
        .min(0)
        .max(10)
        .default(0.001)
        .describe(
          "Minimum search score for a match to be reported. Default 0.001 — calibrated for the RRF-fused score scale (~[0, 0.05]); set higher to be more selective."
        ),
      collection: z
        .string()
        .optional()
        .describe("Restrict to a single collection"),
    },
    async ({ content, limit, threshold, collection }) => {
      try {
        const result = findSimilar(store, content, {
          limit,
          threshold,
          collection,
          duplicateThreshold: wiki.duplicateThreshold,
        });
        return { content: [{ type: "text" as const, text: jsonBlock(result) }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── Tool 8: draft_wiki_entry ─────────────────────────────────────

  server.tool(
    "draft_wiki_entry",
    "Produce a structural scaffold for a new wiki entry: suggested path, frontmatter (type/category/tags inferred from related entries), backlink candidates, and a duplicate warning if relevant. Does NOT write anything. Use the returned scaffold to author the body with your own LLM, then call write_wiki_entry. Requires WIKI_WRITE=1.",
    {
      topic: z
        .string()
        .min(1)
        .describe("Short topic handle — used for the path slug and title"),
      raw_content: z
        .string()
        .min(1)
        .describe("Source material to be distilled into the new entry"),
      suggested_path: z
        .string()
        .optional()
        .describe(
          "Optional relative path under the wiki root. Must end in .md and stay inside the root."
        ),
      source_url: z
        .string()
        .optional()
        .describe("Canonical URL of the raw source, echoed into frontmatter"),
    },
    async ({ topic, raw_content, suggested_path, source_url }) => {
      try {
        const draft = draftWikiEntry(store, wiki, {
          topic,
          raw_content,
          suggested_path,
          source_url,
        });
        return { content: [{ type: "text" as const, text: jsonBlock(draft) }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── Tool 9: write_wiki_entry ─────────────────────────────────────

  server.tool(
    "write_wiki_entry",
    "Write a curated entry to disk and trigger incremental re-index. Validates path containment, frontmatter schema, and duplicate overlap before touching disk. Use dry_run=true first to preview. On success returns the new doc_id so you can immediately call get_tree / get_node_content. Requires WIKI_WRITE=1.",
    {
      path: z
        .string()
        .min(1)
        .describe("Relative path under the wiki root. Must end in .md."),
      frontmatter: z
        .record(z.unknown())
        .describe(
          "Frontmatter object. Values must be strings, numbers, booleans, or arrays of strings/numbers."
        ),
      content: z
        .string()
        .describe("Markdown body (without frontmatter fence)"),
      dry_run: z
        .boolean()
        .default(false)
        .describe("Validate and preview without touching disk"),
      allow_duplicate: z
        .boolean()
        .default(false)
        .describe(
          "Override duplicate warning. Required when overlap exceeds WIKI_DUPLICATE_THRESHOLD."
        ),
      overwrite: z
        .boolean()
        .default(false)
        .describe("Allow replacing an existing file at the same path"),
    },
    async ({
      path,
      frontmatter,
      content,
      dry_run,
      allow_duplicate,
      overwrite,
    }) => {
      try {
        const result = await writeWikiEntry(store, wiki, {
          path,
          frontmatter,
          content,
          dry_run,
          allow_duplicate,
          overwrite,
        });
        return { content: [{ type: "text" as const, text: jsonBlock(result) }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}
