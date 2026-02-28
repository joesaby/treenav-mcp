/**
 * Shared test helpers for treenav-mcp tests.
 *
 * Provides factory functions for building IndexedDocuments, TreeNodes,
 * and a ready-to-use MCP test client wired through InMemoryTransport.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DocumentStore } from "../../src/store";
import { registerTools } from "../../src/tools";
import type { IndexedDocument, TreeNode, DocumentMeta } from "../../src/types";

// ── Node / Meta / Doc factories ──────────────────────────────────────

export function makeNode(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    node_id: "test:doc:n1",
    title: "Test Node",
    level: 1,
    parent_id: null,
    children: [],
    content: "Default test content for the node.",
    summary: "Default test content...",
    word_count: 6,
    line_start: 1,
    line_end: 10,
    ...overrides,
  };
}

export function makeMeta(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    doc_id: "test:doc",
    file_path: "doc.md",
    title: "Test Document",
    description: "A test document for unit testing",
    word_count: 100,
    heading_count: 3,
    max_depth: 2,
    last_modified: "2025-01-01T00:00:00.000Z",
    tags: [],
    content_hash: "abc123",
    collection: "test",
    facets: {},
    ...overrides,
  };
}

export function makeDoc(overrides: {
  meta?: Partial<DocumentMeta>;
  tree?: TreeNode[];
  root_nodes?: string[];
} = {}): IndexedDocument {
  const tree = overrides.tree || [
    makeNode({
      node_id: `${overrides.meta?.doc_id || "test:doc"}:n1`,
      title: overrides.meta?.title || "Test Document",
      content: "This is the main content of the test document about authentication and tokens.",
    }),
    makeNode({
      node_id: `${overrides.meta?.doc_id || "test:doc"}:n2`,
      title: "Section A",
      level: 2,
      parent_id: `${overrides.meta?.doc_id || "test:doc"}:n1`,
      content: "Section A discusses token refresh and session management.",
      word_count: 8,
    }),
  ];

  return {
    meta: makeMeta({
      heading_count: tree.length,
      word_count: tree.reduce((s, n) => s + n.word_count, 0),
      ...overrides.meta,
    }),
    tree,
    root_nodes: overrides.root_nodes || [tree[0].node_id],
  };
}

// ── MCP test client factory ──────────────────────────────────────────

export interface McpTestHarness {
  client: Client;
  store: DocumentStore;
  mcpServer: McpServer;
  cleanup: () => Promise<void>;
}

/**
 * Create a fully-wired MCP test harness.
 *
 * Returns a connected Client ↔ McpServer pair linked via InMemoryTransport,
 * with all tools and resources registered. The store is loaded with the
 * provided documents (if any).
 */
export async function createMcpTestClient(
  documents: IndexedDocument[] = [],
  options?: {
    glossary?: Record<string, string[]>;
    collectionWeights?: Record<string, number>;
  },
): Promise<McpTestHarness> {
  // Build and populate the store
  const store = new DocumentStore();
  store.load(documents);

  if (options?.glossary) {
    store.loadGlossary(options.glossary);
  }
  if (options?.collectionWeights) {
    store.setCollectionWeights(options.collectionWeights);
  }

  // Create MCP server and register tools
  const mcpServer = new McpServer({
    name: "treenav-test",
    version: "0.0.1",
  });
  registerTools(mcpServer, store);

  // Wire up InMemoryTransport
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Connect server first, then client
  await mcpServer.server.connect(serverTransport);

  const client = new Client(
    { name: "test-client", version: "0.0.1" },
  );
  await client.connect(clientTransport);

  return {
    client,
    store,
    mcpServer,
    cleanup: async () => {
      await client.close();
      await mcpServer.server.close();
    },
  };
}

/**
 * Helper to extract text from a callTool result.
 */
export function getToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c: any) => c.type === "text" && c.text)
    .map((c: any) => c.text)
    .join("\n");
}
