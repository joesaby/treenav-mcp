/**
 * HTTP Transport variant of the MCP server
 *
 * Use this when you want to expose the server over HTTP (Streamable HTTP)
 * instead of stdio — useful for remote agents, web apps, or multi-client setups.
 *
 * Usage: DOCS_ROOT=./docs bun run src/server-http.ts
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { DocumentStore } from "./store";
import { indexAllCollections } from "./indexer";
import { singleRootConfig } from "./types";
import type { IndexConfig } from "./types";
import { registerTools } from "./tools";
import { registerPrompts } from "./prompts";

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

const PORT = parseInt(process.env.PORT || "3100");

const store = new DocumentStore();

async function main() {
  console.log(`Indexing from ${docs_root}...`);
  const documents = await indexAllCollections(config);
  store.load(documents);

  const glossaryPath = process.env.GLOSSARY_PATH || join(docs_root, "glossary.json");
  if (existsSync(glossaryPath)) {
    try {
      const glossaryData = await Bun.file(glossaryPath).json();
      store.loadGlossary(glossaryData);
      console.log(`Glossary loaded from ${glossaryPath}`);
    } catch (err: any) {
      console.warn(`Warning: Failed to load glossary: ${err.message}`);
    }
  }

  const stats = store.getStats();
  console.log(
    `Indexed: ${stats.document_count} docs, ${stats.total_nodes} sections`
  );

  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/health") {
        return Response.json({
          status: "ok",
          ...store.getStats(),
        });
      }

      if (url.pathname === "/mcp") {
        const server = createMcpServer(store);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        await server.connect(transport);
        return transport.handleRequest(req);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`MCP HTTP server running on http://localhost:${PORT}/mcp`);
  console.log(`Health check: http://localhost:${PORT}/health`);
}

/** Factory: creates a configured MCP server instance with all tools */
function createMcpServer(store: DocumentStore): McpServer {
  const server = new McpServer({
    name: "treenav",
    version: "1.0.0",
  });

  registerTools(server, store);
  registerPrompts(server);

  return server;
}

main().catch(console.error);
