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
import { formatSearchResults } from "./search-formatter.js";

/**
 * Register all treenav-mcp tools and resources on the given MCP server.
 *
 * Tools:
 *   1. list_documents   — Browse the document catalog
 *   2. search_documents — Keyword search across all docs
 *   3. get_tree         — Hierarchical outline of a document
 *   4. get_node_content — Retrieve text from specific tree nodes
 *   5. navigate_tree    — Get a subtree (node + all descendants)
 *   6. find_symbol      — Code-aware symbol search
 *   7. get_related      — Cross-reference graph (outlinks + backlinks)
 *
 * Resources:
 *   - index-stats (md-tree://stats) — JSON index statistics
 */
export function registerTools(server: McpServer, store: DocumentStore): void {
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

  // ── Tool 6: find_symbol ────────────────────────────────────────────

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
            `${i + 1}. ${r.node_title} [${r.node_id}]\n   File: ${r.file_path}\n   Score: ${r.score.toFixed(1)}\n   Signature: ${r.snippet}`
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

  // ── Tool 7: get_related ──────────────────────────────────────────────

  server.tool(
    "get_related",
    "Get documents related to a given document via cross-references. Returns outlinks (documents this one links to) and backlinks (documents that link to this one). Use this for lateral navigation — after reading a document, discover related content the author explicitly connected.",
    {
      doc_id: z
        .string()
        .describe("Document ID to find relationships for"),
    },
    async ({ doc_id }) => {
      const related = store.getRelated(doc_id);

      if (!related) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Document "${doc_id}" not found. Use list_documents to see available documents.`,
            },
          ],
        };
      }

      const parts: string[] = [`Related documents for: ${related.title} [${related.doc_id}]`];

      if (related.outlinks.length > 0) {
        const outList = related.outlinks
          .map((l) => `  → [${l.doc_id}] ${l.title}`)
          .join("\n");
        parts.push(`\nOutlinks (this doc links to ${related.outlinks.length} doc${related.outlinks.length === 1 ? "" : "s"}):\n${outList}`);
      } else {
        parts.push("\nOutlinks: none");
      }

      if (related.backlinks.length > 0) {
        const backList = related.backlinks
          .map((l) => `  ← [${l.doc_id}] ${l.title}`)
          .join("\n");
        parts.push(`\nBacklinks (${related.backlinks.length} doc${related.backlinks.length === 1 ? "" : "s"} link${related.backlinks.length === 1 ? "s" : ""} here):\n${backList}`);
      } else {
        parts.push("\nBacklinks: none");
      }

      parts.push("\nUse get_tree(doc_id) to explore any related document's structure.");

      return {
        content: [{ type: "text" as const, text: parts.join("\n") }],
      };
    }
  );

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
