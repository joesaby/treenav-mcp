/**
 * MCP Server for Markdown + Code Tree Navigation
 *
 * Exposes tools that let an agent perform PageIndex-style reasoning
 * over your markdown repository and source code:
 *
 *   1. list_documents   - Browse the document catalog
 *   2. search_documents - BM25 keyword search across all docs
 *   3. grep_documents   - Literal/regex match across indexed content
 *   4. get_tree         - Hierarchical outline of a document
 *   5. get_node_content - Retrieve text from specific tree nodes
 *   6. navigate_tree    - Get a subtree (node + all descendants)
 *   7. lookup_row       - O(1) key→row lookup (CSV/JSONL data)
 *   8. find_symbol      - Search code symbols by name/kind/language
 *
 * The agent workflow:
 *   search/list → pick doc → get_tree → reason about structure →
 *   get_node_content for the exact section needed
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DocumentStore } from "./store";
import { indexAllCollections } from "./indexer";
import { singleRootConfig } from "./types";
import type { IndexConfig } from "./types";
import { registerTools } from "./tools";
import { registerPrompts } from "./prompts";

// ── Configuration ────────────────────────────────────────────────────

const docs_root = process.env.DOCS_ROOT || "./docs";
const config: IndexConfig = singleRootConfig(docs_root);
config.max_depth = parseInt(process.env.MAX_DEPTH || "6");
config.summary_length = parseInt(process.env.SUMMARY_LENGTH || "200");

// Multi-glob support: DOCS_GLOB=**/*.md,**/*.csv,**/*.jsonl
const docsGlob = process.env.DOCS_GLOB;
if (docsGlob) {
  const patterns = docsGlob.split(",").map((p) => p.trim()).filter(Boolean);
  if (patterns.length > 0) {
    config.collections[0].glob_patterns = patterns;
    config.collections[0].glob_pattern = undefined;
  }
}

// Code collection: set CODE_ROOT to enable AST-based code indexing
const code_root = process.env.CODE_ROOT;
const code_collection_name = process.env.CODE_COLLECTION || "code";
if (code_root) {
  config.code_collections = [
    {
      name: code_collection_name,
      root: code_root,
      weight: parseFloat(process.env.CODE_WEIGHT || "1.0"),
      glob_pattern: process.env.CODE_GLOB,
    },
  ];
}

// ── Initialize store ─────────────────────────────────────────────────

const store = new DocumentStore();

// ── Create MCP Server ────────────────────────────────────────────────

const server = new McpServer({
  name: "treenav",
  version: "1.0.0",
});

// ── Register tools, prompts, resources ──────────────────────────────
//
// `registerTools` also registers the `md-tree://stats` resource so the
// stdio (this file) and HTTP (server-http.ts) entrypoints stay aligned —
// don't re-register it here.

registerTools(server, store);
registerPrompts(server);

// ── Startup ──────────────────────────────────────────────────────────

async function main() {
  // Connect via stdio transport first so the MCP handshake succeeds
  // before the (potentially slow) indexing phase begins.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[treenav] MCP server running on stdio");

  // Defer indexing to the next tick so the transport can process
  // the MCP handshake while indexing runs.
  setTimeout(async () => {
    console.error(`[treenav] Indexing documents from: ${docs_root}`);

    const startTime = Date.now();
    const documents = await indexAllCollections(config);
    store.load(documents);

    // Apply default score-time noise penalties for the code collection so
    // tests, .d.ts stubs, and legacy/compat shims rank below canonical impls.
    if (code_root) {
      const { DEFAULT_CODE_NOISE_PATTERNS } = await import("./types");
      store.setNoisePatterns({
        [code_collection_name]: DEFAULT_CODE_NOISE_PATTERNS,
      });
    }

    const glossaryPath = process.env.GLOSSARY_PATH || join(docs_root, "glossary.json");
    if (existsSync(glossaryPath)) {
      try {
        const glossaryData = await Bun.file(glossaryPath).json();
        store.loadGlossary(glossaryData);
        console.error(`[treenav] Glossary loaded from ${glossaryPath}`);
      } catch (err: any) {
        console.error(`[treenav] Warning: Failed to load glossary from ${glossaryPath}: ${err.message}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const stats = store.getStats();
    console.error(
      `[treenav] Ready in ${elapsed}s — ${stats.document_count} docs, ${stats.total_nodes} sections, ${stats.indexed_terms} terms`
    );
  }, 0);
}

main().catch((err) => {
  console.error("[treenav] Fatal error:", err);
  process.exit(1);
});
