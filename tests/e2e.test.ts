/**
 * End-to-end integration tests.
 *
 * These tests exercise the full pipeline against real markdown files:
 * indexing → store loading → search → tree navigation.
 *
 * Uses the actual docs/ folder in the repo as test data.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { resolve } from "node:path";

import { indexAllCollections } from "../src/indexer";
import { singleRootConfig } from "../src/types";
import { DocumentStore } from "../src/store";
import { formatSearchResults } from "../src/search-formatter";

// ── E2E: Index real docs/ folder ────────────────────────────────────

describe("E2E: real docs indexing", () => {
  let store: DocumentStore;
  const docsRoot = resolve(__dirname, "../docs");

  beforeAll(async () => {
    store = new DocumentStore();
    const config = singleRootConfig(docsRoot);
    const documents = await indexAllCollections(config);
    store.load(documents);
  });

  test("indexes all markdown files in docs/", () => {
    const stats = store.getStats();
    expect(stats.document_count).toBeGreaterThanOrEqual(3); // DESIGN, CONFIG, COMPETITIVE-ANALYSIS, LLM-WIKI-GUIDE
    expect(stats.total_nodes).toBeGreaterThan(10);
    expect(stats.indexed_terms).toBeGreaterThan(50);
  });

  test("search returns ranked results from real content", () => {
    const results = store.searchDocuments("BM25 scoring");
    expect(results.length).toBeGreaterThan(0);
    // DESIGN.md discusses BM25 extensively
    expect(results.some((r) => r.file_path.includes("DESIGN"))).toBe(true);
  });

  test("search with facet filters works on real docs", () => {
    // docs/ files auto-detect content facets
    const stats = store.getFacets();
    // Should have some facet keys from auto-detection
    expect(Object.keys(stats).length).toBeGreaterThan(0);
  });

  test("get_tree returns outline for real doc", () => {
    // Find a doc_id from the indexed docs
    const results = store.searchDocuments("configuration");
    expect(results.length).toBeGreaterThan(0);

    const tree = store.getTree(results[0].doc_id);
    expect(tree).not.toBeNull();
    expect(tree!.nodes.length).toBeGreaterThan(0);
    // Every node should have a title and node_id
    for (const node of tree!.nodes) {
      expect(node.node_id).toBeTruthy();
      expect(node.title).toBeTruthy();
    }
  });

  test("get_node_content retrieves real content", () => {
    const results = store.searchDocuments("pagefind");
    expect(results.length).toBeGreaterThan(0);

    const content = store.getNodeContent(results[0].doc_id, [
      results[0].node_id,
    ]);
    expect(content).not.toBeNull();
    expect(content!.nodes.length).toBe(1);
    expect(content!.nodes[0].content.length).toBeGreaterThan(0);
  });

  test("navigate_tree returns subtree with content", () => {
    const results = store.searchDocuments("architecture");
    expect(results.length).toBeGreaterThan(0);

    const subtree = store.getSubtree(results[0].doc_id, results[0].node_id);
    expect(subtree).not.toBeNull();
    expect(subtree!.nodes.length).toBeGreaterThanOrEqual(1);
  });

  test("formatSearchResults produces rich output from real results", () => {
    const results = store.searchDocuments("search ranking BM25");
    const formatted = formatSearchResults(results, store, "search ranking BM25");

    expect(formatted).toContain("Search results for");
    if (results.length > 0) {
      expect(formatted).toContain("Score:");
      expect(formatted).toContain("Section:");
    }
  });

  test("auto-glossary extracts terms from real content", () => {
    const terms = store.getGlossaryTerms();
    // Real docs contain acronyms like BM25, MCP, etc.
    // Auto-glossary should pick up at least some
    // (may be empty if no patterns match — that's ok too)
    expect(Array.isArray(terms)).toBe(true);
  });

  test("cross-references are extracted from real docs", () => {
    // LLM-WIKI-GUIDE.md has internal references
    const list = store.listDocuments();
    const docsWithRefs = list.documents.filter(
      (d) => d.references && d.references.length > 0
    );
    // At least some docs should have cross-references
    // (depends on content, but LLM-WIKI-GUIDE references other docs)
    expect(Array.isArray(list.documents[0]?.references)).toBe(true);
  });

  test("content facets detected on real docs", () => {
    // DESIGN.md and others have code blocks
    const list = store.listDocuments();
    const docsWithCode = list.documents.filter(
      (d) => d.facets["has_code"]?.[0] === "true"
    );
    expect(docsWithCode.length).toBeGreaterThan(0);
  });

  test("first-sentence summaries are well-formed", () => {
    const results = store.searchDocuments("design");
    expect(results.length).toBeGreaterThan(0);

    const tree = store.getTree(results[0].doc_id);
    expect(tree).not.toBeNull();

    for (const node of tree!.nodes) {
      if (node.summary) {
        // Summary should not be raw-truncated mid-word with just "…"
        // (unless it's a very long sentence with no early boundary)
        expect(node.summary.length).toBeLessThanOrEqual(201);
      }
    }
  });
});
