# Enhanced Search Formatter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `tools.ts` inline search formatting with a `search-formatter.ts` that inlines full content for top-3 results, adds facet badges, and appends resolved cross-reference links so the agent can navigate related docs without extra tool calls.

**Architecture:** Add `resolveRef()` + `getDocMeta()` to `DocumentStore`; create `src/search-formatter.ts` with `formatSearchResults()`; wire it into `tools.ts` Tool 2; update `docnav.py` system prompt to tell the agent how to use cross-refs.

**Tech Stack:** Bun, TypeScript, bun:test, Python (docnav.py)

---

### Task 1: Add `resolveRef()` and `getDocMeta()` to `DocumentStore`

**Files:**
- Modify: `src/store.ts`
- Test: `tests/store.test.ts`

**Step 1: Write the failing tests**

Add to `tests/store.test.ts` after the existing test blocks:

```typescript
describe("resolveRef", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
    store.load([
      makeDoc({
        meta: { doc_id: "admin-guide", file_path: "docs/admin-guide.md", references: [] },
        tree: [
          makeNode({ node_id: "admin-guide:n1", title: "Setup", level: 1, children: [] }),
          makeNode({ node_id: "admin-guide:n2", title: "User Provisioning", level: 2, children: [] }),
        ],
      }),
      makeDoc({
        meta: { doc_id: "user-mgmt", file_path: "docs/user-mgmt.md", references: [] },
        tree: [makeNode({ node_id: "user-mgmt:n1", title: "Overview", level: 1, children: [] })],
      }),
    ]);
  });

  test("resolves file basename to doc_id", () => {
    expect(store.resolveRef("admin-guide.md")).toEqual({ doc_id: "admin-guide" });
  });

  test("resolves relative path to doc_id", () => {
    expect(store.resolveRef("../other/admin-guide.md")).toEqual({ doc_id: "admin-guide" });
  });

  test("resolves fragment to node_id via title slug", () => {
    expect(store.resolveRef("admin-guide.md#user-provisioning")).toEqual({
      doc_id: "admin-guide",
      node_id: "admin-guide:n2",
    });
  });

  test("resolves file with unknown fragment — returns doc_id only", () => {
    expect(store.resolveRef("admin-guide.md#nonexistent")).toEqual({ doc_id: "admin-guide" });
  });

  test("returns null for unknown file", () => {
    expect(store.resolveRef("unknown.md")).toBeNull();
  });
});

describe("getDocMeta", () => {
  test("returns meta for known doc_id", () => {
    const store = new DocumentStore();
    store.load([makeDoc({ meta: { doc_id: "test:doc", file_path: "doc.md", references: ["other.md"] } })]);
    const meta = store.getDocMeta("test:doc");
    expect(meta?.doc_id).toBe("test:doc");
    expect(meta?.references).toEqual(["other.md"]);
  });

  test("returns null for unknown doc_id", () => {
    const store = new DocumentStore();
    store.load([]);
    expect(store.getDocMeta("nope")).toBeNull();
  });
});
```

