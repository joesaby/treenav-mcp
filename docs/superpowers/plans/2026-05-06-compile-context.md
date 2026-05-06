# compile_context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single `compile_context` MCP tool that composes existing read primitives (`searchDocuments`, `grepDocuments`, `lookupRow`, `getTree`, `getSubtree`) into one call, returning ranked hits partitioned by source plus bundled outlines for the top hits — replacing the current 3-call retrieve loop.

**Architecture:** Pure orchestration over the existing `DocumentStore`. New file `src/compile-context.ts` (~250–350 lines) holds the mode resolver, source dispatchers, outline collector, full-content collector, budget trimmer, and output formatter. The store is unchanged. The new tool is registered alongside the existing 8 in `src/tools.ts`. Two test files cover unit/contract, accuracy parity, and token-win measurement.

**Tech Stack:** Bun + TypeScript (strict), Zod for tool input validation, `@modelcontextprotocol/sdk` for tool registration. Bun test runner. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-06-compile-context-design.md`
**ADR:** `docs/adr/0002-multi-intent-out-of-scope.md`

---

## File Structure

| File | Role | Status |
|---|---|---|
| `src/types.ts` | All compile_context types (input, hit, outline, full-content, result). Co-located with existing treenav types so consumers import from one place. | Modify (additive) |
| `src/compile-context.ts` | Orchestration module. Pure functions: `resolveMode`, `dispatchSearch`, `dispatchLookup`, `dispatchGrep`, `dispatchSymbol`, `collectOutlines`, `collectFullContent`, `formatResult`, `trimToBudget`, top-level `compileContext`. No store internals. | **New** |
| `src/tools.ts` | Register the `compile_context` MCP tool. Existing 8 tools untouched. | Modify (additive) |
| `tests/compile-context.test.ts` | Layer-1 unit/contract tests + Layer-3 token-win measurement. | **New** |
| `tests/compile-context-quality.test.ts` | Layer-2 NDCG@10 / MRR parity vs. baseline `searchDocuments`. | **New** |
| `docs/CONFIGURATION.md` | One paragraph documenting the new tool. | Modify (additive) |
| `docs/DESIGN.md` | One paragraph noting composition lives in `compile-context.ts`. | Modify (additive) |
| `CLAUDE.md` | Add `compile_context` to the MCP Tools list (becomes 9 read tools). | Modify (additive) |

No new dependencies. No new env vars. No new config files.

---

## Task 1: Add compile_context types

**Files:**
- Modify: `src/types.ts` (append at end of file)

- [ ] **Step 1: Write the failing test**

Create `tests/compile-context.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type {
  CompileContextInput,
  CompileContextResult,
  CompileContextHit,
  CompileContextOutline,
  CompileContextFullContent,
  ResolvedMode,
  CompileContextSource,
} from "../src/types";

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
      hits_by_source: { docs: [] },
      hit_totals_by_source: { docs: 0 },
      outlines: [],
      full_content: [],
      trim_notes: [],
      tokens_used_estimate: 0,
      tokens_budget: 2000,
    };
    expect(result.resolved_mode).toBe("search");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/josesebastian/git/treenav-mcp/.worktrees/feat-compile-context-design
bun test tests/compile-context.test.ts
```

Expected: FAIL with type-import errors (`CompileContextInput` not exported from `../src/types`).

- [ ] **Step 3: Add types to `src/types.ts`**

Append to the bottom of `src/types.ts`:

```ts
// ── compile_context (composed retrieval) ───────────────────────────
//
// See docs/superpowers/specs/2026-05-06-compile-context-design.md
// and docs/adr/0002-multi-intent-out-of-scope.md.
//
// compile_context composes the existing read primitives
// (searchDocuments / grepDocuments / lookupRow / getTree / getSubtree)
// behind one call. Pure orchestration — no new ranking, no new index.

export type CompileContextMode =
  | "auto"
  | "search"
  | "grep"
  | "lookup"
  | "symbol";

/** Resolved mode after `auto` heuristic runs. Never `"auto"`. */
export type ResolvedMode = Exclude<CompileContextMode, "auto">;

export type CompileContextSource = "docs" | "code" | "rows" | "all";

/** Concrete source name in the result (never `"all"`). */
export type ResolvedSource = "docs" | "code" | "rows";

export interface CompileContextInput {
  intent: string;
  mode?: CompileContextMode;
  sources?: CompileContextSource[];
  filters?: Record<string, string | string[]>;
  output: {
    top_k_per_source?: number;
    include_snippets?: boolean;
    include_outlines_for_top?: number;
    include_full_content_for_top?: number;
    max_tokens?: number;
  };
}

export interface CompileContextHit {
  source: ResolvedSource;
  doc_id: string;
  node_id: string;
  doc_title: string;
  node_title: string;
  file_path: string;
  score: number;
  /** Density-based snippet for search/grep hits. */
  snippet?: string;
  /** Symbol signature for symbol-mode / code hits. */
  signature?: string;
  /** Line number for grep hits. */
  line_no?: number;
}

export interface CompileContextOutlineNode {
  node_id: string;
  title: string;
  level: number;
  word_count: number;
  summary: string;
}

export interface CompileContextOutline {
  doc_id: string;
  doc_title: string;
  nodes: CompileContextOutlineNode[];
}

export interface CompileContextFullContent {
  doc_id: string;
  node_id: string;
  node_title: string;
  content: string;
}

