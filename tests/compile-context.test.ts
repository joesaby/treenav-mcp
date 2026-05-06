import { describe, expect, test } from "bun:test";
import type {
  CompileContextInput,
  CompileContextResult,
  CompileContextHit,
  CompileContextOutline,
  CompileContextFullContent,
  ResolvedMode,
  CompileContextSource,
  IndexedDocument,
  TreeNode,
  DocumentMeta,
} from "../src/types";
import { DocumentStore } from "../src/store";

describe("compile_context types", () => {
  test("input shape is well-formed", () => {
    const input: CompileContextInput = {
      intent: "auth token rotation",
      mode: "auto",
      sources: ["docs", "code"],
      filters: { type: "runbook" },
      output: {
        top_k_per_source: 3,
        include_snippets: true,
        include_outlines_for_top: 2,
        include_full_content_for_top: 0,
        max_tokens: 2000,
      },
    };
    expect(input.intent).toBe("auth token rotation");
  });

  test("result shape is well-formed", () => {
    const result: CompileContextResult = {
      intent: "x",
      resolved_mode: "search",
      sources: ["docs"],
      duration_ms: 5,
      hits_by_source: { docs: [], code: [], rows: [] },
      hit_totals_by_source: { docs: 0, code: 0, rows: 0 },
      outlines: [],
      full_content: [],
      trim_notes: [],
      tokens_used_estimate: 0,
      tokens_budget: 2000,
    };
    expect(result.resolved_mode).toBe("search");
  });
});

import { resolveMode } from "../src/compile-context";

describe("resolveMode (auto heuristic)", () => {
  // Lookup-shaped: ALL_CAPS-DIGITS pattern
  test.each([
    ["PROJ-44", "lookup"],
    ["INC-104", "lookup"],
    ["ITEM-1234", "lookup"],
  ])("%s -> lookup", (q, expected) => {
    expect(resolveMode(q)).toBe(expected);
  });

  // Regex-shaped: contains regex metacharacters
  test.each([
    ["^class.*Service$", "grep"],
    ["foo\\sbar", "grep"],
    ["[A-Z]+", "grep"],
    ["foo|bar", "grep"],
    ["(?:foo)", "grep"],
  ])("%s -> grep", (q, expected) => {
    expect(resolveMode(q)).toBe(expected);
  });

  // Symbol-shaped: starts with class/function/interface, or camelCase token
  test.each([
    ["class AuthService", "symbol"],
    ["function parseAuthHeader", "symbol"],
    ["interface UserRepository", "symbol"],
    ["parseAuthHeader", "symbol"],
    ["AuthService", "symbol"],
  ])("%s -> symbol", (q, expected) => {
    expect(resolveMode(q)).toBe(expected);
  });

  // Default: natural-language → search
  test.each([
    ["how do we rotate tokens", "search"],
    ["auth token rotation", "search"],
    ["incident response runbook", "search"],
    ["", "search"],
  ])("%s -> search", (q, expected) => {
    expect(resolveMode(q)).toBe(expected);
  });
});

import { dispatchSearch } from "../src/compile-context";

// ── Test helpers ────────────────────────────────────────────────────

function makeNode(overrides: Partial<TreeNode> = {}): TreeNode {
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

function makeMeta(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
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
    references: [],
    ...overrides,
  };
}

