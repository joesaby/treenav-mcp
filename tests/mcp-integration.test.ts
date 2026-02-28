/**
 * MCP Integration Tests
 *
 * End-to-end tests that exercise all 6 MCP tools + 1 resource through
 * the real MCP protocol layer using InMemoryTransport.
 *
 * Validates the full pipeline:
 *   Client.callTool() → MCP protocol → Zod validation →
 *   tool handler → DocumentStore → response formatting
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  createMcpTestClient,
  getToolText,
  makeDoc,
  makeNode,
  type McpTestHarness,
} from "./fixtures/helpers";

// ── Shared fixture data ──────────────────────────────────────────────

function authDoc() {
  return makeDoc({
    meta: {
      doc_id: "docs:auth",
      file_path: "guides/auth.md",
      title: "Authentication Guide",
      description: "How to authenticate users with JWT tokens",
      tags: ["auth", "jwt", "security"],
      collection: "docs",
      facets: { category: ["guide"], type: ["guide"] },
    },
    tree: [
      makeNode({
        node_id: "docs:auth:n1",
        title: "Authentication Guide",
        level: 1,
        children: ["docs:auth:n2", "docs:auth:n3"],
        content: "Overview of the authentication system using JWT tokens and refresh flows.",
        word_count: 12,
        summary: "Overview of the authentication system...",
      }),
      makeNode({
        node_id: "docs:auth:n2",
        title: "Token Refresh",
        level: 2,
        parent_id: "docs:auth:n1",
        children: [],
        content:
          "The token refresh mechanism uses refresh tokens to obtain new access tokens without re-authentication. Tokens expire after 3600 seconds.",
        word_count: 18,
        summary: "The token refresh mechanism uses refresh tokens...",
      }),
      makeNode({
        node_id: "docs:auth:n3",
        title: "Error Handling",
        level: 2,
        parent_id: "docs:auth:n1",
        children: [],
        content: "When token refresh fails, return a 401 status and clear the session cookies.",
        word_count: 14,
        summary: "When token refresh fails...",
      }),
    ],
  });
}

function deployDoc() {
  return makeDoc({
    meta: {
      doc_id: "docs:deploy",
      file_path: "guides/deploy.md",
      title: "Deployment Guide",
      description: "How to deploy services to production safely",
      tags: ["deploy", "ops", "production"],
      collection: "docs",
      facets: { category: ["guide"], type: ["deployment"] },
    },
    tree: [
      makeNode({
        node_id: "docs:deploy:n1",
        title: "Deployment Guide",
        level: 1,
        children: ["docs:deploy:n2"],
        content: "Steps for deploying to production environments with zero downtime.",
        word_count: 10,
        summary: "Steps for deploying to production...",
      }),
      makeNode({
        node_id: "docs:deploy:n2",
        title: "Rollback Procedure",
        level: 2,
        parent_id: "docs:deploy:n1",
        children: [],
        content:
          "To rollback a deployment, use the rollback command with the previous version tag. Always verify health checks after rollback.",
        word_count: 18,
        summary: "To rollback a deployment...",
      }),
    ],
  });
}

function runbookDoc() {
  return makeDoc({
    meta: {
      doc_id: "docs:runbook",
      file_path: "runbooks/db-restart.md",
      title: "Database Restart Runbook",
      description: "Emergency procedure for restarting PostgreSQL",
      tags: ["database", "ops", "postgres"],
      collection: "docs",
      facets: { category: ["runbook"], type: ["runbook"] },
    },
    tree: [
      makeNode({
        node_id: "docs:runbook:n1",
        title: "Database Restart Runbook",
        level: 1,
        children: [],
        content:
          "Emergency procedure for restarting the PostgreSQL database cluster. Check active connections first.",
        word_count: 13,
        summary: "Emergency procedure for restarting the PostgreSQL...",
      }),
    ],
  });
}

function codeDoc() {
  return makeDoc({
    meta: {
      doc_id: "code:src/auth.ts",
      file_path: "src/auth.ts",
      title: "src/auth.ts",
      description: "",
      tags: [],
      collection: "code",
      facets: {
        content_type: ["code"],
        language: ["typescript"],
        symbol_kind: ["class", "function", "interface"],
      },
    },
    tree: [
      makeNode({
        node_id: "code:src/auth.ts:n1",
        title: "class AuthService",
        level: 1,
        children: ["code:src/auth.ts:n2"],
        content:
          "export class AuthService {\n  private secret: string;\n  constructor(secret: string) { this.secret = secret; }\n}",
        word_count: 15,
        summary: "export class AuthService",
      }),
      makeNode({
        node_id: "code:src/auth.ts:n2",
        title: "method authenticate",
        level: 2,
        parent_id: "code:src/auth.ts:n1",
        children: [],
        content:
          "async authenticate(username: string, password: string): Promise<string> {\n  return 'token';\n}",
        word_count: 10,
        summary: "async authenticate(username: string, password: string): Promise<string>",
      }),
      makeNode({
        node_id: "code:src/auth.ts:n3",
        title: "function validateToken",
        level: 1,
        children: [],
        content:
          "export function validateToken(token: string, secret: string): boolean {\n  return true;\n}",
        word_count: 10,
        summary: "export function validateToken(token: string, secret: string): boolean",
      }),
      makeNode({
        node_id: "code:src/auth.ts:n4",
        title: "interface AuthConfig",
        level: 1,
        children: [],
        content:
          "export interface AuthConfig {\n  secret: string;\n  tokenExpiry: number;\n}",
        word_count: 8,
        summary: "export interface AuthConfig",
      }),
    ],
  });
}

function allDocs() {
  return [authDoc(), deployDoc(), runbookDoc(), codeDoc()];
}

// ── Tool discovery ───────────────────────────────────────────────────

describe("MCP tool discovery", () => {
  let harness: McpTestHarness;

  afterEach(async () => {
    if (harness) await harness.cleanup();
  });

  test("listTools returns all 6 tools", async () => {
    harness = await createMcpTestClient(allDocs());
    const { tools } = await harness.client.listTools();

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "find_symbol",
      "get_node_content",
      "get_tree",
      "list_documents",
      "navigate_tree",
      "search_documents",
    ]);
  });

  test("each tool has a description and input schema", async () => {
    harness = await createMcpTestClient([]);
    const { tools } = await harness.client.listTools();

    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  test("listResources includes index-stats", async () => {
    harness = await createMcpTestClient([]);
    const { resources } = await harness.client.listResources();

    const statRes = resources.find((r) => r.name === "index-stats");
    expect(statRes).toBeDefined();
    expect(statRes!.uri).toBe("md-tree://stats");
  });
});

// ── list_documents ───────────────────────────────────────────────────

describe("MCP list_documents", () => {
  let harness: McpTestHarness;

  afterEach(async () => {
    if (harness) await harness.cleanup();
  });

  test("lists all documents with no filters", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "list_documents",
      arguments: {},
    });

    const text = getToolText(result);
    expect(text).toContain("Found 4 documents");
    expect(text).toContain("docs:auth");
    expect(text).toContain("docs:deploy");
    expect(text).toContain("docs:runbook");
    expect(text).toContain("code:src/auth.ts");
  });

  test("filters by tag", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "list_documents",
      arguments: { tag: "jwt" },
    });

    const text = getToolText(result);
    expect(text).toContain("Found 1 documents");
    expect(text).toContain("docs:auth");
    expect(text).not.toContain("docs:deploy");
  });

  test("filters by query keyword", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "list_documents",
      arguments: { query: "runbook" },
    });

    const text = getToolText(result);
    expect(text).toContain("Found 1 documents");
    expect(text).toContain("docs:runbook");
  });

  test("paginates with limit and offset", async () => {
    harness = await createMcpTestClient(allDocs());

    const page1 = await harness.client.callTool({
      name: "list_documents",
      arguments: { limit: 2, offset: 0 },
    });
    const page2 = await harness.client.callTool({
      name: "list_documents",
      arguments: { limit: 2, offset: 2 },
    });

    const text1 = getToolText(page1);
    const text2 = getToolText(page2);

    expect(text1).toContain("showing 1-2");
    expect(text2).toContain("showing 3-4");
  });

  test("returns empty for no matching tag", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "list_documents",
      arguments: { tag: "nonexistent" },
    });

    const text = getToolText(result);
    expect(text).toContain("Found 0 documents");
  });
});

// ── search_documents ─────────────────────────────────────────────────

describe("MCP search_documents", () => {
  let harness: McpTestHarness;

  afterEach(async () => {
    if (harness) await harness.cleanup();
  });

  test("finds documents by keyword", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "search_documents",
      arguments: { query: "authentication" },
    });

    const text = getToolText(result);
    expect(text).toContain("Search results");
    expect(text).toContain("docs:auth");
  });

  test("returns no-results message for unmatched query", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "search_documents",
      arguments: { query: "xyznonexistentterm" },
    });

    const text = getToolText(result);
    expect(text).toContain("No results found");
  });

  test("scopes to specific doc_id", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "search_documents",
      arguments: { query: "token", doc_id: "docs:auth" },
    });

    const text = getToolText(result);
    expect(text).toContain("docs:auth");
    expect(text).not.toContain("docs:deploy");
  });

  test("applies facet filters", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "search_documents",
      arguments: {
        query: "procedure",
        filters: { type: "runbook" },
      },
    });

    const text = getToolText(result);
    expect(text).toContain("docs:runbook");
    expect(text).not.toContain("docs:deploy");
  });

  test("respects limit parameter", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "search_documents",
      arguments: { query: "token", limit: 1 },
    });

    const text = getToolText(result);
    // Should contain exactly 1 result
    expect(text).toContain("(1 matches)");
    expect(text).toMatch(/^.*1\.\s/m);
    // Should NOT have a second numbered result
    expect(text).not.toMatch(/^2\.\s/m);
  });

  test("returns snippets in results", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "search_documents",
      arguments: { query: "token refresh" },
    });

    const text = getToolText(result);
    expect(text).toContain("Snippet:");
  });
});

// ── get_tree ─────────────────────────────────────────────────────────

describe("MCP get_tree", () => {
  let harness: McpTestHarness;

  afterEach(async () => {
    if (harness) await harness.cleanup();
  });

  test("returns document outline", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "get_tree",
      arguments: { doc_id: "docs:auth" },
    });

    const text = getToolText(result);
    expect(text).toContain("Document: Authentication Guide");
    expect(text).toContain("docs:auth:n1");
    expect(text).toContain("docs:auth:n2");
    expect(text).toContain("docs:auth:n3");
    expect(text).toContain("Token Refresh");
    expect(text).toContain("Error Handling");
  });

  test("shows heading levels and word counts", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "get_tree",
      arguments: { doc_id: "docs:auth" },
    });

    const text = getToolText(result);
    // Level 1 heading
    expect(text).toContain("# Authentication Guide");
    // Level 2 headings
    expect(text).toContain("## Token Refresh");
    // Word counts
    expect(text).toMatch(/\d+ words/);
  });

  test("returns not-found message for unknown doc", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "get_tree",
      arguments: { doc_id: "nonexistent" },
    });

    const text = getToolText(result);
    expect(text).toContain("not found");
  });

  test("shows code document tree", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "get_tree",
      arguments: { doc_id: "code:src/auth.ts" },
    });

    const text = getToolText(result);
    expect(text).toContain("class AuthService");
    expect(text).toContain("method authenticate");
    expect(text).toContain("function validateToken");
    expect(text).toContain("interface AuthConfig");
  });
});

// ── get_node_content ─────────────────────────────────────────────────

describe("MCP get_node_content", () => {
  let harness: McpTestHarness;

  afterEach(async () => {
    if (harness) await harness.cleanup();
  });

  test("retrieves content for valid node IDs", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "get_node_content",
      arguments: {
        doc_id: "docs:auth",
        node_ids: ["docs:auth:n2", "docs:auth:n3"],
      },
    });

    const text = getToolText(result);
    expect(text).toContain("Token Refresh");
    expect(text).toContain("refresh tokens");
    expect(text).toContain("Error Handling");
    expect(text).toContain("401 status");
  });

  test("returns not-found for unknown doc_id", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "get_node_content",
      arguments: {
        doc_id: "nonexistent",
        node_ids: ["n1"],
      },
    });

    const text = getToolText(result);
    expect(text).toContain("not found");
  });

  test("returns empty message for non-existent node IDs", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "get_node_content",
      arguments: {
        doc_id: "docs:auth",
        node_ids: ["docs:auth:n999"],
      },
    });

    const text = getToolText(result);
    expect(text).toContain("No matching nodes");
  });

  test("retrieves single node", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "get_node_content",
      arguments: {
        doc_id: "docs:auth",
        node_ids: ["docs:auth:n2"],
      },
    });

    const text = getToolText(result);
    expect(text).toContain("Token Refresh");
    expect(text).toContain("refresh tokens");
    // Should not contain other sections
    expect(text).not.toContain("Error Handling");
  });

  test("formats content with section headers", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "get_node_content",
      arguments: {
        doc_id: "docs:auth",
        node_ids: ["docs:auth:n2"],
      },
    });

    const text = getToolText(result);
    // Should have separator format
    expect(text).toContain("━━━");
    expect(text).toContain("[docs:auth:n2]");
  });
});

// ── navigate_tree ────────────────────────────────────────────────────

describe("MCP navigate_tree", () => {
  let harness: McpTestHarness;

  afterEach(async () => {
    if (harness) await harness.cleanup();
  });

  test("returns node and all descendants", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "navigate_tree",
      arguments: {
        doc_id: "docs:auth",
        node_id: "docs:auth:n1",
      },
    });

    const text = getToolText(result);
    // Root + 2 children
    expect(text).toContain("3 sections");
    expect(text).toContain("Authentication Guide");
    expect(text).toContain("Token Refresh");
    expect(text).toContain("Error Handling");
  });

  test("returns not-found for unknown doc/node", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "navigate_tree",
      arguments: {
        doc_id: "docs:auth",
        node_id: "nonexistent",
      },
    });

    const text = getToolText(result);
    expect(text).toContain("not found");
    expect(text).toContain("doesn't exist");
  });

  test("leaf node returns single section", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "navigate_tree",
      arguments: {
        doc_id: "docs:auth",
        node_id: "docs:auth:n3",
      },
    });

    const text = getToolText(result);
    expect(text).toContain("1 sections");
    expect(text).toContain("Error Handling");
  });

  test("includes total word count", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "navigate_tree",
      arguments: {
        doc_id: "docs:auth",
        node_id: "docs:auth:n1",
      },
    });

    const text = getToolText(result);
    expect(text).toMatch(/\d+ words/);
  });
});

// ── find_symbol ──────────────────────────────────────────────────────

describe("MCP find_symbol", () => {
  let harness: McpTestHarness;

  afterEach(async () => {
    if (harness) await harness.cleanup();
  });

  test("finds symbols by name", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "find_symbol",
      arguments: { query: "AuthService" },
    });

    const text = getToolText(result);
    expect(text).toContain("Symbol search");
    expect(text).toContain("AuthService");
  });

  test("filters by symbol kind", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "find_symbol",
      arguments: { query: "auth", kind: "interface" },
    });

    const text = getToolText(result);
    // Should find AuthConfig interface
    expect(text).toContain("AuthConfig");
  });

  test("filters by language", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "find_symbol",
      arguments: { query: "validate", language: "typescript" },
    });

    const text = getToolText(result);
    expect(text).toContain("validateToken");
  });

  test("returns no-results message when nothing matches", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "find_symbol",
      arguments: { query: "xyznonexistent" },
    });

    const text = getToolText(result);
    expect(text).toContain("No symbols found");
  });

  test("returns no symbols when no code is indexed", async () => {
    // Load only markdown docs, no code
    harness = await createMcpTestClient([authDoc(), deployDoc()]);
    const result = await harness.client.callTool({
      name: "find_symbol",
      arguments: { query: "auth" },
    });

    const text = getToolText(result);
    expect(text).toContain("No symbols found");
  });
});

// ── index-stats resource ─────────────────────────────────────────────

describe("MCP index-stats resource", () => {
  let harness: McpTestHarness;

  afterEach(async () => {
    if (harness) await harness.cleanup();
  });

  test("returns valid JSON stats", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.readResource({
      uri: "md-tree://stats",
    });

    expect(result.contents.length).toBe(1);
    expect(result.contents[0].mimeType).toBe("application/json");

    const stats = JSON.parse(result.contents[0].text as string);
    expect(stats).toHaveProperty("document_count");
    expect(stats).toHaveProperty("total_nodes");
    expect(stats).toHaveProperty("indexed_terms");
    expect(stats).toHaveProperty("avg_node_length");
  });

  test("reflects correct document and node counts", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.readResource({
      uri: "md-tree://stats",
    });

    const stats = JSON.parse(result.contents[0].text as string);
    expect(stats.document_count).toBe(4);
    // auth has 3, deploy has 2, runbook has 1, code has 4 = 10 total
    expect(stats.total_nodes).toBe(10);
  });

  test("includes facet keys and collections", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.readResource({
      uri: "md-tree://stats",
    });

    const stats = JSON.parse(result.contents[0].text as string);
    expect(stats.facet_keys).toContain("collection");
    expect(stats.collections).toContain("docs");
    expect(stats.collections).toContain("code");
  });
});

// ── Multi-tool workflows ─────────────────────────────────────────────

describe("MCP multi-tool workflows", () => {
  let harness: McpTestHarness;

  afterEach(async () => {
    if (harness) await harness.cleanup();
  });

  test("search → get_tree → get_node_content", async () => {
    harness = await createMcpTestClient(allDocs());

    // Step 1: Search for "token refresh"
    const searchResult = await harness.client.callTool({
      name: "search_documents",
      arguments: { query: "token refresh" },
    });
    const searchText = getToolText(searchResult);
    expect(searchText).toContain("docs:auth");

    // Step 2: Get tree of the found document
    const treeResult = await harness.client.callTool({
      name: "get_tree",
      arguments: { doc_id: "docs:auth" },
    });
    const treeText = getToolText(treeResult);
    expect(treeText).toContain("Token Refresh");
    expect(treeText).toContain("docs:auth:n2");

    // Step 3: Get content of the specific section
    const contentResult = await harness.client.callTool({
      name: "get_node_content",
      arguments: {
        doc_id: "docs:auth",
        node_ids: ["docs:auth:n2"],
      },
    });
    const contentText = getToolText(contentResult);
    expect(contentText).toContain("refresh tokens");
    expect(contentText).toContain("3600 seconds");
  });

  test("list_documents → get_tree → navigate_tree", async () => {
    harness = await createMcpTestClient(allDocs());

    // Step 1: List documents with tag filter
    const listResult = await harness.client.callTool({
      name: "list_documents",
      arguments: { tag: "ops" },
    });
    const listText = getToolText(listResult);
    expect(listText).toContain("docs:deploy");

    // Step 2: Get tree
    const treeResult = await harness.client.callTool({
      name: "get_tree",
      arguments: { doc_id: "docs:deploy" },
    });
    const treeText = getToolText(treeResult);
    expect(treeText).toContain("docs:deploy:n1");

    // Step 3: Navigate entire subtree
    const navResult = await harness.client.callTool({
      name: "navigate_tree",
      arguments: { doc_id: "docs:deploy", node_id: "docs:deploy:n1" },
    });
    const navText = getToolText(navResult);
    expect(navText).toContain("Deployment Guide");
    expect(navText).toContain("Rollback Procedure");
    expect(navText).toContain("health checks");
  });

  test("find_symbol → get_node_content (code navigation)", async () => {
    harness = await createMcpTestClient(allDocs());

    // Step 1: Find symbol
    const symbolResult = await harness.client.callTool({
      name: "find_symbol",
      arguments: { query: "validateToken" },
    });
    const symbolText = getToolText(symbolResult);
    expect(symbolText).toContain("validateToken");
    expect(symbolText).toContain("code:src/auth.ts");

    // Step 2: Get the symbol's source code
    const contentResult = await harness.client.callTool({
      name: "get_node_content",
      arguments: {
        doc_id: "code:src/auth.ts",
        node_ids: ["code:src/auth.ts:n3"],
      },
    });
    const contentText = getToolText(contentResult);
    expect(contentText).toContain("function validateToken");
    expect(contentText).toContain("boolean");
  });

  test("glossary expansion in search", async () => {
    harness = await createMcpTestClient(allDocs(), {
      glossary: {
        JWT: ["json web token"],
      },
    });

    // Search for "JWT" should expand and find docs mentioning JWT/tokens
    const result = await harness.client.callTool({
      name: "search_documents",
      arguments: { query: "JWT" },
    });

    const text = getToolText(result);
    expect(text).toContain("docs:auth");
  });
});

// ── Error handling ───────────────────────────────────────────────────

describe("MCP error handling", () => {
  let harness: McpTestHarness;

  afterEach(async () => {
    if (harness) await harness.cleanup();
  });

  test("empty store still responds to list_documents", async () => {
    harness = await createMcpTestClient([]);
    const result = await harness.client.callTool({
      name: "list_documents",
      arguments: {},
    });

    const text = getToolText(result);
    expect(text).toContain("Found 0 documents");
  });

  test("empty store search returns no results", async () => {
    harness = await createMcpTestClient([]);
    const result = await harness.client.callTool({
      name: "search_documents",
      arguments: { query: "anything" },
    });

    const text = getToolText(result);
    expect(text).toContain("No results found");
  });

  test("concurrent tool calls don't interfere", async () => {
    harness = await createMcpTestClient(allDocs());

    // Fire multiple calls concurrently
    const [r1, r2, r3] = await Promise.all([
      harness.client.callTool({
        name: "search_documents",
        arguments: { query: "authentication" },
      }),
      harness.client.callTool({
        name: "get_tree",
        arguments: { doc_id: "docs:auth" },
      }),
      harness.client.callTool({
        name: "list_documents",
        arguments: {},
      }),
    ]);

    expect(getToolText(r1)).toContain("docs:auth");
    expect(getToolText(r2)).toContain("Authentication Guide");
    expect(getToolText(r3)).toContain("Found 4 documents");
  });

  test("get_tree on unknown doc_id returns error message", async () => {
    harness = await createMcpTestClient(allDocs());
    const result = await harness.client.callTool({
      name: "get_tree",
      arguments: { doc_id: "totally:bogus" },
    });

    const text = getToolText(result);
    expect(text).toContain("not found");
  });
});