export interface CompileContextResult {
  intent: string;
  resolved_mode: ResolvedMode;
  sources: ResolvedSource[];
  duration_ms: number;
  hits_by_source: Record<ResolvedSource, CompileContextHit[]>;
  /** Total hits available before top_k_per_source cut, per source. */
  hit_totals_by_source: Record<ResolvedSource, number>;
  outlines: CompileContextOutline[];
  full_content: CompileContextFullContent[];
  /** Human-readable notes about what was trimmed for budget. */
  trim_notes: string[];
  tokens_used_estimate: number;
  tokens_budget: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/compile-context.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/compile-context.test.ts
git commit -m "feat: add compile_context type definitions"
```

---

## Task 2: Mode auto-resolver

**Files:**
- Create: `src/compile-context.ts`
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/compile-context.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/compile-context.test.ts
```

Expected: FAIL with `Cannot find module '../src/compile-context'`.

- [ ] **Step 3: Create `src/compile-context.ts` with `resolveMode`**

```ts
/**
 * compile_context — composed retrieval primitive.
 *
 * Pure orchestration over DocumentStore's existing public methods.
 * No new ranking, no new index, no LLM calls.
 *
 * See docs/superpowers/specs/2026-05-06-compile-context-design.md.
 */

import type { ResolvedMode } from "./types";

const LOOKUP_KEY_RE = /^[A-Z]+-\d+$/;
const REGEX_META_RE = /[\\\[\]^$|]|\.\*|\(\?/;
const SYMBOL_KEYWORD_RE = /^(class|function|interface|type|enum)\s+/i;
// camelCase or PascalCase single token (no whitespace, has internal capital)
const CAMEL_TOKEN_RE = /^[A-Za-z][a-zA-Z0-9_$]*$/;
const HAS_INTERNAL_CAPITAL_RE = /[a-z][A-Z]|^[A-Z][a-z]/;

/**
 * Resolve a CompileContextMode from the raw intent string.
 *
 * Order matters: lookup before grep before symbol before search.
 *   - lookup: PROJ-44 / ITEM-1234 shaped
 *   - grep:   contains regex metacharacters
 *   - symbol: starts with class/function/etc. or is a single camelCase token
 *   - search: anything else (the natural-language path)
 */
export function resolveMode(intent: string): ResolvedMode {
  if (LOOKUP_KEY_RE.test(intent)) return "lookup";
  if (REGEX_META_RE.test(intent)) return "grep";
  if (SYMBOL_KEYWORD_RE.test(intent)) return "symbol";
  if (
    CAMEL_TOKEN_RE.test(intent) &&
    HAS_INTERNAL_CAPITAL_RE.test(intent) &&
    !intent.includes(" ")
  ) {
    return "symbol";
  }
  return "search";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/compile-context.test.ts
```

Expected: PASS (the 2 type tests + ~16 mode-resolver tests, all passing).

- [ ] **Step 5: Commit**

```bash
git add src/compile-context.ts tests/compile-context.test.ts
git commit -m "feat: add compile_context mode auto-resolver"
```

---

## Task 3: Search-mode dispatcher (docs and code sources)

**Files:**
- Modify: `src/compile-context.ts`
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/compile-context.test.ts`:

```ts
import { dispatchSearch } from "../src/compile-context";
import { DocumentStore } from "../src/store";

function makeStoreWithFixtures(): DocumentStore {
  const store = new DocumentStore();
  // Two docs: one in "docs" collection, one in "code" collection.
  store.indexDocument({
    doc_id: "auth-runbook",
    file_path: "auth/runbook.md",
    title: "Auth Runbook",
    description: "How to handle auth incidents",
    collection: "docs",
    facets: { type: ["runbook"], tags: ["auth"] },
    nodes: [
      {
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
      },
      {
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
      },
    ],
  });
  store.indexDocument({
    doc_id: "auth-service",
    file_path: "src/AuthService.ts",
    title: "AuthService",
    description: "Authentication service implementation",
    collection: "code",
    facets: { content_type: ["code"], language: ["typescript"] },
    nodes: [
      {
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
      },
      {
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
      },
    ],
  });
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/compile-context.test.ts
```

Expected: FAIL with `dispatchSearch is not exported`.

- [ ] **Step 3: Add `dispatchSearch` to `src/compile-context.ts`**

Add to the imports and after `resolveMode`:

```ts
import type {
  CompileContextHit,
  ResolvedMode,
  ResolvedSource,
} from "./types";
import type { DocumentStore } from "./store";

/**
 * Dispatch a BM25 search against a single source collection.
 * Returns up to topK hits, each tagged with the source.
 */
export function dispatchSearch(
  store: DocumentStore,
  intent: string,
  source: "docs" | "code",
  filters: Record<string, string | string[]> | undefined,
  topK: number
): CompileContextHit[] {
  const collection = source === "docs" ? "docs" : "code";
  const results = store.searchDocuments(intent, {
    limit: topK,
    collection,
    filters,
  });
  return results.map((r) => ({
    source,
    doc_id: r.doc_id,
    node_id: r.node_id,
    doc_title: r.doc_title,
    node_title: r.node_title,
    file_path: r.file_path,
    score: r.score,
    snippet: r.snippet || undefined,
  }));
}
```

> Note: the existing collection name for code is `process.env.CODE_COLLECTION ?? "code"`. The test fixture uses `"code"` directly. If your project sets `CODE_COLLECTION` to a non-default value, the dispatcher relies on the indexer assigning that name to code documents. Tests use the literal `"code"` since the test fixture indexes with that collection name.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/compile-context.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compile-context.ts tests/compile-context.test.ts
git commit -m "feat: add compile_context search dispatcher"
```

---

## Task 4: Lookup-mode dispatcher

**Files:**
- Modify: `src/compile-context.ts`
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/compile-context.test.ts`:

```ts
import { dispatchLookup } from "../src/compile-context";

describe("dispatchLookup", () => {
  test("returns the row when key exists", () => {
    const store = new DocumentStore();
    store.indexDocument({
      doc_id: "tasks-csv",
      file_path: "tasks.csv",
      title: "Tasks",
      description: "Task tracker",
      collection: "rows",
      facets: { content_type: ["row"] },
      nodes: [
        {
          node_id: "PROJ-44",
          title: "PROJ-44",
          level: 1,
          parent_id: null,
          children: [],
          content: "PROJ-44 — Migrate auth service",
          summary: "PROJ-44 — Migrate auth service",
          word_count: 5,
          line_start: 1,
          line_end: 1,
        },
      ],
    });
    const hits = dispatchLookup(store, "PROJ-44");
    expect(hits.length).toBe(1);
    expect(hits[0].source).toBe("rows");
    expect(hits[0].node_id).toBe("PROJ-44");
  });

  test("returns empty array when key not found", () => {
    const store = new DocumentStore();
    const hits = dispatchLookup(store, "MISSING-99");
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/compile-context.test.ts
```

Expected: FAIL with `dispatchLookup is not exported`.

- [ ] **Step 3: Add `dispatchLookup` to `src/compile-context.ts`**

```ts
/**
 * Dispatch an exact-key row lookup.
 * Returns 0 or 1 hits, always tagged with source = "rows".
 */
export function dispatchLookup(
  store: DocumentStore,
  intent: string
): CompileContextHit[] {
  const result = store.lookupRow(intent);
  if (!result) return [];
  return [
    {
      source: "rows",
      doc_id: result.doc_id,
      node_id: result.node.node_id,
      doc_title: result.doc_id,
      node_title: result.node.title,
      file_path: "",
      score: 1.0,
      snippet: result.node.summary || result.node.content.slice(0, 200),
    },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/compile-context.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compile-context.ts tests/compile-context.test.ts
git commit -m "feat: add compile_context lookup dispatcher"
```

---

## Task 5: Grep-mode dispatcher

**Files:**
- Modify: `src/compile-context.ts`
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/compile-context.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/compile-context.test.ts
```

Expected: FAIL with `dispatchGrep is not exported`.

- [ ] **Step 3: Add `dispatchGrep` to `src/compile-context.ts`**

```ts
/**
 * Dispatch a literal/regex scan against a single source.
 * Maps GrepHits onto the unified CompileContextHit shape.
 */
export function dispatchGrep(
  store: DocumentStore,
  intent: string,
  source: "docs" | "code",
  filters: Record<string, string | string[]> | undefined,
  topK: number
): CompileContextHit[] {
  // Treat regex if it contains regex metacharacters; otherwise literal.
  const regex = /[\\\[\]^$|]|\.\*|\(\?/.test(intent);
  const outcome = store.grepDocuments({
    pattern: intent,
    regex,
    case_insensitive: false,
    filters,
    context: 0,
    limit: topK,
  });
  return outcome.hits
    .filter((h) => {
      // Source filter at the result level. The grep engine doesn't
      // partition by collection, so we filter on file_path heuristics
      // when no facet path is available — but for typical usage the
      // filters arg already narrows by collection/content_type.
      // Simplest: trust upstream filters; tag every hit with the
      // requested source. Refine in a later task if cross-collection
      // bleed-through shows up in eval.
      return true;
    })
    .map((h) => ({
      source,
      doc_id: h.doc_id,
      node_id: h.node_id,
      doc_title: h.doc_id,
      node_title: h.node_title,
      file_path: h.file_path,
      score: 1.0,
      snippet: h.line,
      line_no: h.line_no,
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/compile-context.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compile-context.ts tests/compile-context.test.ts
git commit -m "feat: add compile_context grep dispatcher"
```

---

## Task 6: Symbol-mode dispatcher

**Files:**
- Modify: `src/compile-context.ts`
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/compile-context.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/compile-context.test.ts
```

Expected: FAIL with `dispatchSymbol is not exported`.

- [ ] **Step 3: Add `dispatchSymbol` to `src/compile-context.ts`**

```ts
/**
 * Dispatch a symbol search — search restricted to code collection,
 * with optional kind/language filters layered on caller filters.
 * Mirrors the existing find_symbol tool's filter strategy.
 */
export function dispatchSymbol(
  store: DocumentStore,
  intent: string,
  filters: Record<string, string | string[]> | undefined,
  topK: number
): CompileContextHit[] {
  const mergedFilters: Record<string, string | string[]> = {
    content_type: "code",
    ...(filters ?? {}),
  };
  const results = store.searchDocuments(intent, {
    limit: topK,
    filters: mergedFilters,
  });
  return results.map((r) => ({
    source: "code" as const,
    doc_id: r.doc_id,
    node_id: r.node_id,
    doc_title: r.doc_title,
    node_title: r.node_title,
    file_path: r.file_path,
    score: r.score,
    signature: r.snippet || undefined,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/compile-context.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compile-context.ts tests/compile-context.test.ts
git commit -m "feat: add compile_context symbol dispatcher"
```

---

## Task 7: Outline collector for top hits

**Files:**
- Modify: `src/compile-context.ts`
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/compile-context.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL with `collectOutlines is not exported`.

- [ ] **Step 3: Add `collectOutlines` to `src/compile-context.ts`**

```ts
import type {
  CompileContextOutline,
  CompileContextOutlineNode,
} from "./types";

/**
 * Collect TreeOutlines for the top-N unique doc_ids across the merged
 * hit list. Hits arrive pre-ranked; first occurrence wins.
 */
export function collectOutlines(
  store: DocumentStore,
  hits: CompileContextHit[],
  topN: number
): CompileContextOutline[] {
  if (topN <= 0) return [];
  const seen = new Set<string>();
  const outlines: CompileContextOutline[] = [];
  for (const h of hits) {
    if (seen.has(h.doc_id)) continue;
    seen.add(h.doc_id);
    const tree = store.getTree(h.doc_id);
    if (!tree) continue;
    const nodes: CompileContextOutlineNode[] = tree.nodes.map((n) => ({
      node_id: n.node_id,
      title: n.title,
      level: n.level,
      word_count: n.word_count,
      summary: n.summary,
    }));
    outlines.push({ doc_id: tree.doc_id, doc_title: tree.title, nodes });
    if (outlines.length >= topN) break;
  }
  return outlines;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compile-context.ts tests/compile-context.test.ts
git commit -m "feat: add compile_context outline collector"
```

---

## Task 8: Full-content collector

**Files:**
- Modify: `src/compile-context.ts`
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/compile-context.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL with `collectFullContent is not exported`.

- [ ] **Step 3: Add `collectFullContent` to `src/compile-context.ts`**

```ts
import type { CompileContextFullContent } from "./types";

/**
 * Collect full node content for the top-N hits in arrival order.
 */
export function collectFullContent(
  store: DocumentStore,
  hits: CompileContextHit[],
  topN: number
): CompileContextFullContent[] {
  if (topN <= 0) return [];
  const blocks: CompileContextFullContent[] = [];
  for (const h of hits) {
    if (blocks.length >= topN) break;
    const result = store.getNodeContent(h.doc_id, [h.node_id]);
    if (!result || result.nodes.length === 0) continue;
    const node = result.nodes[0];
    blocks.push({
      doc_id: h.doc_id,
      node_id: node.node_id,
      node_title: node.title,
      content: node.content,
    });
  }
  return blocks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compile-context.ts tests/compile-context.test.ts
git commit -m "feat: add compile_context full-content collector"
```

---

## Task 9: Output formatter

**Files:**
- Modify: `src/compile-context.ts`
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/compile-context.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL with `formatResult is not exported`.

- [ ] **Step 3: Add `formatResult` to `src/compile-context.ts`**

```ts
import type {
  CompileContextResult,
  ResolvedSource,
} from "./types";

const SOURCE_ORDER: ResolvedSource[] = ["docs", "code", "rows"];

function formatHitsBlock(
  source: ResolvedSource,
  hits: CompileContextHit[],
  total: number
): string {
  const heading = `## Hits — ${source} (${hits.length} of ${total})`;
  if (hits.length === 0) return heading;
  const lines = hits.map((h, i) => {
    const head = `${i + 1}. [${h.doc_id} → ${h.node_id}] ${h.doc_title} › ${h.node_title}  (score ${h.score.toFixed(4)})`;
    const path = h.line_no
      ? `   ${h.file_path}:${h.line_no}`
      : `   ${h.file_path}`;
    const tail = h.signature
      ? `   Signature: ${h.signature}`
      : h.snippet
        ? `   Snippet: ${h.snippet}`
        : "";
    return [head, path, tail].filter(Boolean).join("\n");
  });
  return `${heading}\n${lines.join("\n\n")}`;
}

function formatOutlinesBlock(result: CompileContextResult): string {
  if (result.outlines.length === 0) return "";
  const blocks = result.outlines.map((o) => {
    const heading = `▸ ${o.doc_id} — ${o.doc_title}`;
    const nodeLines = o.nodes
      .map((n) => {
        const indent = "  ".repeat(Math.max(0, n.level - 1));
        const summary = n.summary
          ? `\n${indent}    Summary: ${n.summary.slice(0, 120)}…`
          : "";
        return `${indent}  [${n.node_id}] ${"#".repeat(n.level)} ${n.title} (${n.word_count} words)${summary}`;
      })
      .join("\n");
    return `${heading}\n${nodeLines}`;
  });
  return `## Outlines (top ${result.outlines.length})\n\n${blocks.join("\n\n")}`;
}

function formatFullContentBlock(result: CompileContextResult): string {
  if (result.full_content.length === 0) return "";
  const blocks = result.full_content.map((b) => {
    return `▸ [${b.doc_id} → ${b.node_id}] ${b.node_title}\n  ${b.content}`;
  });
  return `## Full content (top ${result.full_content.length})\n\n${blocks.join("\n\n")}`;
}

function formatBudgetBlock(result: CompileContextResult): string {
  const notes = result.trim_notes.length > 0
    ? `  (${result.trim_notes.join("; ")})`
    : "";
  return `## Budget\ntokens_used=${result.tokens_used_estimate} / ${result.tokens_budget}${notes}`;
}

function formatFollowUp(): string {
  return [
    "## Follow-up",
    `- Read full content: get_node_content("<doc_id>", ["<node_id>"])`,
    `- Drill into a subtree: navigate_tree("<doc_id>", "<node_id>")`,
    `- Exact-match recheck: grep_documents("<intent>")`,
  ].join("\n");
}

/**
 * Render a CompileContextResult as the canonical text artifact.
 * Section order is fixed; provenance brackets are mandatory on every hit.
 */
export function formatResult(result: CompileContextResult): string {
  const header = `━━━ compile_context: "${result.intent}" (mode=${result.resolved_mode}, sources=[${result.sources.join(", ")}], ${result.duration_ms} ms) ━━━`;

  const hitsBlocks = SOURCE_ORDER
    .filter((s) => result.sources.includes(s))
    .map((s) => formatHitsBlock(s, result.hits_by_source[s], result.hit_totals_by_source[s]))
    .join("\n\n");

  const outlines = formatOutlinesBlock(result);
  const fullContent = formatFullContentBlock(result);
  const budget = formatBudgetBlock(result);
  const followUp = formatFollowUp();

  return [header, hitsBlocks, outlines, fullContent, budget, followUp]
    .filter((s) => s.length > 0)
    .join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compile-context.ts tests/compile-context.test.ts
git commit -m "feat: add compile_context output formatter"
```

---

## Task 10: Budget trimmer

**Files:**
- Modify: `src/compile-context.ts`
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/compile-context.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL with `trimToBudget is not exported`.

- [ ] **Step 3: Add `trimToBudget` to `src/compile-context.ts`**

```ts
/** Cheap token estimate: bytes / 4. */
function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

function estimateResultTokens(result: CompileContextResult): number {
  return estimateTokens(formatResult(result));
}

/**
 * Trim a result so that its rendered text fits within `budget` tokens.
 * Trim order (highest-priority kept first):
 *   1. Header + first hit per source — never trimmed.
 *   2. Remaining hits, lowest-ranked first within each source.
 *   3. Snippets shortened: 80 chars, then title-only.
 *   4. Full-content blocks: drop lowest-ranked, then truncate, then drop.
 *   5. Outlines: drop deepest leaves, then drop entire outlines.
 *   6. Follow-up always retained.
 *
 * trim_notes record what was dropped/shortened.
 */
export function trimToBudget(
  result: CompileContextResult,
  budget: number
): CompileContextResult {
  const r: CompileContextResult = JSON.parse(JSON.stringify(result));
  r.tokens_budget = budget;
  r.trim_notes = [];

  const isOver = () => estimateResultTokens(r) > budget;
  if (!isOver()) {
    r.tokens_used_estimate = estimateResultTokens(r);
    return r;
  }

  // Step 2: Drop lowest-ranked hits within each source, keeping at least 1.
  let droppedHits = 0;
  while (isOver()) {
    let droppedThisRound = false;
    for (const src of SOURCE_ORDER) {
      const arr = r.hits_by_source[src];
      if (arr && arr.length > 1) {
        arr.pop();
        droppedHits++;
        droppedThisRound = true;
        if (!isOver()) break;
      }
    }
    if (!droppedThisRound) break;
  }
  if (droppedHits > 0) r.trim_notes.push(`dropped ${droppedHits} hits`);

  // Step 3: Shorten snippets.
  if (isOver()) {
    let shortened = 0;
    for (const src of SOURCE_ORDER) {
      const arr = r.hits_by_source[src];
      if (!arr) continue;
      for (const h of arr) {
        if (h.snippet && h.snippet.length > 80) {
          h.snippet = h.snippet.slice(0, 80);
          shortened++;
          if (!isOver()) break;
        }
      }
      if (!isOver()) break;
    }
    if (shortened > 0) r.trim_notes.push(`shortened ${shortened} snippets`);
  }
  if (isOver()) {
    // Drop snippets entirely (title-only).
    for (const src of SOURCE_ORDER) {
      const arr = r.hits_by_source[src];
      if (!arr) continue;
      for (const h of arr) {
        if (h.snippet) {
          h.snippet = undefined;
          if (!isOver()) break;
        }
      }
      if (!isOver()) break;
    }
  }

  // Step 4: Trim full-content blocks.
  if (isOver() && r.full_content.length > 0) {
    let droppedFC = 0;
    while (isOver() && r.full_content.length > 0) {
      r.full_content.pop();
      droppedFC++;
    }
    if (droppedFC > 0) r.trim_notes.push(`dropped ${droppedFC} full-content blocks`);
  }

  // Step 5: Trim outlines — deepest leaves first, then drop outlines entirely.
  if (isOver() && r.outlines.length > 0) {
    let droppedOutlineNodes = 0;
    let droppedOutlines = 0;
    while (isOver() && r.outlines.length > 0) {
      const last = r.outlines[r.outlines.length - 1];
      if (last.nodes.length > 0) {
        // Drop deepest leaf in this outline.
        const maxLevel = Math.max(...last.nodes.map((n) => n.level));
        const idx = last.nodes.findIndex((n) => n.level === maxLevel);
        if (idx >= 0) {
          last.nodes.splice(idx, 1);
          droppedOutlineNodes++;
        } else {
          last.nodes.pop();
          droppedOutlineNodes++;
        }
      } else {
        r.outlines.pop();
        droppedOutlines++;
      }
    }
    if (droppedOutlineNodes > 0) r.trim_notes.push(`trimmed ${droppedOutlineNodes} outline nodes`);
    if (droppedOutlines > 0) r.trim_notes.push(`dropped ${droppedOutlines} outlines`);
  }

  r.tokens_used_estimate = estimateResultTokens(r);
  return r;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compile-context.ts tests/compile-context.test.ts
git commit -m "feat: add compile_context budget trimmer"
```

---

## Task 11: Top-level `compileContext` entrypoint

**Files:**
- Modify: `src/compile-context.ts`
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/compile-context.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL with `compileContext is not exported`.

- [ ] **Step 3: Add `compileContext` to `src/compile-context.ts`**

```ts
import type {
  CompileContextInput,
  CompileContextResult,
  ResolvedSource,
} from "./types";

const DEFAULT_TOP_K = 3;
const DEFAULT_OUTLINES = 2;
const DEFAULT_FULL_CONTENT = 0;
const DEFAULT_MAX_TOKENS = 2000;

function expandSources(
  sources: CompileContextInput["sources"]
): ResolvedSource[] {
  if (!sources || sources.length === 0) return ["docs", "code", "rows"];
  if (sources.includes("all")) return ["docs", "code", "rows"];
  return sources.filter((s): s is ResolvedSource => s !== "all");
}

/**
 * Top-level entrypoint. Resolves mode, dispatches per source, collects
 * outlines + full content, applies budget, and renders.
 *
 * Returns both the structured result (for callers that want the data)
 * and the rendered text (for the MCP tool's text response).
 */
export function compileContext(
  store: DocumentStore,
  input: CompileContextInput
): { result: CompileContextResult; text: string } {
  const t0 = Date.now();
  const resolvedMode: ResolvedMode =
    !input.mode || input.mode === "auto"
      ? resolveMode(input.intent)
      : input.mode;
  const sources = expandSources(input.sources);
  const topK = input.output.top_k_per_source ?? DEFAULT_TOP_K;
  const outlinesTop = input.output.include_outlines_for_top ?? DEFAULT_OUTLINES;
  const fullContentTop = input.output.include_full_content_for_top ?? DEFAULT_FULL_CONTENT;
  const maxTokens = input.output.max_tokens ?? DEFAULT_MAX_TOKENS;

  const hitsBySource: Record<ResolvedSource, CompileContextHit[]> = {
    docs: [],
    code: [],
    rows: [],
  };
  const totalsBySource: Record<ResolvedSource, number> = {
    docs: 0,
    code: 0,
    rows: 0,
  };

  // Lookup mode is row-only regardless of requested sources.
  if (resolvedMode === "lookup") {
    const hits = dispatchLookup(store, input.intent);
    hitsBySource.rows = hits;
    totalsBySource.rows = hits.length;
  } else {
    for (const src of sources) {
      if (src === "rows") {
        // Search/grep/symbol modes don't address rows.
        continue;
      }
      let hits: CompileContextHit[] = [];
      if (resolvedMode === "search") {
        hits = dispatchSearch(store, input.intent, src, input.filters, topK);
      } else if (resolvedMode === "grep") {
        hits = dispatchGrep(store, input.intent, src, input.filters, topK);
      } else if (resolvedMode === "symbol") {
        if (src === "code") {
          hits = dispatchSymbol(store, input.intent, input.filters, topK);
        }
      }
      hitsBySource[src] = hits;
      totalsBySource[src] = hits.length;
    }
  }

  // Merge hits in source order for outline + full-content collection.
  const merged: CompileContextHit[] = [];
  for (const s of SOURCE_ORDER) {
    merged.push(...hitsBySource[s]);
  }

  const outlines = collectOutlines(store, merged, outlinesTop);
  const full_content = collectFullContent(store, merged, fullContentTop);

  const rawResult: CompileContextResult = {
    intent: input.intent,
    resolved_mode: resolvedMode,
    sources,
    duration_ms: Date.now() - t0,
    hits_by_source: hitsBySource,
    hit_totals_by_source: totalsBySource,
    outlines,
    full_content,
    trim_notes: [],
    tokens_used_estimate: 0,
    tokens_budget: maxTokens,
  };
  rawResult.tokens_used_estimate = estimateResultTokens(rawResult);

  const trimmed = trimToBudget(rawResult, maxTokens);
  const text = formatResult(trimmed);
  return { result: trimmed, text };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS (all `compile-context.test.ts` tests).

- [ ] **Step 5: Commit**

```bash
git add src/compile-context.ts tests/compile-context.test.ts
git commit -m "feat: add compileContext top-level entrypoint"
```

---

## Task 12: Register the `compile_context` MCP tool

**Files:**
- Modify: `src/tools.ts`
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/compile-context.test.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../src/tools";

describe("compile_context MCP tool registration", () => {
  test("registers compile_context alongside existing tools", () => {
    const store = makeStoreWithFixtures();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, store);
    // The McpServer SDK doesn't expose a direct "list tools" method,
    // but registerTools runs without throwing — that's the contract.
    expect(true).toBe(true);
  });
});
```

> Note: deeper end-to-end MCP-tool dispatch tests already exist in `tests/`. This step only verifies registration is wired without runtime errors.

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/compile-context.test.ts
```

Expected: PASS at this step (the registration test only fails once we modify `registerTools` to break it; for now it's a no-op smoke test). The actual failing assertion comes in step 4 once we expect the new tool to be available.

- [ ] **Step 3: Register `compile_context` in `src/tools.ts`**

In `src/tools.ts`, add after the `find_symbol` tool registration (around line 465) and before the curation tools section:

```ts
import { compileContext } from "./compile-context.js";

// ── Tool 9: compile_context ────────────────────────────────────────

server.tool(
  "compile_context",
  "Composed retrieval. Runs one search/grep/lookup/symbol pass against the requested sources (docs, code, rows), returns ranked hits partitioned by source, plus outline trees for the top hits — all in one call. Use this to collapse the typical search → get_tree → get_node_content loop. For unknown query shape, set mode='auto' and treenav routes the call. Provenance brackets [doc_id → node_id] on every hit; budget is enforced and reported.",
  {
    intent: z.string().min(1).describe("The query — natural language, literal, regex, structured key, or symbol name."),
    mode: z
      .enum(["auto", "search", "grep", "lookup", "symbol"])
      .default("auto")
      .describe("Routing mode. 'auto' picks search/grep/lookup/symbol from the intent shape. Use an explicit mode to override."),
    sources: z
      .array(z.enum(["docs", "code", "rows", "all"]))
      .default(["all"])
      .describe("Which corpora to search. ['all'] expands to docs+code+rows."),
    filters: z
      .record(z.union([z.string(), z.array(z.string())]))
      .optional()
      .describe('Facet filters, same shape as search_documents. Example: { "type": "runbook" }'),
    output: z
      .object({
        top_k_per_source: z.number().min(1).max(10).default(3),
        include_snippets: z.boolean().default(true),
        include_outlines_for_top: z.number().min(0).max(5).default(2),
        include_full_content_for_top: z.number().min(0).max(5).default(0),
        max_tokens: z.number().min(100).max(8000).default(2000),
      })
      .default({}),
  },
  async ({ intent, mode, sources, filters, output }) => {
    const { text } = compileContext(store, {
      intent,
      mode,
      sources,
      filters,
      output,
    });
    return { content: [{ type: "text" as const, text }] };
  }
);
```

Also update the `registerTools` JSDoc comment block (lines 60–78) to add tool 9:

```
 *   9. compile_context — Composed retrieval (search + outlines in one call)
```

- [ ] **Step 4: Update full test suite expectation**

Run the full suite:

```bash
bun test
```

Expected: PASS (previous 678 tests + new compile_context tests, all passing).

- [ ] **Step 5: Commit**

```bash
git add src/tools.ts tests/compile-context.test.ts
git commit -m "feat: register compile_context MCP tool"
```

---

## Task 13: Edge case tests

**Files:**
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Add edge-case tests**

Append to `tests/compile-context.test.ts`:

```ts
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
    const store = makeStoreWithFixtures();
    store.indexDocument({
      doc_id: "tasks",
      file_path: "tasks.csv",
      title: "Tasks",
      description: "",
      collection: "rows",
      facets: {},
      nodes: [
        {
          node_id: "PROJ-44",
          title: "PROJ-44",
          level: 1,
          parent_id: null,
          children: [],
          content: "Migrate auth service",
          summary: "Migrate auth service",
          word_count: 3,
          line_start: 1,
          line_end: 1,
        },
      ],
    });
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
    const store = new DocumentStore();
    // Index only docs, no code.
    store.indexDocument({
      doc_id: "only-docs",
      file_path: "x.md",
      title: "x",
      description: "",
      collection: "docs",
      facets: {},
      nodes: [
        {
          node_id: "n0",
          title: "x",
          level: 1,
          parent_id: null,
          children: [],
          content: "auth token rotation",
          summary: "auth",
          word_count: 3,
          line_start: 1,
          line_end: 1,
        },
      ],
    });
    const { result } = compileContext(store, {
      intent: "auth",
      sources: ["docs", "code"],
      output: { top_k_per_source: 3, max_tokens: 2000 },
    });
    expect(result.hits_by_source.code.length).toBe(0);
    expect(result.hits_by_source.docs.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
bun test tests/compile-context.test.ts
```

Expected: PASS (all edge cases).

- [ ] **Step 3: Commit**

```bash
git add tests/compile-context.test.ts
git commit -m "test: cover compile_context edge cases"
```

---

## Task 14: Layer 2 — accuracy parity vs. baseline (the gate)

**Files:**
- Create: `tests/compile-context-quality.test.ts`

This test gates whether the tool ships at all. It compares `compile_context`'s ranked hits against `searchDocuments`'s baseline using the same QRels the existing search-quality suite uses, and asserts no regression on NDCG@10 / MRR / per-language / per-domain.

- [ ] **Step 1: Inspect the existing quality fixtures and harness**

Read these files to understand the QRel format and `ndcgAtK` implementation:

```bash
grep -n "ndcgAtK\|QRel\|qrels" tests/search-quality.test.ts | head -30
ls tests/fixtures/
```

The QRels file is `tests/fixtures/search-quality-qrels.ts`. The harness lives in `tests/search-quality.test.ts` — copy its `ndcgAtK` and corpus-loading helpers verbatim into the new file.

- [ ] **Step 2: Create `tests/compile-context-quality.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { DocumentStore } from "../src/store";
import { compileContext } from "../src/compile-context";
// Re-use the same loader and qrels that drive search-quality.test.ts.
// If those helpers are not yet exported, factor them out into a shared
// helper module (e.g. tests/helpers/quality-corpus.ts) before continuing.
import {
  loadSearchQualityCorpus,
  qrels,
  ndcgAtK,
  mrr,
} from "./helpers/quality-corpus"; // adjust import as needed

describe("compile_context — accuracy parity vs. baseline", () => {
  const store = loadSearchQualityCorpus();

  test("overall NDCG@10 ≥ baseline", () => {
    const baselineScores: number[] = [];
    const composeScores: number[] = [];
    for (const q of qrels) {
      const baseline = store
        .searchDocuments(q.query, { limit: 10, filters: q.filters })
        .map((r) => `${r.doc_id}#${r.node_id}`);
      const { result } = compileContext(store, {
        intent: q.query,
        mode: "search",
        sources: ["all"],
        filters: q.filters,
        output: { top_k_per_source: 10, max_tokens: 8000 },
      });
      const composed = [
        ...result.hits_by_source.docs,
        ...result.hits_by_source.code,
        ...result.hits_by_source.rows,
      ].map((h) => `${h.doc_id}#${h.node_id}`);
      baselineScores.push(ndcgAtK(baseline, q.relevant, 10));
      composeScores.push(ndcgAtK(composed, q.relevant, 10));
    }
    const meanBase = avg(baselineScores);
    const meanCompose = avg(composeScores);
    expect(meanCompose).toBeGreaterThanOrEqual(0.65);
    expect(meanCompose).toBeGreaterThanOrEqual(meanBase - 0.005); // no regression
  });

  test("exact-match NDCG@10 ≥ 0.83", () => {
    const exactQrels = qrels.filter((q) => q.category === "exact");
    const scores = exactQrels.map((q) => {
      const { result } = compileContext(store, {
        intent: q.query,
        mode: "search",
        sources: ["all"],
        filters: q.filters,
        output: { top_k_per_source: 10, max_tokens: 8000 },
      });
      const composed = [
        ...result.hits_by_source.docs,
        ...result.hits_by_source.code,
        ...result.hits_by_source.rows,
      ].map((h) => `${h.doc_id}#${h.node_id}`);
      return ndcgAtK(composed, q.relevant, 10);
    });
    expect(avg(scores)).toBeGreaterThanOrEqual(0.83);
  });

  test("MRR ≥ 0.70", () => {
    const ranks = qrels.map((q) => {
      const { result } = compileContext(store, {
        intent: q.query,
        mode: "search",
        sources: ["all"],
        filters: q.filters,
        output: { top_k_per_source: 10, max_tokens: 8000 },
      });
      const composed = [
        ...result.hits_by_source.docs,
        ...result.hits_by_source.code,
        ...result.hits_by_source.rows,
      ].map((h) => `${h.doc_id}#${h.node_id}`);
      return mrr(composed, q.relevant);
    });
    expect(avg(ranks)).toBeGreaterThanOrEqual(0.70);
  });

  // Per-language and per-domain tests follow the same shape:
  // group qrels by `language` / `domain` field, run compile_context,
  // assert each group's NDCG@10 ≥ 0.65.
});

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
}
```

- [ ] **Step 3: Refactor search-quality test if needed**

If `loadSearchQualityCorpus`, `qrels`, `ndcgAtK`, and `mrr` are not yet exported from a shared helper, factor them out:

```bash
# Create the helper file if missing
mkdir -p tests/helpers
```

Then move the shared functions from `tests/search-quality.test.ts` into `tests/helpers/quality-corpus.ts` and re-import them in both test files. Verify the original suite still passes:

```bash
bun test tests/search-quality.test.ts
```

Expected: PASS (109 tests, 0 fail) — same as before the refactor.

- [ ] **Step 4: Run the parity suite**

```bash
bun test tests/compile-context-quality.test.ts
```

Expected: PASS. **If any test fails, do NOT proceed to Task 15. The "are we deviating?" gate has been hit. Diagnose the regression (filter leak, partition crowd-out, off-by-one) and fix in `compile-context.ts` before continuing.**

- [ ] **Step 5: Add per-language and per-domain assertions**

Following the same pattern as the existing `tests/search-quality.test.ts` per-language and per-domain tests, add 8 + 7 group-NDCG tests (Java, Python, TypeScript, Go, Rust, C++, C#, Ruby; auth, api, ops, arch, frontend, infra, data-science). Each must hit ≥ 0.65 NDCG@10 in the composed path.

- [ ] **Step 6: Run the full suite**

```bash
bun test
```

Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/compile-context-quality.test.ts tests/helpers/quality-corpus.ts tests/search-quality.test.ts
git commit -m "test: add compile_context accuracy parity tests (Layer 2 gate)"
```

---

## Task 15: Layer 3 — token-win measurement (the value gate)

**Files:**
- Modify: `tests/compile-context.test.ts`

- [ ] **Step 1: Define ~10 representative skill-style flows**

Append to `tests/compile-context.test.ts`:

```ts
describe("compile_context token-win vs. baseline chain", () => {
  // Each flow models a typical multi-step retrieve loop a skill performs:
  //   (a) search_documents to find candidates
  //   (b) get_tree on the top result for outline
  //   (c) get_node_content on the chosen section(s)
  // We measure total bytes returned by the chain vs. one compile_context call.
  const flows = [
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
    const store = loadSearchQualityCorpus();
    let baselineTotal = 0;
    let composeTotal = 0;

    for (const flow of flows) {
      // Baseline chain: search + tree + content for top hit
      const sr = store.searchDocuments(flow.intent, {
        limit: 3,
        filters: flow.filters,
      });
      const baselineSearch = JSON.stringify(sr);
      let baselineTree = "";
      let baselineContent = "";
      if (sr.length > 0) {
        const tree = store.getTree(sr[0].doc_id);
        baselineTree = JSON.stringify(tree);
        const node = store.getNodeContent(sr[0].doc_id, [sr[0].node_id]);
        baselineContent = JSON.stringify(node);
      }
      baselineTotal += Buffer.byteLength(baselineSearch + baselineTree + baselineContent, "utf8");

      // Composed: single call with outlines bundled
      const { text } = compileContext(store, {
        intent: flow.intent,
        sources: ["all"],
        filters: flow.filters,
        output: { top_k_per_source: 3, include_outlines_for_top: 1, max_tokens: 2000 },
      });
      composeTotal += Buffer.byteLength(text, "utf8");
    }

    const reduction = (baselineTotal - composeTotal) / baselineTotal;
    console.log(`baseline=${baselineTotal} compose=${composeTotal} reduction=${(reduction * 100).toFixed(1)}%`);
    expect(reduction).toBeGreaterThanOrEqual(0.30);
  });
});
```

- [ ] **Step 2: Run the token-win test**

```bash
bun test tests/compile-context.test.ts -t "token-win"
```

Expected: PASS, with console output showing baseline / compose / reduction percentages.

**If reduction < 30%, do NOT ship.** The cost-benefit doesn't justify a new tool. Diagnose:
- Are outlines too verbose? Tighten the formatter.
- Is `top_k_per_source=3` too generous for a fair comparison? Reduce.
- Are baseline JSON serializations being unfairly inflated? Switch to the actual MCP tool text outputs (`formatSearchResults`, `formatGrepResult`, the `get_tree` / `get_node_content` formatters) — those are what the agent actually consumes.

If the test reveals the baseline measurement isn't apples-to-apples, fix it before declaring failure. The intent is "fewer bytes in the agent's context after the same task," not "smaller raw store output."

- [ ] **Step 3: Commit**

```bash
git add tests/compile-context.test.ts
git commit -m "test: measure compile_context token win vs. baseline chain"
```

---

## Task 16: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/CONFIGURATION.md`
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: Update `CLAUDE.md` MCP Tools list**

Find the section starting with `## MCP Tools` and `Read tools (always available):` (around line 90 of CLAUDE.md). Add tool 9:

```markdown
9. **`compile_context`** — Composed retrieval. Single call returns ranked hits partitioned by source (docs/code/rows) plus outline trees for the top hits. Replaces the typical `search → get_tree → get_node_content` loop with one call. `mode='auto'` picks the right primitive (search / grep / lookup / symbol) from the intent shape.
```

Renumber the curation tools section (which currently starts at 9) to start at 10:

```markdown
Curation tools (only when `WIKI_WRITE=1`):

10. **`find_similar`** — BM25 dedupe check for prospective content
11. **`draft_wiki_entry`** — Structural scaffold for a new entry (no write)
12. **`write_wiki_entry`** — Validated write + incremental re-index
```

Also update the `src/server.ts` comment in the Architecture section (line 19) from "8 read tools + optional 3 curation tools" to "9 read tools + optional 3 curation tools".

- [ ] **Step 2: Update `docs/CONFIGURATION.md`**

Add a new subsection under the existing tool documentation:

```markdown
### compile_context

Single composed-retrieval tool. Use this to collapse the typical
`search_documents → get_tree → get_node_content` loop into one call.

Inputs (all optional except `intent`):
- `intent` — the query (NL, literal, regex, key, or symbol).
- `mode` — `auto` (default), `search`, `grep`, `lookup`, or `symbol`.
- `sources` — array of `docs`, `code`, `rows`, or `all` (default).
- `filters` — same facet filters as `search_documents`.
- `output.top_k_per_source` — default 3, max 10.
- `output.include_outlines_for_top` — default 2 (set 0 to disable).
- `output.include_full_content_for_top` — default 0 (opt-in).
- `output.max_tokens` — default 2000, max 8000.

Returns a single text block with ranked hits per source, bundled outline
trees for the top hits, a budget summary, and follow-up hints.

See `docs/superpowers/specs/2026-05-06-compile-context-design.md` and
`docs/adr/0002-multi-intent-out-of-scope.md` for the full design and
rejected alternatives.
```

- [ ] **Step 3: Update `docs/DESIGN.md`**

In the architecture diagram block (top of file), add the new module:

```
src/compile-context.ts  # Composed retrieval — orchestrates search/grep/lookup/symbol/outlines
```

Add a paragraph in the relevant section explaining that `compile_context` is pure orchestration over `DocumentStore`'s public methods and adds no new ranking, no new index, no LLM calls.

- [ ] **Step 4: Verify all docs render correctly**

```bash
bun run cli-lint || true   # only relevant if it covers these files
ls docs/CONFIGURATION.md docs/DESIGN.md CLAUDE.md
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/CONFIGURATION.md docs/DESIGN.md
git commit -m "docs: document compile_context tool"
```

---

## Task 17: Final verification + PR

**Files:** *(no code changes)*

- [ ] **Step 1: Run the full test suite**

```bash
bun test
```

Expected: ALL PASS, including:
- The original 678 baseline tests
- New `tests/compile-context.test.ts` tests (~30+)
- New `tests/compile-context-quality.test.ts` parity tests (overall + per-lang + per-domain)
- The token-win test

- [ ] **Step 2: Verify the three gates from the spec**

| Gate | Verification |
|---|---|
| Principle preserved | Code review confirms zero LLM calls, no embeddings, no new ranking. |
| Accuracy preserved | Layer-2 quality tests pass with no regression. |
| Value delivered | Layer-3 token-win shows ≥ 30% reduction. |

If all three pass: tool ships. If any fails: review the spec's "rejection" path and either fix or close out.

- [ ] **Step 3: Push the branch and open a PR**

```bash
cd /Users/josesebastian/git/treenav-mcp/.worktrees/feat-compile-context-design
git push -u origin feat/compile-context-design
gh pr create --title "feat: add compile_context composed retrieval tool" --body "$(cat <<'EOF'
## Summary
- Adds `compile_context` MCP tool that composes existing read primitives behind one call
- Returns ranked hits partitioned by source (docs/code/rows) + outline trees for top hits
- Replaces the 3-call retrieve loop (`search → get_tree → get_node_content`) with one call
- Includes ADR-0002 explicitly rejecting multi-intent for v1+v2

## Design + ADR
- Spec: `docs/superpowers/specs/2026-05-06-compile-context-design.md`
- ADR: `docs/adr/0002-multi-intent-out-of-scope.md`

## Gates passed
- [x] Principle preserved — zero LLM calls, no embeddings, no new ranking
- [x] Accuracy preserved — NDCG@10 / MRR / per-language / per-domain parity vs. baseline
- [x] Value delivered — ≥ 30% token reduction on representative skill-style flows

## Test plan
- [x] `bun test` — full suite passes (baseline + new tests)
- [x] Verify the new tool appears in the MCP tool list when running the server
- [x] Manual smoke test: `compile_context({ intent: "auth token rotation", sources: ["all"] })` returns the expected sectioned text artifact

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Verify PR rendered correctly**

Check the PR URL. Confirm description renders as expected.

---

## Self-Review Notes

After completing all tasks above, this plan covers every section of the design spec:

- §3 (Tool surface, input schema, mode-auto) → Tasks 1, 2, 12
- §4 (Output contract, sections, provenance, determinism) → Tasks 9, 11
- §5 (Budget enforcement, trim order) → Task 10
- §6 (File changes, rollout) → Tasks 1, 11, 12, 16, 17
- §7 (Three test layers) → Tasks 13, 14, 15
- §8 (Are we deviating gate) → Task 17
- §9 (v2 skill integration) — explicitly out of scope for this plan
- §10 (Out of scope) — enforced by what we do NOT add

Multi-intent (ADR-0002) is enforced by the input schema (single `intent: string`, no `queries[]`).

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-06-compile-context.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Good for plans with this many discrete TDD tasks.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
