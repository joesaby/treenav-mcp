/**
 * HTTP Transport variant of the MCP server
 *
 * Use this when you want to expose the server over HTTP (Streamable HTTP)
 * instead of stdio — useful for remote agents, web apps, or multi-client setups.
 *
 * Usage: DOCS_ROOT=./docs bun run src/server-http.ts
 */

import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { DocumentStore } from "./store";
import { indexAllCollections } from "./indexer";
import { buildConfigFromEnv, collectionWeights } from "./config";
import { DEFAULT_CODE_NOISE_PATTERNS } from "./types";
import { registerTools } from "./tools";
import { registerPrompts } from "./prompts";

const { config, roots_label, glossary_path, code_root, code_collection_name } =
  buildConfigFromEnv();

const PORT = parseInt(process.env.PORT || "3100");

const store = new DocumentStore();

async function main() {
  console.log(`Indexing from ${roots_label}...`);
  const documents = await indexAllCollections(config);
  store.load(documents);

  // Apply collection weights (DOCS_ROOTS per-root weights, CODE_WEIGHT).
  store.setCollectionWeights(collectionWeights(config));

  // Apply default score-time noise penalties for the code collection so
  // tests, .d.ts stubs, and legacy/compat shims rank below canonical impls.
  if (code_root) {
    store.setNoisePatterns({
      [code_collection_name]: DEFAULT_CODE_NOISE_PATTERNS,
    });
  }

  if (existsSync(glossary_path)) {
    try {
      const glossaryData = await Bun.file(glossary_path).json();
      store.loadGlossary(glossaryData);
      console.log(`Glossary loaded from ${glossary_path}`);
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
