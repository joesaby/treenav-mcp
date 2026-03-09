/**
 * Tests for the backlink index, get_related, and inlink-boosted ranking.
 *
 * Validates:
 *   - Backlink index correctly inverts forward references
 *   - getRelated returns outlinks and backlinks
 *   - Inlink count feeds into BM25 scoring
 *   - Edge cases: self-refs, unknown refs, docs with no refs
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { DocumentStore } from "../src/store";
import type { IndexedDocument, TreeNode, DocumentMeta } from "../src/types";

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
    description: "A test document",
    word_count: 100,
    heading_count: 1,
    max_depth: 1,
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
} = {}): IndexedDocument {
  const docId = overrides.meta?.doc_id || "test:doc";
  const tree = overrides.tree || [
    makeNode({
      node_id: `${docId}:n1`,
      title: overrides.meta?.title || "Test Document",
      content: "Default content for testing purposes.",
    }),
  ];

  return {
    meta: makeMeta({
      heading_count: tree.length,
      word_count: tree.reduce((s, n) => s + n.word_count, 0),
      ...overrides.meta,
    }),
    tree,
    root_nodes: [tree[0].node_id],
  };
}

// ── Backlink index ──────────────────────────────────────────────────

describe("backlink index", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  test("builds backlinks from forward references", () => {
    // Doc A references Doc B
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:a",
          file_path: "a.md",
          title: "Doc A",
          references: ["b.md"],
        },
      }),
      makeDoc({
        meta: {
          doc_id: "docs:b",
          file_path: "b.md",
          title: "Doc B",
          references: [],
        },
      }),
    ]);

    const related = store.getRelated("docs:b");
    expect(related).not.toBeNull();
    expect(related!.backlinks.length).toBe(1);
    expect(related!.backlinks[0].doc_id).toBe("docs:a");
    expect(related!.backlinks[0].title).toBe("Doc A");
  });

  test("builds outlinks from forward references", () => {
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:a",
          file_path: "a.md",
          title: "Doc A",
          references: ["b.md"],
        },
      }),
      makeDoc({
        meta: {
          doc_id: "docs:b",
          file_path: "b.md",
          title: "Doc B",
          references: [],
        },
      }),
    ]);

    const related = store.getRelated("docs:a");
    expect(related).not.toBeNull();
    expect(related!.outlinks.length).toBe(1);
    expect(related!.outlinks[0].doc_id).toBe("docs:b");
  });

  test("handles bidirectional references", () => {
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:a",
          file_path: "a.md",
          title: "Doc A",
          references: ["b.md"],
        },
      }),
      makeDoc({
        meta: {
          doc_id: "docs:b",
          file_path: "b.md",
          title: "Doc B",
          references: ["a.md"],
        },
      }),
    ]);

    const relA = store.getRelated("docs:a");
    expect(relA!.outlinks.length).toBe(1);
    expect(relA!.backlinks.length).toBe(1);

    const relB = store.getRelated("docs:b");
    expect(relB!.outlinks.length).toBe(1);
    expect(relB!.backlinks.length).toBe(1);
  });

  test("ignores self-references", () => {
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:a",
          file_path: "a.md",
          title: "Doc A",
          references: ["a.md"],
        },
      }),
    ]);

    const related = store.getRelated("docs:a");
    expect(related!.outlinks.length).toBe(0);
    expect(related!.backlinks.length).toBe(0);
  });

  test("ignores unresolvable references", () => {
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:a",
          file_path: "a.md",
          title: "Doc A",
          references: ["nonexistent.md"],
        },
      }),
    ]);

    const related = store.getRelated("docs:a");
    expect(related!.outlinks.length).toBe(0);
  });

  test("returns null for non-existent doc", () => {
    store.load([]);
    expect(store.getRelated("nonexistent")).toBeNull();
  });

  test("handles multiple backlinks to same target", () => {
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:a",
          file_path: "a.md",
          title: "Doc A",
          references: ["target.md"],
        },
      }),
      makeDoc({
        meta: {
          doc_id: "docs:b",
          file_path: "b.md",
          title: "Doc B",
          references: ["target.md"],
        },
      }),
      makeDoc({
        meta: {
          doc_id: "docs:c",
          file_path: "c.md",
          title: "Doc C",
          references: ["target.md"],
        },
      }),
      makeDoc({
        meta: {
          doc_id: "docs:target",
          file_path: "target.md",
          title: "Target Doc",
          references: [],
        },
      }),
    ]);

    const related = store.getRelated("docs:target");
    expect(related!.backlinks.length).toBe(3);
  });

  test("deduplicates outlinks when same doc referenced multiple times", () => {
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:a",
          file_path: "a.md",
          title: "Doc A",
          references: ["b.md", "b.md", "b.md"],
        },
      }),
      makeDoc({
        meta: {
          doc_id: "docs:b",
          file_path: "b.md",
          title: "Doc B",
          references: [],
        },
      }),
    ]);

    const related = store.getRelated("docs:a");
    expect(related!.outlinks.length).toBe(1);
  });

  test("returns empty lists for doc with no references", () => {
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:isolated",
          file_path: "isolated.md",
          title: "Isolated Doc",
          references: [],
        },
      }),
    ]);

    const related = store.getRelated("docs:isolated");
    expect(related!.outlinks.length).toBe(0);
    expect(related!.backlinks.length).toBe(0);
  });
});

// ── Inlink count ────────────────────────────────────────────────────

describe("inlink count", () => {
  test("returns 0 for docs with no inlinks", () => {
    const store = new DocumentStore();
    store.load([
      makeDoc({
        meta: { doc_id: "docs:lonely", file_path: "lonely.md", references: [] },
      }),
    ]);

    expect(store.getInlinkCount("docs:lonely")).toBe(0);
  });

  test("counts inlinks correctly", () => {
    const store = new DocumentStore();
    store.load([
      makeDoc({
        meta: { doc_id: "docs:a", file_path: "a.md", references: ["hub.md"] },
      }),
      makeDoc({
        meta: { doc_id: "docs:b", file_path: "b.md", references: ["hub.md"] },
      }),
      makeDoc({
        meta: { doc_id: "docs:hub", file_path: "hub.md", references: [] },
      }),
    ]);

    expect(store.getInlinkCount("docs:hub")).toBe(2);
    expect(store.getInlinkCount("docs:a")).toBe(0);
  });
});

// ── Inlink-boosted ranking ──────────────────────────────────────────

describe("inlink-boosted ranking", () => {
  test("documents with more inlinks rank higher", () => {
    const store = new DocumentStore();

    // Two docs with identical content about "authentication"
    // but one is referenced by other docs (more authoritative)
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:popular",
          file_path: "popular.md",
          title: "Popular Auth Guide",
          references: [],
        },
        tree: [
          makeNode({
            node_id: "docs:popular:n1",
            title: "Auth Guide",
            content: "Authentication system overview with token handling.",
          }),
        ],
      }),
      makeDoc({
        meta: {
          doc_id: "docs:obscure",
          file_path: "obscure.md",
          title: "Obscure Auth Note",
          references: [],
        },
        tree: [
          makeNode({
            node_id: "docs:obscure:n1",
            title: "Auth Note",
            content: "Authentication system overview with token handling.",
          }),
        ],
      }),
      // Three docs that reference "popular" but not "obscure"
      makeDoc({
        meta: {
          doc_id: "docs:ref1",
          file_path: "ref1.md",
          title: "Ref 1",
          references: ["popular.md"],
        },
        tree: [
          makeNode({
            node_id: "docs:ref1:n1",
            title: "Ref 1",
            content: "See the auth guide for details.",
          }),
        ],
      }),
      makeDoc({
        meta: {
          doc_id: "docs:ref2",
          file_path: "ref2.md",
          title: "Ref 2",
          references: ["popular.md"],
        },
        tree: [
          makeNode({
            node_id: "docs:ref2:n1",
            title: "Ref 2",
            content: "Refer to the auth guide.",
          }),
        ],
      }),
      makeDoc({
        meta: {
          doc_id: "docs:ref3",
          file_path: "ref3.md",
          title: "Ref 3",
          references: ["popular.md"],
        },
        tree: [
          makeNode({
            node_id: "docs:ref3:n1",
            title: "Ref 3",
            content: "Check the auth guide.",
          }),
        ],
      }),
    ]);

    const results = store.searchDocuments("authentication token");

    const popular = results.find((r) => r.doc_id === "docs:popular");
    const obscure = results.find((r) => r.doc_id === "docs:obscure");

    expect(popular).toBeDefined();
    expect(obscure).toBeDefined();
    // Popular doc has 3 inlinks, so should score higher
    expect(popular!.score).toBeGreaterThan(obscure!.score);
  });

  test("inlink boost can be disabled by setting to 0", () => {
    const store = new DocumentStore();

    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:linked",
          file_path: "linked.md",
          title: "Linked Doc",
          references: [],
        },
        tree: [
          makeNode({
            node_id: "docs:linked:n1",
            title: "Test",
            content: "Authentication overview.",
          }),
        ],
      }),
      makeDoc({
        meta: {
          doc_id: "docs:unlinked",
          file_path: "unlinked.md",
          title: "Unlinked Doc",
          references: [],
        },
        tree: [
          makeNode({
            node_id: "docs:unlinked:n1",
            title: "Test",
            content: "Authentication overview.",
          }),
        ],
      }),
      makeDoc({
        meta: {
          doc_id: "docs:linker",
          file_path: "linker.md",
          title: "Linker",
          references: ["linked.md"],
        },
        tree: [
          makeNode({
            node_id: "docs:linker:n1",
            title: "Linker",
            content: "Unrelated content here.",
          }),
        ],
      }),
    ]);

    // Disable inlink boost
    store.setRanking({ inlink_boost: 0 });

    // Need to reload for ranking to take effect on future searches
    // (inlink boost is applied at search time, not index time, so it works)
    const results = store.searchDocuments("authentication");

    const linked = results.find((r) => r.doc_id === "docs:linked");
    const unlinked = results.find((r) => r.doc_id === "docs:unlinked");

    expect(linked).toBeDefined();
    expect(unlinked).toBeDefined();
    // With boost disabled, identical content should have same score
    expect(linked!.score).toBe(unlinked!.score);
  });
});

// ── Backlinks with incremental updates ──────────────────────────────

describe("backlinks with incremental updates", () => {
  test("addDocument rebuilds backlinks", () => {
    const store = new DocumentStore();

    store.load([
      makeDoc({
        meta: { doc_id: "docs:target", file_path: "target.md", references: [] },
      }),
    ]);

    // Initially no backlinks
    expect(store.getInlinkCount("docs:target")).toBe(0);

    // Add a doc that references target
    store.addDocument(
      makeDoc({
        meta: {
          doc_id: "docs:new",
          file_path: "new.md",
          references: ["target.md"],
        },
      })
    );

    expect(store.getInlinkCount("docs:target")).toBe(1);
  });
});
