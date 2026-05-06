import { beforeAll, describe, expect, test } from "bun:test";
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

import { dispatchGrep } from "../src/compile-context";

describe("dispatchGrep", () => {
  test("returns matches as hits with line_no", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchGrep(store, "rotateToken", "code", undefined, 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source === "code")).toBe(true);
    expect(hits.every((h) => typeof h.line_no === "number")).toBe(true);
  });

  test("respects top_k limit", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchGrep(store, "rotateToken", "code", undefined, 1);
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  test("doc_title is the actual document title, not the doc_id", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchGrep(store, "rotateToken", "code", undefined, 5);
    expect(hits.length).toBeGreaterThan(0);
    // The fixture sets title: "AuthService" for the code doc with doc_id: "auth-service"
    expect(hits.every((h) => h.doc_title === "AuthService")).toBe(true);
    // Verify it's not just the doc_id
    expect(hits.some((h) => h.doc_id !== h.doc_title)).toBe(true);
  });
});

import { dispatchSymbol } from "../src/compile-context";

describe("dispatchSymbol", () => {
  test("returns code hits with signature when available", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchSymbol(store, "AuthService", undefined, 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source === "code")).toBe(true);
  });

  test("returns empty when no symbol matches", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchSymbol(store, "NonexistentSymbolXYZ", undefined, 5);
    expect(hits).toEqual([]);
  });
});

import { collectOutlines } from "../src/compile-context";

describe("collectOutlines", () => {
  test("returns outlines for the top N unique doc_ids across hits", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchSearch(store, "token rotation", "docs", undefined, 3);
    const outlines = collectOutlines(store, hits, 1);
    expect(outlines.length).toBe(1);
    expect(outlines[0].nodes.length).toBeGreaterThan(0);
    expect(outlines[0].doc_id).toBe(hits[0].doc_id);
  });

  test("returns empty when topN is 0", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchSearch(store, "token rotation", "docs", undefined, 3);
    expect(collectOutlines(store, hits, 0)).toEqual([]);
  });

  test("dedupes by doc_id (multiple hits in one doc → one outline)", () => {
    const store = makeStoreWithFixtures();
    const hits: CompileContextHit[] = [
      { source: "docs", doc_id: "auth-runbook", node_id: "n0", doc_title: "x", node_title: "x", file_path: "x", score: 1 },
      { source: "docs", doc_id: "auth-runbook", node_id: "n1", doc_title: "x", node_title: "x", file_path: "x", score: 0.9 },
    ];
    const outlines = collectOutlines(store, hits, 5);
    expect(outlines.length).toBe(1);
  });
});

import { collectFullContent } from "../src/compile-context";

describe("collectFullContent", () => {
  test("returns full content for top N hits", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchSearch(store, "token rotation", "docs", undefined, 3);
    const blocks = collectFullContent(store, hits, 2);
    expect(blocks.length).toBeLessThanOrEqual(2);
    expect(blocks.every((b) => typeof b.content === "string")).toBe(true);
    expect(blocks.every((b) => b.content.length > 0)).toBe(true);
  });

  test("returns empty when topN is 0", () => {
    const store = makeStoreWithFixtures();
    const hits = dispatchSearch(store, "token rotation", "docs", undefined, 3);
    expect(collectFullContent(store, hits, 0)).toEqual([]);
  });
});

import { formatResult } from "../src/compile-context";

function makeMinimalResult(): CompileContextResult {
  return {
    intent: "token rotation",
    resolved_mode: "search",
    sources: ["docs", "code"],
    duration_ms: 7,
    hits_by_source: {
      docs: [
        {
          source: "docs",
          doc_id: "auth-runbook",
          node_id: "n1",
          doc_title: "Auth Runbook",
          node_title: "Token Rotation",
          file_path: "auth/runbook.md",
          score: 0.0421,
          snippet: "Rotate the JWT signing key, then redeploy.",
        },
      ],
      code: [
        {
          source: "code",
          doc_id: "auth-service",
          node_id: "c1",
          doc_title: "AuthService",
          node_title: "rotateToken",
          file_path: "src/AuthService.ts",
          score: 0.0387,
          signature: "rotateToken() { return this.signer.rotate(); }",
        },
      ],
      rows: [],
    },
    hit_totals_by_source: { docs: 1, code: 1, rows: 0 },
    outlines: [],
    full_content: [],
    trim_notes: [],
    tokens_used_estimate: 100,
    tokens_budget: 2000,
  };
}

