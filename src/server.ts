/**
 * MCP Server for Markdown Tree Navigation
 *
 * Exposes 6 tools that let an agent perform PageIndex-style reasoning
 * over your markdown repository:
 *
 *   1. list_documents   - Browse the document catalog
 *   2. search_documents - Keyword search across all docs
 *   3. get_tree         - Get hierarchical outline of a document
 *   4. get_node_content - Retrieve text from specific tree nodes
 *   5. navigate_tree    - Get a subtree (node + all descendants)
 *   6. find_symbol      - Search code symbols by name/kind/language
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
import { registerTools } from "./tools";
import type { IndexConfig } from "./types";

// ── Configuration ────────────────────────────────────────────────────

const docs_root = process.env.DOCS_ROOT || "./docs";
const config: IndexConfig = singleRootConfig(docs_root);
config.max_depth = parseInt(process.env.MAX_DEPTH || "6");
config.summary_length = parseInt(process.env.SUMMARY_LENGTH || "200");

// Code collection: set CODE_ROOT to enable AST-based code indexing
const code_root = process.env.CODE_ROOT;
if (code_root) {
  config.code_collections = [
    {
      name: process.env.CODE_COLLECTION || "code",
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
  name: "treenav-mcp",
  version: "1.0.0",
});

// Register all tools and resources from the shared module
registerTools(server, store);

// ── Startup ──────────────────────────────────────────────────────────

async function main() {
  console.error(`[treenav-mcp] Indexing documents from: ${docs_root}`);

  // Index all documents at startup
  const startTime = Date.now();
  const documents = await indexAllCollections(config);
  store.load(documents);

  // Load glossary if present (glossary.json in docs root)
  const glossaryPath = process.env.GLOSSARY_PATH || join(docs_root, "glossary.json");
  if (existsSync(glossaryPath)) {
    try {
      const glossaryData = await Bun.file(glossaryPath).json();
      store.loadGlossary(glossaryData);
      console.error(`[treenav-mcp] Glossary loaded from ${glossaryPath}`);
    } catch (err: any) {
      console.error(`[treenav-mcp] Warning: Failed to load glossary from ${glossaryPath}: ${err.message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const stats = store.getStats();
  console.error(
    `[treenav-mcp] Ready in ${elapsed}s — ${stats.document_count} docs, ${stats.total_nodes} sections, ${stats.indexed_terms} terms`
  );

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[treenav-mcp] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[treenav-mcp] Fatal error:", err);
  process.exit(1);
});
