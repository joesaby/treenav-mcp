/**
 * MCP Prompt registrations for treenav.
 *
 * Prompts are workflow templates discoverable by ANY MCP client
 * (Claude Desktop, Cursor, Windsurf, etc.) — not just Claude Code.
 * They guide agents through the correct tool-chaining patterns for
 * reading and writing documentation.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  // ── Prompt 1: doc-read ──────────────────────────────────────────────
  server.registerPrompt("doc-read", {
    title: "Read Documentation",
    description:
      "Search and retrieve content from the knowledge base. Guides the agent through: search → browse outline → retrieve specific sections.",
    argsSchema: {
      query: z
        .string()
        .describe("Search query or topic to find in the documentation"),
    },
  }, ({ query }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Find information about: ${query}`,
            "",
            "Follow this workflow using the treenav tools:",
            "",
            "## Step 1: Pick the right search tool",
            "",
            "- **grep_documents** — you have an EXACT string: error codes, CLI flags, config keys, function names, literal phrases, regex. Fast, deterministic, no stemming.",
            "- **search_documents** — you have a CONCEPT: \"how do we rotate JWTs\", \"on-call escalation\". BM25 + glossary + facets handle fuzzy wording.",
            "- **lookup_row** — you have a structured key (PROJ-44, ITEM-1234). O(1) exact match.",
            "",
            `For "${query}", start with whichever fits. If unsure, prefer grep_documents — it's cheap and deterministic. If it returns zero hits, fall back to search_documents so stemming and glossary expansion can rescue the query.`,
            "",
            "## Step 2: Run the search",
            `search_documents: call with query "${query}". Note doc_id and node_id values. Narrow with filters: { "type": "runbook", "tags": ["auth"] }.`,
            `grep_documents: call with pattern "${query}" (add regex: true for regex patterns). Narrow with path_glob: "**/runbooks/**" or the same filters shape.`,
            "",
            "## Step 3: Browse the outline",
            "Pick the most relevant document and call get_tree with its doc_id.",
            "Read the heading hierarchy to identify which sections are relevant.",
            "Do NOT retrieve everything — pick only what matters based on titles, word counts, and summaries.",
            "",
            "## Step 4: Retrieve specific content",
            "For a section and all its subsections, use navigate_tree(doc_id, node_id) — this is most efficient.",
            "For a few individual sections, use get_node_content(doc_id, [node_id, ...]) — up to 10 at once.",
            "",
            "## Step 5: Follow cross-references",
            "If the content links to other documents, repeat steps 3-4 for those if relevant.",
          ].join("\n"),
        },
      },
    ],
  }));

  // ── Prompt 2: doc-grep ──────────────────────────────────────────────
  server.registerPrompt("doc-grep", {
    title: "Grep Documentation",
    description:
      "Literal or regex scan across indexed content. Use for exact strings (error codes, flags, symbols) where BM25 ranking and stemming would get in the way.",
    argsSchema: {
      pattern: z
        .string()
        .describe("Exact string or regex to scan for across the indexed corpus"),
    },
  }, ({ pattern }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Find occurrences of: ${pattern}`,
            "",
            "This is the grep workflow — use it when you already know the exact string.",
            "For conceptual questions (where wording varies), use the doc-read prompt instead.",
            "",
            "## Step 1: Scan",
            `Call grep_documents(pattern: "${pattern}").`,
            "- Set regex: true if the pattern contains regex metacharacters.",
            "- Set case_insensitive: true for forgiving matches.",
            "- Narrow with path_glob (e.g. '**/runbooks/**') or filters ({ type: 'runbook' }) when the corpus is large.",
            "- Nested quantifiers and lookarounds are rejected — simplify the regex if you see a ReDoS error.",
            "",
            "## Step 2: Read context",
            "Each hit includes a node_id. For the most relevant hits, call:",
            "- get_node_content(doc_id, [node_id]) — read just that section",
            "- navigate_tree(doc_id, node_id) — read that section + all its subsections",
            "",
            "## Step 3: If zero hits",
            `Fall back to search_documents("${pattern}"). Stemming or glossary expansion can rescue terms that don't match literally (e.g. "auth" vs "authentication", "K8s" vs "kubernetes").`,
          ].join("\n"),
        },
      },
    ],
  }));

}