function makeDoc(overrides: {
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

function makeStoreWithFixtures(): DocumentStore {
  const store = new DocumentStore();
  // Two docs: one in "docs" collection, one in "code" collection.
  store.load([
    makeDoc({
      meta: {
        doc_id: "auth-runbook",
        file_path: "auth/runbook.md",
        title: "Auth Runbook",
        description: "How to handle auth incidents",
        collection: "docs",
        facets: { type: ["runbook"], tags: ["auth"] },
      },
      tree: [
        makeNode({
          node_id: "n0",
          title: "Auth Runbook",
          level: 1,
          parent_id: null,
          children: ["n1"],
          content: "Auth token rotation procedure for incident response.",
          summary: "Auth token rotation procedure for incident response.",
          word_count: 8,
          line_start: 1,
          line_end: 5,
        }),
        makeNode({
          node_id: "n1",
          title: "Token Rotation",
          level: 2,
          parent_id: "n0",
          children: [],
          content: "Rotate the JWT signing key, then redeploy the auth service.",
          summary: "Rotate the JWT signing key, then redeploy the auth service.",
          word_count: 10,
          line_start: 6,
          line_end: 10,
        }),
      ],
    }),
    makeDoc({
      meta: {
        doc_id: "auth-service",
        file_path: "src/AuthService.ts",
        title: "AuthService",
        description: "Authentication service implementation",
        collection: "code",
        facets: { content_type: ["code"], language: ["typescript"] },
      },
      tree: [
        makeNode({
          node_id: "c0",
          title: "class AuthService",
          level: 1,
          parent_id: null,
          children: ["c1"],
          content: "class AuthService { rotateToken() { /* ... */ } }",
          summary: "Authentication service",
          word_count: 6,
          line_start: 1,
          line_end: 5,
          symbol_kind: "class",
          symbol_name: "AuthService",
        }),
        makeNode({
          node_id: "c1",
          title: "rotateToken",
          level: 2,
          parent_id: "c0",
          children: [],
          content: "rotateToken() { return this.signer.rotate(); }",
          summary: "Rotates the auth token",
          word_count: 5,
          line_start: 6,
          line_end: 10,
          symbol_kind: "method",
          symbol_name: "rotateToken",
        }),
      ],
    }),
  ]);
  return store;
}

describe("dispatchSearch", () => {
  test("returns hits from the requested collection only", () => {
    const store = makeStoreWithFixtures();
    const docHits = dispatchSearch(store, "token rotation", "docs", undefined, 3);
    const codeHits = dispatchSearch(store, "token rotation", "code", undefined, 3);

    expect(docHits.length).toBeGreaterThan(0);
    expect(docHits.every((h) => h.source === "docs")).toBe(true);
    expect(codeHits.every((h) => h.source === "code")).toBe(true);
  });

  test("respects top_k limit", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchSearch(store, "token rotation", "docs", undefined, 1);
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  test("passes filters through to searchDocuments", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchSearch(store, "token rotation", "docs", { type: "runbook" }, 5);
    expect(hits.every((h) => h.source === "docs")).toBe(true);
  });

  test("each hit carries provenance fields", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchSearch(store, "token rotation", "docs", undefined, 5);
    for (const h of hits) {
      expect(h.doc_id).toBeTruthy();
      expect(h.node_id).toBeTruthy();
      expect(h.doc_title).toBeTruthy();
      expect(h.node_title).toBeTruthy();
      expect(h.file_path).toBeTruthy();
      expect(typeof h.score).toBe("number");
    }
  });
});

import { dispatchLookup } from "../src/compile-context";

describe("dispatchLookup", () => {
  test("returns the row when key exists", () => {
    const store = makeStoreWithRow();
    const hits = dispatchLookup(store, "PROJ-44");
    expect(hits.length).toBe(1);
    expect(hits[0].source).toBe("rows");
    expect(hits[0].node_id).toBe("PROJ-44");
  });

  test("returns empty array when key not found", () => {
    const store = makeStoreWithRow();
    const hits = dispatchLookup(store, "MISSING-99");
    expect(hits).toEqual([]);
  });
});

// Helper: construct a store with a single row identified by PROJ-44.
// Reuse the same store-population API used by Task 3's makeStoreWithFixtures.
function makeStoreWithRow(): DocumentStore {
  const store = new DocumentStore();
  store.load([
    makeDoc({
      meta: {
        doc_id: "projects-csv",
        file_path: "data/projects.csv",
        title: "Projects",
        description: "Project tracking data",
        collection: "rows",
        facets: { format: ["csv"] },
      },
      tree: [
        makeNode({
          node_id: "header",
          title: "Projects",
          level: 1,
          parent_id: null,
          children: ["PROJ-44"],
          content: "Project tracking table",
          summary: "Project tracking table",
          word_count: 3,
          line_start: 1,
          line_end: 1,
        }),
        makeNode({
          node_id: "PROJ-44",
          title: "PROJ-44 — Authentication Service Upgrade",
          level: 2,
          parent_id: "header",
          children: [],
          content: "Upgrade OAuth library to 3.0 for better security compliance.",
          summary: "OAuth library upgrade for compliance",
          word_count: 12,
          line_start: 2,
          line_end: 2,
        }),
      ],
    }),
  ]);
  return store;
}
