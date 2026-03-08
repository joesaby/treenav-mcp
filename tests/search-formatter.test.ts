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
