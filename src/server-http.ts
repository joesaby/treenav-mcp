/**
 * HTTP Transport variant of the MCP server
 *
 * Use this when you want to expose the server over HTTP (Streamable HTTP)
 * instead of stdio — useful for remote agents, web apps, or multi-client setups.
 *
 * Usage: DOCS_ROOT=./docs bun run src/server-http.ts
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { DocumentStore } from "./store";
import { indexAllCollections } from "./indexer";
import { singleRootConfig } from "./types";
import { registerTools } from "./tools";
import type { WikiOptions } from "./curator";
import type { IndexConfig } from "./types";

const docs_root = process.env.DOCS_ROOT || "./docs";
const config: IndexConfig = singleRootConfig(docs_root);
config.max_depth = parseInt(process.env.MAX_DEPTH || "6");
config.summary_length = parseInt(process.env.SUMMARY_LENGTH || "200");

const PORT = parseInt(process.env.PORT || "3100");

// Wiki curation toolset — opt-in via WIKI_WRITE=1
let wiki: WikiOptions | undefined;
if (process.env.WIKI_WRITE === "1") {
  const wikiRoot = resolve(process.env.WIKI_ROOT || docs_root);
  wiki = {
    root: wikiRoot,
    collectionName: "docs",
    duplicateThreshold: parseFloat(
      process.env.WIKI_DUPLICATE_THRESHOLD || "0.35"
    ),
  };
  console.log(`[wiki-write] write mode enabled; wiki root is ${wikiRoot}`);
}

const store = new DocumentStore();

async function main() {
  // Index documents
  console.log(`Indexing from ${docs_root}...`);
  const documents = await indexAllCollections(config);
  store.load(documents);

  // Load glossary if present
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

  // Create a new MCP server per request for stateless operation
  // In production you'd want session tracking for stateful mode

  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);

      // Health check
      if (url.pathname === "/health") {
        return Response.json({
          status: "ok",
          ...store.getStats(),
        });
      }

      // MCP endpoint
      if (url.pathname === "/mcp") {
        // For each incoming request, create server + transport
        // This is the stateless pattern from the MCP SDK docs
        const server = new McpServer({
          name: "treenav-mcp",
          version: "1.0.0",
        });
        registerTools(server, store, { wiki });

        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless
        });

        await server.connect(transport);

        // Handle the request through the transport
        return transport.handleRequest(req);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`MCP HTTP server running on http://localhost:${PORT}/mcp`);
  console.log(`Health check: http://localhost:${PORT}/health`);
}

main().catch(console.error);