describe("formatResult", () => {
  test("emits header with mode + sources + timing", () => {
    const text = formatResult(makeMinimalResult());
    expect(text).toMatch(/compile_context: "token rotation"/);
    expect(text).toMatch(/mode=search/);
    expect(text).toMatch(/sources=\[docs, code\]/);
  });

  test("emits source partition headers in fixed order: docs, code, rows", () => {
    const text = formatResult(makeMinimalResult());
    const docsIdx = text.indexOf("## Hits — docs");
    const codeIdx = text.indexOf("## Hits — code");
    const rowsIdx = text.indexOf("## Hits — rows");
    expect(docsIdx).toBeGreaterThan(-1);
    expect(codeIdx).toBeGreaterThan(docsIdx);
    expect(rowsIdx).toBeGreaterThan(codeIdx);
  });

  test("every hit carries provenance brackets", () => {
    const text = formatResult(makeMinimalResult());
    expect(text).toMatch(/\[auth-runbook → n1\]/);
    expect(text).toMatch(/\[auth-service → c1\]/);
  });

  test("emits Budget section", () => {
    const text = formatResult(makeMinimalResult());
    expect(text).toMatch(/## Budget/);
    expect(text).toMatch(/tokens_used=100 \/ 2000/);
  });

  test("emits Follow-up section", () => {
    const text = formatResult(makeMinimalResult());
    expect(text).toMatch(/## Follow-up/);
    expect(text).toMatch(/get_node_content/);
  });

  test("empty source emits header with (0 of 0)", () => {
    const text = formatResult(makeMinimalResult());
    expect(text).toMatch(/## Hits — rows \(0 of 0\)/);
  });

  test("Full content section omitted when empty", () => {
    const text = formatResult(makeMinimalResult());
    expect(text).not.toMatch(/## Full content/);
  });

  test("Full content section emitted when blocks present", () => {
    const r = makeMinimalResult();
    r.full_content = [
      { doc_id: "auth-runbook", node_id: "n1", node_title: "Token Rotation", content: "Rotate the key." },
    ];
    const text = formatResult(r);
    expect(text).toMatch(/## Full content/);
    expect(text).toMatch(/\[auth-runbook → n1\]/);
  });
});

import { trimToBudget } from "../src/compile-context";

describe("trimToBudget", () => {
  test("returns input unchanged when under budget", () => {
    const r = makeMinimalResult();
    const trimmed = trimToBudget(r, 10000);
    expect(trimmed.hits_by_source.docs.length).toBe(r.hits_by_source.docs.length);
    expect(trimmed.outlines.length).toBe(r.outlines.length);
    expect(trimmed.trim_notes.length).toBe(0);
  });

  test("preserves top-1 per source under tight budget", () => {
    const r = makeMinimalResult();
    // Add several extra hits per source.
    for (let i = 0; i < 5; i++) {
      r.hits_by_source.docs.push({
        source: "docs",
        doc_id: `extra-doc-${i}`,
        node_id: `n${i}`,
        doc_title: "extra",
        node_title: "extra",
        file_path: "extra.md",
        score: 0.001,
        snippet: "x".repeat(200),
      });
    }
    r.hit_totals_by_source.docs = r.hits_by_source.docs.length;
    const trimmed = trimToBudget(r, 50); // very tight
    expect(trimmed.hits_by_source.docs.length).toBeGreaterThanOrEqual(1);
    expect(trimmed.hits_by_source.code.length).toBeGreaterThanOrEqual(1);
    expect(trimmed.trim_notes.length).toBeGreaterThan(0);
  });

  test("drops outlines before snippets, snippets before hits", () => {
    const r = makeMinimalResult();
    r.outlines = [
      {
        doc_id: "auth-runbook",
        doc_title: "Auth Runbook",
        nodes: Array.from({ length: 50 }, (_, i) => ({
          node_id: `n${i}`,
          title: `section ${i}`,
          level: 2,
          word_count: 100,
          summary: "x".repeat(120),
        })),
      },
    ];
    const trimmed = trimToBudget(r, 200);
    // Outlines should be the first thing dropped.
    expect(trimmed.outlines.length).toBeLessThan(r.outlines.length);
  });
});

import { compileContext } from "../src/compile-context";

describe("compileContext (top-level)", () => {
  test("returns result + text for search-mode docs query", () => {
    const store = makeStoreWithFixtures();
    const { result, text } = compileContext(store, {
      intent: "token rotation",
      mode: "search",
      sources: ["docs"],
      output: { top_k_per_source: 3, max_tokens: 2000 },
    });
    expect(result.resolved_mode).toBe("search");
    expect(result.sources).toEqual(["docs"]);
    expect(result.hits_by_source.docs.length).toBeGreaterThan(0);
    expect(text).toContain("## Hits — docs");
  });

  test("auto mode resolves correctly", () => {
    const store = makeStoreWithFixtures();
    const { result } = compileContext(store, {
      intent: "AuthService",
      mode: "auto",
      sources: ["all"],
      output: { top_k_per_source: 3, max_tokens: 2000 },
    });
    expect(result.resolved_mode).toBe("symbol");
  });

  test("'all' sources expands to docs + code + rows", () => {
    const store = makeStoreWithFixtures();
    const { result } = compileContext(store, {
      intent: "token rotation",
      sources: ["all"],
      output: { top_k_per_source: 3, max_tokens: 2000 },
    });
    expect(result.sources).toEqual(["docs", "code", "rows"]);
  });

  test("outlines included for top hits when requested", () => {
    const store = makeStoreWithFixtures();
    const { result } = compileContext(store, {
      intent: "token rotation",
      sources: ["docs"],
      output: { top_k_per_source: 3, include_outlines_for_top: 1, max_tokens: 2000 },
    });
    expect(result.outlines.length).toBeGreaterThan(0);
  });

  test("output is deterministic across repeat calls (modulo timing)", () => {
    const store = makeStoreWithFixtures();
    const { text: t1 } = compileContext(store, {
      intent: "token rotation",
      sources: ["docs"],
      output: { top_k_per_source: 3, max_tokens: 2000 },
    });
    const { text: t2 } = compileContext(store, {
      intent: "token rotation",
      sources: ["docs"],
      output: { top_k_per_source: 3, max_tokens: 2000 },
    });
    const stripTiming = (s: string) => s.replace(/, \d+ ms\)/, ", X ms)");
    expect(stripTiming(t1)).toBe(stripTiming(t2));
  });
});

import { formatSearchResults } from "../src/search-formatter";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../src/tools";

describe("compile_context MCP tool registration", () => {
  test("registers compile_context alongside existing tools without errors", () => {
    const store = makeStoreWithFixtures();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerTools(server, store)).not.toThrow();
  });
});

describe("compileContext edge cases", () => {
  test("empty source partition still emits its header", () => {
    const store = makeStoreWithFixtures();
    const { text } = compileContext(store, {
      intent: "nonexistent-query-no-matches-anywhere-xyz",
      sources: ["docs", "code"],
      output: { top_k_per_source: 3, max_tokens: 2000 },
    });
    expect(text).toMatch(/## Hits — docs \(0 of 0\)/);
    expect(text).toMatch(/## Hits — code \(0 of 0\)/);
  });

  test("lookup mode with mixed sources only addresses rows", () => {
    const store = makeStoreWithRow();
    const { result } = compileContext(store, {
      intent: "PROJ-44",
      mode: "auto",
      sources: ["all"],
      output: { top_k_per_source: 3, max_tokens: 2000 },
    });
    expect(result.resolved_mode).toBe("lookup");
    expect(result.hits_by_source.rows.length).toBe(1);
    expect(result.hits_by_source.docs.length).toBe(0);
    expect(result.hits_by_source.code.length).toBe(0);
  });

  test("filter that excludes everything returns empty hits", () => {
    const store = makeStoreWithFixtures();
    const { result } = compileContext(store, {
      intent: "token rotation",
      sources: ["docs"],
      filters: { type: "no-such-type-xyz" },
      output: { top_k_per_source: 3, max_tokens: 2000 },
    });
    expect(result.hits_by_source.docs.length).toBe(0);
  });

  test("mode=lookup explicit with no key match returns empty", () => {
    const store = makeStoreWithFixtures();
    const { result } = compileContext(store, {
      intent: "MISSING-99",
      mode: "lookup",
      output: { top_k_per_source: 3, max_tokens: 2000 },
    });
    expect(result.hits_by_source.rows.length).toBe(0);
  });

  test("missing CODE_ROOT (no code documents) returns empty code partition", () => {
    const store = makeStoreWithFixtures();
    const { result } = compileContext(store, {
      intent: "this-query-matches-no-code-xyz",
      sources: ["docs", "code"],
      output: { top_k_per_source: 3, max_tokens: 2000 },
    });
    expect(result.hits_by_source.code.length).toBe(0);
  });
});

// ─── Token-win measurement ─────────────────────────────────────────────────
//
// Layer 3: verify that compile_context returns ≥30% fewer bytes than the
// equivalent baseline agent chain on representative skill-style flows.
//
// Baseline chain (what an agent does today, step by step):
//   1. search_documents — rendered via formatSearchResults, which ALREADY
//      inlines the full subtree content of the top 3 results (INLINE_CONTENT_TOP_N=3).
//      This is what the agent actually receives from the tool.
//   2. get_tree on the top-ranked document — indented outline the agent
//      would examine to decide which section to retrieve.
//   3. get_node_content on the top node — the full section text.
//
// The baseline is generous: step 1 already contains inline content, so the
// agent may not always do steps 2+3. But the value claim is that a single
// compile_context call (with outlines for the top 1 result, no full-content
// inline) is shorter than even the bare minimum 3-step chain.
//
// Compose path: compile_context with top_k_per_source=3, include_outlines_for_top=1,
// include_full_content_for_top=0, max_tokens=2000.
// The compose call returns hit snippets + one outline (not full content), and
// applies budget trimming — naturally much more compact.

import { join } from "node:path";
import { indexCollection } from "../src/indexer";
import { indexCodeCollection } from "../src/code-indexer";

// Shared store for the token-win suite (real corpus, loaded once).
let tokenWinStore: DocumentStore;

const TOKEN_WIN_MD_ROOT   = join(import.meta.dir, "fixtures/search-quality/md");
const TOKEN_WIN_CODE_ROOT = join(import.meta.dir, "fixtures/search-quality/code");

beforeAll(async () => {
  const [mdDocs, codeDocs] = await Promise.all([
    indexCollection({ root: TOKEN_WIN_MD_ROOT, name: "docs" }),
    indexCodeCollection({ root: TOKEN_WIN_CODE_ROOT, name: "code" }),
  ]);
  tokenWinStore = new DocumentStore();
  tokenWinStore.load([...mdDocs, ...codeDocs]);
});

// ── Rendering helpers for baseline steps 2 and 3 ────────────────────────
// These mirror the exact text produced by the MCP tool handlers in tools.ts.

/**
 * Mirror of the get_tree handler output (tools.ts lines 246-257).
 * The agent receives this formatted outline after calling get_tree.
 */
function renderTreeLikeGetTree(store: DocumentStore, doc_id: string): string {
  const tree = store.getTree(doc_id);
  if (!tree) return `Document "${doc_id}" not found.`;
  const outline = tree.nodes
    .map((n) => {
      const indent = "  ".repeat(n.level - 1);
      return `${indent}[${n.node_id}] ${"#".repeat(n.level)} ${n.title} (${n.word_count} words)\n${indent}  ${n.summary ? `Summary: ${n.summary.slice(0, 120)}…` : ""}`;
    })
    .join("\n");
  return `Document: ${tree.title}\nDoc ID: ${tree.doc_id}\nSections: ${tree.nodes.length}\n\n${outline}\n\nTo read a section's full content, call get_node_content("${doc_id}", ["node_id"]).\nTo get a section and all its subsections, call navigate_tree("${doc_id}", "node_id").`;
}

/**
 * Mirror of the get_node_content handler output (tools.ts lines 304-308).
 * The agent receives this after calling get_node_content with a single node.
 */
function renderNodeContentLikeGetNodeContent(
  store: DocumentStore,
  doc_id: string,
  node_id: string
): string {
  const result = store.getNodeContent(doc_id, [node_id]);
  if (!result || result.nodes.length === 0) return `No node found for ${node_id}.`;
  return result.nodes
    .map(
      (n) =>
        `━━━ ${n.title} [${n.node_id}] (H${n.level}) ━━━\n\n${n.content || "(empty section)"}`
    )
    .join("\n\n");
}

describe("compile_context token-win vs. baseline chain", () => {
  // Each flow models a typical skill-driven multi-step retrieve loop:
  //   (a) search_documents to find candidates — agent receives ranked snippets
  //       PLUS inlined full subtree content for top 3 (the actual tool output)
  //   (b) get_tree on the top result for outline inspection
  //   (c) get_node_content on the chosen section
  // We use the actual rendering functions to measure bytes the agent receives.
  const flows: Array<{
    intent: string;
    filters: Record<string, string | string[]> | undefined;
  }> = [
    { intent: "auth token rotation", filters: { type: "runbook" } },
    { intent: "incident response procedure", filters: { type: "runbook" } },
    { intent: "AuthService", filters: undefined },
    { intent: "rate limiter implementation", filters: undefined },
    { intent: "deploy freeze policy", filters: { type: "guide" } },
    { intent: "JWT signing key", filters: undefined },
    { intent: "database migration runbook", filters: { type: "runbook" } },
    { intent: "feature flag rollout", filters: undefined },
    { intent: "circuit breaker pattern", filters: undefined },
    { intent: "oncall escalation", filters: { type: "guide" } },
  ];

  test("compile_context returns ≥30% fewer tokens on average", () => {
    let baselineTotalBytes = 0;
    let composeTotalBytes = 0;

    for (const flow of flows) {
      // ── Baseline: search → get_tree → get_node_content ──────────────
      //
      // Step 1: search_documents output.
      // formatSearchResults already inlines full subtree content for the top 3
      // hits — this is exactly what the agent receives from the tool.
      const searchResults = tokenWinStore.searchDocuments(flow.intent, {
        limit: 3,
        filters: flow.filters,
      });
      const baselineSearchText = formatSearchResults(
        searchResults,
        tokenWinStore,
        flow.intent
      );

      // Step 2: get_tree on the top result's document.
      // Agent calls this to examine the outline before choosing a node.
      let baselineTreeText = "";
      if (searchResults.length > 0) {
        baselineTreeText = renderTreeLikeGetTree(
          tokenWinStore,
          searchResults[0].doc_id
        );
      }

      // Step 3: get_node_content on the top hit's node.
      // Agent calls this after inspecting the tree.
      let baselineContentText = "";
      if (searchResults.length > 0) {
        baselineContentText = renderNodeContentLikeGetNodeContent(
          tokenWinStore,
          searchResults[0].doc_id,
          searchResults[0].node_id
        );
      }

      const baselineText = [baselineSearchText, baselineTreeText, baselineContentText]
        .filter(Boolean)
        .join("\n\n");
      baselineTotalBytes += Buffer.byteLength(baselineText, "utf8");

      // ── Compose: single compile_context call ─────────────────────────
      //
      // Returns hit snippets (no full-content inline) + one document outline.
      // Budget trimming keeps it compact.
      const { text: composeText } = compileContext(tokenWinStore, {
        intent: flow.intent,
        sources: ["all"],
        filters: flow.filters,
        output: {
          top_k_per_source: 3,
          include_outlines_for_top: 1,
          include_full_content_for_top: 0,
          max_tokens: 2000,
        },
      });
      composeTotalBytes += Buffer.byteLength(composeText, "utf8");
    }

    const reduction = (baselineTotalBytes - composeTotalBytes) / baselineTotalBytes;
    console.log(
      `Token-win: baseline=${baselineTotalBytes}b compose=${composeTotalBytes}b reduction=${(reduction * 100).toFixed(1)}%`
    );
    expect(reduction).toBeGreaterThanOrEqual(0.30);
  });
});