Also add `references: []` to the `makeMeta()` helper (it's missing from the base object — `DocumentMeta` requires it):

```typescript
// In makeMeta(), add to the base object:
references: [],
```

**Step 2: Run tests to verify they fail**

```bash
cd /Users/josesebastian/git/treenav-mcp
bun test tests/store.test.ts 2>&1 | tail -20
```

Expected: errors about `resolveRef` and `getDocMeta` not existing, and possibly TS errors about missing `references` field.

**Step 3: Implement in `src/store.ts`**

Add the private `refMap` field after `collectionWeights`:

```typescript
// ── Ref map for cross-reference resolution ────────────────────────
// basename(file_path) → { doc_id, tree }
private refMap: Map<string, { doc_id: string; tree: TreeNode[] }> = new Map();
```

Add `buildRefMap()` private method before `buildIndex()`:

```typescript
private buildRefMap(): void {
  this.refMap.clear();
  for (const doc of this.docs.values()) {
    const basename = doc.meta.file_path.split("/").pop() ?? doc.meta.file_path;
    this.refMap.set(basename, { doc_id: doc.meta.doc_id, tree: doc.tree });
  }
}
```

Call it from `load()` — add after `this.buildAutoGlossary(documents);`:

```typescript
this.buildRefMap();
```

Call it from `addDocument()` — add after `this.recalcCorpusStats();`:

```typescript
this.buildRefMap();
```

Add the two public methods after `hasDocument()`:

```typescript
/**
 * Resolve a markdown cross-reference path to a doc_id and optional node_id.
 * Path may be a basename ("admin-guide.md"), relative ("../foo/admin-guide.md"),
 * or include a heading fragment ("admin-guide.md#user-provisioning").
 * Returns null if the file cannot be matched to any indexed document.
 */
resolveRef(path: string): { doc_id: string; node_id?: string } | null {
  const [filePart, fragment] = path.split("#");
  const basename = filePart.split("/").pop() ?? filePart;
  const entry = this.refMap.get(basename);
  if (!entry) return null;

  if (!fragment) return { doc_id: entry.doc_id };

  // Match fragment to node via title slug (GitHub-style: lowercase, non-alphanumeric → hyphen)
  const slug = fragment.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const node = entry.tree.find((n) => {
    const nodeSlug = n.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return nodeSlug === slug || n.node_id === fragment;
  });

  return { doc_id: entry.doc_id, node_id: node?.node_id };
}

/**
 * Return the DocumentMeta for a doc_id, or null if not found.
 */
getDocMeta(doc_id: string): DocumentMeta | null {
  return this.docs.get(doc_id)?.meta ?? null;
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/store.test.ts 2>&1 | tail -20
```

Expected: all store tests pass including the new `resolveRef` and `getDocMeta` blocks.

**Step 5: Commit**

```bash
cd /Users/josesebastian/git/treenav-mcp
git add src/store.ts tests/store.test.ts
git commit -m "feat: add resolveRef() and getDocMeta() to DocumentStore"
```

---

### Task 2: Create `src/search-formatter.ts`

**Files:**
- Create: `src/search-formatter.ts`
- Test: `tests/search-formatter.test.ts`

**Step 1: Write the failing tests**

Create `tests/search-formatter.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { formatSearchResults } from "../src/search-formatter";
import type { SubtreeProvider } from "../src/search-formatter";
import type { SearchResult } from "../src/types";

// ── Minimal store stub ──────────────────────────────────────────────

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    doc_id: "webex-calling",
    doc_title: "Webex Calling Guide",
    file_path: "webex-calling.md",
    node_id: "webex-calling:n1",
    node_title: "User Licensing",
    level: 2,
    snippet: "To provision a user...",
    score: 9.2,
    match_positions: [0],
    matched_terms: ["provision"],
    collection: "docs",
    facets: {},
    ...overrides,
  };
}

function makeStore(overrides: Partial<SubtreeProvider> = {}): SubtreeProvider {
  return {
    getSubtree: (doc_id, node_id) => ({
      nodes: [
        { node_id, title: "User Licensing", level: 2, content: "Full content here." },
      ],
    }),
    resolveRef: () => null,
    getDocMeta: () => null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("formatSearchResults", () => {
  test("returns no-results message when empty", () => {
    const out = formatSearchResults([], makeStore(), "webex calling");
    expect(out).toContain('No results found for "webex calling"');
  });

  test("includes ranked snippet list", () => {
    const out = formatSearchResults([makeResult()], makeStore(), "provision");
    expect(out).toContain("1. [webex-calling]");
    expect(out).toContain("User Licensing");
    expect(out).toContain("Score: 9.2");
    expect(out).toContain("To provision a user...");
  });

  test("inlines full content for top result", () => {
    const out = formatSearchResults([makeResult()], makeStore(), "provision");
    expect(out).toContain("Full content (top 1 match)");
    expect(out).toContain("=== [webex-calling]");
    expect(out).toContain("Full content here.");
  });

  test("does not inline content when getSubtree returns null", () => {
    const store = makeStore({ getSubtree: () => null });
    const out = formatSearchResults([makeResult()], store, "provision");
    expect(out).not.toContain("Full content");
  });

  test("shows facet badge for code_languages", () => {
    const result = makeResult({ facets: { code_languages: ["javascript", "python"] } });
    const out = formatSearchResults([result], makeStore(), "provision");
    expect(out).toContain("code: javascript, python");
  });

  test("shows has_code badge when no specific languages", () => {
    const result = makeResult({ facets: { has_code: ["true"] } });
    const out = formatSearchResults([result], makeStore(), "provision");
    expect(out).toContain("has_code");
  });

  test("no badge when no code facets", () => {
    const out = formatSearchResults([makeResult()], makeStore(), "provision");
    expect(out).not.toContain("has_code");
    expect(out).not.toContain("code:");
  });

  test("appends resolved cross-references after inlined content", () => {
    const store = makeStore({
      getDocMeta: () => ({
        doc_id: "webex-calling",
        file_path: "webex-calling.md",
        title: "Webex Calling",
        description: "",
        word_count: 100,
        heading_count: 5,
        max_depth: 3,
        last_modified: "2026-01-01",
        tags: [],
        content_hash: "abc",
        collection: "docs",
        facets: {},
        references: ["admin-guide.md#setup", "user-mgmt.md"],
      }),
      resolveRef: (path) => {
        if (path === "admin-guide.md#setup") return { doc_id: "admin-guide", node_id: "ag:n1" };
        if (path === "user-mgmt.md") return { doc_id: "user-mgmt" };
        return null;
      },
    });
    const out = formatSearchResults([makeResult()], store, "provision");
    expect(out).toContain("→ References:");
    expect(out).toContain("[admin-guide] (ag:n1)");
    expect(out).toContain("[user-mgmt]");
  });

  test("omits References line when all refs are unresolvable", () => {
    const store = makeStore({
      getDocMeta: () => ({
        doc_id: "webex-calling", file_path: "webex-calling.md", title: "x",
        description: "", word_count: 0, heading_count: 0, max_depth: 0,
        last_modified: "", tags: [], content_hash: "", collection: "docs",
        facets: {}, references: ["unknown.md"],
      }),
      resolveRef: () => null,
    });
    const out = formatSearchResults([makeResult()], store, "provision");
    expect(out).not.toContain("→ References");
  });

  test("inlines at most 3 results even with more matches", () => {
    const results = [1, 2, 3, 4, 5].map((i) => makeResult({ node_id: `n${i}`, node_title: `Section ${i}` }));
    const out = formatSearchResults(results, makeStore(), "provision");
    expect(out).toContain("Full content (top 3 matches)");
    // All 5 appear in snippet list
    expect(out).toContain("5. [webex-calling]");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd /Users/josesebastian/git/treenav-mcp
bun test tests/search-formatter.test.ts 2>&1 | tail -20
```

Expected: module not found / import errors.

**Step 3: Create `src/search-formatter.ts`**

```typescript
import type { SearchResult, TreeNode, DocumentMeta } from "./types.js";

/** Minimal store interface needed by the formatter. */
export interface SubtreeProvider {
  getSubtree(
    doc_id: string,
    node_id: string
  ): { nodes: Pick<TreeNode, "node_id" | "title" | "level" | "content">[] } | null;
  resolveRef(path: string): { doc_id: string; node_id?: string } | null;
  getDocMeta(doc_id: string): DocumentMeta | null;
}

/** Number of top results for which full subtree content is inlined. */
const INLINE_CONTENT_TOP_N = 3;

/**
 * Format search results for agent consumption.
 *
 * Output structure:
 *   1. Ranked snippet list (all results) with facet badges
 *   2. Full subtree content for top INLINE_CONTENT_TOP_N results
 *   3. Resolved cross-references (→ References) after each inlined block
 *
 * Inlining full content eliminates the need for a follow-up get_node_content
 * call. Cross-references let the agent follow author-created navigation paths
 * without a separate search round-trip.
 */
export function formatSearchResults(
  results: SearchResult[],
  store: SubtreeProvider,
  query: string
): string {
  if (results.length === 0) {
    return `No results found for "${query}". Try broader terms or use list_documents to browse the catalog.`;
  }

  // 1. Ranked snippet list
  const summary = results
    .map((r, i) => {
      const badge = buildFacetBadge(r.facets);
      return `${i + 1}. [${r.doc_id}] ${r.doc_title}\n   Section: ${r.node_title} (${r.node_id})\n   Score: ${r.score.toFixed(1)}${badge}\n   Snippet: ${r.snippet}`;
    })
    .join("\n\n");

  // 2. Full content blocks for top N
  const contentBlocks = results
    .slice(0, INLINE_CONTENT_TOP_N)
    .map((r) => {
      const subtree = store.getSubtree(r.doc_id, r.node_id);
      if (!subtree || subtree.nodes.length === 0) return null;

      const root = subtree.nodes[0];
      const formatted = subtree.nodes
        .map((n) => {
          const indent = "  ".repeat(Math.max(0, n.level - root.level));
          return `${indent}${"#".repeat(n.level)} ${n.title} [${n.node_id}]\n${indent}${n.content || "(empty)"}`;
        })
        .join("\n\n");

      const subsectionCount = subtree.nodes.length - 1;
      const label =
        subsectionCount > 0
          ? `${r.node_title} + ${subsectionCount} subsection(s)`
          : r.node_title;

      // 3. Resolved cross-references for this document
      const meta = store.getDocMeta(r.doc_id);
      const refLine = buildRefLine(meta?.references ?? [], store);

      return `=== [${r.doc_id}] ${label} ===\n\n${formatted}${refLine}`;
    })
    .filter((b): b is string => b !== null);

  const parts = [
    `Search results for "${query}" (${results.length} matches):\n\n${summary}`,
  ];

  if (contentBlocks.length > 0) {
    const n = Math.min(results.length, INLINE_CONTENT_TOP_N);
    parts.push(
      `\n--- Full content (top ${n} match${n === 1 ? "" : "es"}) ---\n\n${contentBlocks.join("\n\n")}`
    );
  }

  return parts.join("\n");
}

function buildFacetBadge(facets: Record<string, string[]>): string {
  const parts: string[] = [];
  const langs = facets["code_languages"];
  if (langs?.length) parts.push(`code: ${langs.join(", ")}`);
  else if (facets["has_code"]?.[0] === "true") parts.push("has_code");
  if (facets["has_links"]?.[0] === "true") parts.push("has_links");
  return parts.length ? ` | ${parts.join(" | ")}` : "";
}

function buildRefLine(references: string[], store: SubtreeProvider): string {
  if (!references.length) return "";

  const resolved = references
    .map((ref) => {
      const r = store.resolveRef(ref);
      if (!r) return null;
      return r.node_id ? `[${r.doc_id}] (${r.node_id})` : `[${r.doc_id}]`;
    })
    .filter((r): r is string => r !== null);

  if (!resolved.length) return "";
  return `\n\n→ References: ${resolved.join(", ")}`;
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/search-formatter.test.ts 2>&1 | tail -20
```

Expected: all 10 tests pass.

**Step 5: Commit**

```bash
git add src/search-formatter.ts tests/search-formatter.test.ts
git commit -m "feat: add search-formatter with inline content, facet badges, and cross-refs"
```

---

### Task 3: Wire formatter into `tools.ts`

**Files:**
- Modify: `src/tools.ts`

No new tests needed — `mcp-integration.test.ts` already exercises Tool 2 end-to-end.

**Step 1: Verify integration tests currently pass (baseline)**

```bash
bun test tests/mcp-integration.test.ts 2>&1 | tail -10
```

Expected: all pass.

**Step 2: Update `src/tools.ts`**

Add the import after the existing imports at the top:

```typescript
import { formatSearchResults } from "./search-formatter.js";
```

Replace the entire Tool 2 handler body (lines 101–130, from `const results = store.searchDocuments(...)` through the closing `}`):

```typescript
async ({ query, doc_id, filters, limit }) => {
  const results = store.searchDocuments(query, { limit, doc_id, filters });
  const text = formatSearchResults(results, store, query);
  return { content: [{ type: "text" as const, text }] };
},
```

`DocumentStore` already satisfies `SubtreeProvider` because we added `resolveRef()` and `getDocMeta()` in Task 1.

**Step 3: Run all tests**

```bash
bun test 2>&1 | tail -20
```

Expected: all tests pass. If any search-quality tests regress, the formatter changed snippet count — check `INLINE_CONTENT_TOP_N` or test expectations.

**Step 4: Commit**

```bash
git add src/tools.ts
git commit -m "feat: use formatSearchResults in search_documents tool"
```

---

### Task 4: Update `docnav.py` system prompt

**Files:**
- Modify: `aegra/graphs/docnav.py`

**Step 1: Update the system prompt**

In `aegra/graphs/docnav.py`, replace the navigation strategy item 1:

Old:
```python
1. For specific questions: use search_documents — the results include full section content for the top matches, so you can answer directly from the tool output.
```

New:
```python
1. For specific questions: use search_documents — the results include full section content for the top matches, so you can often answer directly from the tool output. Results also show "→ References" listing doc IDs that the matched section links to; use navigate_tree(doc_id) or get_node_content(doc_id, node_id) to follow them when the question needs broader context.
```

**Step 2: Verify the graph still builds**

```bash
cd /Users/josesebastian/git/treenav-agent
python -c "from aegra.graphs.docnav import graph; print('ok')"
```

Expected: `ok`

**Step 3: Commit**

```bash
git add aegra/graphs/docnav.py
git commit -m "feat: update docnav agent to leverage search cross-references"
```
