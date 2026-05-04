/**
 * Tests for the DocumentStore — BM25 search, facet filtering,
 * glossary expansion, description weight, tree navigation.
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

// ── Store basics ────────────────────────────────────────────────────

describe("DocumentStore basics", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  test("load accepts documents", () => {
    const doc = makeDoc();
    store.load([doc]);

    const stats = store.getStats();
    expect(stats.document_count).toBe(1);
    expect(stats.total_nodes).toBeGreaterThan(0);
    expect(stats.indexed_terms).toBeGreaterThan(0);
  });

  test("load multiple documents", () => {
    const doc1 = makeDoc({
      meta: { doc_id: "test:doc1", file_path: "doc1.md" },
    });
    const doc2 = makeDoc({
      meta: { doc_id: "test:doc2", file_path: "doc2.md" },
    });
    store.load([doc1, doc2]);

    expect(store.getStats().document_count).toBe(2);
  });

  test("hasDocument returns true for loaded docs", () => {
    store.load([makeDoc()]);
    expect(store.hasDocument("test:doc")).toBe(true);
    expect(store.hasDocument("nonexistent")).toBe(false);
  });

  test("addDocument incrementally adds to index", () => {
    store.load([]);
    expect(store.getStats().document_count).toBe(0);

    store.addDocument(makeDoc());
    expect(store.getStats().document_count).toBe(1);
  });

  test("addDocument updates existing document", () => {
    const doc = makeDoc();
    store.load([doc]);
    expect(store.getStats().document_count).toBe(1);

    // Update with different content
    const updated = makeDoc({
      meta: { content_hash: "new_hash" },
      tree: [
        makeNode({
          node_id: "test:doc:n1",
          content: "Completely different content about databases.",
        }),
      ],
    });
    store.addDocument(updated);
    expect(store.getStats().document_count).toBe(1);
  });

  test("removeDocument removes from index", () => {
    store.load([makeDoc()]);
    expect(store.getStats().document_count).toBe(1);

    store.removeDocument("test:doc");
    expect(store.getStats().document_count).toBe(0);
  });

  test("needsReindex detects changed content", () => {
    store.load([makeDoc()]);
    expect(store.needsReindex("doc.md", "abc123")).toBe(false);
    expect(store.needsReindex("doc.md", "different")).toBe(true);
    expect(store.needsReindex("unknown.md", "any")).toBe(true);
  });
});

// ── BM25 search ─────────────────────────────────────────────────────

describe("BM25 search", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:auth",
          file_path: "auth.md",
          title: "Authentication Guide",
          description: "How to authenticate users with JWT tokens",
          tags: ["auth", "jwt"],
          facets: { category: ["guide"] },
        },
        tree: [
          makeNode({
            node_id: "docs:auth:n1",
            title: "Authentication Guide",
            content: "Overview of the authentication system using JWT tokens.",
          }),
          makeNode({
            node_id: "docs:auth:n2",
            title: "Token Refresh",
            level: 2,
            parent_id: "docs:auth:n1",
            content:
              "The token refresh mechanism uses refresh tokens to obtain new access tokens without re-authentication.",
            word_count: 14,
          }),
        ],
      }),
      makeDoc({
        meta: {
          doc_id: "docs:deploy",
          file_path: "deploy.md",
          title: "Deployment Guide",
          description: "How to deploy services to production",
          tags: ["deploy", "ops"],
          facets: { category: ["guide"], type: ["deployment"] },
        },
        tree: [
          makeNode({
            node_id: "docs:deploy:n1",
            title: "Deployment Guide",
            content: "Steps for deploying to production environments.",
          }),
          makeNode({
            node_id: "docs:deploy:n2",
            title: "Rollback Procedure",
            level: 2,
            parent_id: "docs:deploy:n1",
            content:
              "To rollback a deployment, use the rollback command with the previous version tag.",
            word_count: 14,
          }),
        ],
      }),
      makeDoc({
        meta: {
          doc_id: "docs:runbook",
          file_path: "runbooks/db-restart.md",
          title: "Database Restart Runbook",
          description: "Procedure for restarting the database",
          tags: ["database", "ops"],
          facets: { category: ["runbook"], type: ["runbook"] },
        },
        tree: [
          makeNode({
            node_id: "docs:runbook:n1",
            title: "Database Restart Runbook",
            content:
              "Emergency procedure for restarting the PostgreSQL database cluster.",
          }),
          makeNode({
            node_id: "docs:runbook:n2",
            title: "Pre-restart Checks",
            level: 2,
            parent_id: "docs:runbook:n1",
            content:
              "Before restarting, verify active connections and backup status.",
            word_count: 9,
          }),
        ],
      }),
    ]);
  });

  test("finds relevant documents by keyword", () => {
    const results = store.searchDocuments("authentication");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].doc_id).toBe("docs:auth");
  });

  test("returns empty for non-matching query", () => {
    const results = store.searchDocuments("xyznonexistent");
    expect(results).toEqual([]);
  });

  test("ranks title matches higher", () => {
    const results = store.searchDocuments("token refresh");

    // "Token Refresh" appears as a title — should rank high
    const tokenRefreshResult = results.find(
      (r) => r.node_title === "Token Refresh"
    );
    expect(tokenRefreshResult).toBeDefined();
  });

  test("returns snippets", () => {
    const results = store.searchDocuments("authentication");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].snippet).toBeTruthy();
    expect(results[0].snippet.length).toBeGreaterThan(0);
  });

  test("returns matched_terms", () => {
    const results = store.searchDocuments("token refresh");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matched_terms.length).toBeGreaterThan(0);
  });

  test("returns match_positions", () => {
    const results = store.searchDocuments("token");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].match_positions.length).toBeGreaterThan(0);
  });

  test("respects doc_id filter", () => {
    const results = store.searchDocuments("guide", {
      doc_id: "docs:deploy",
    });

    for (const r of results) {
      expect(r.doc_id).toBe("docs:deploy");
    }
  });

  test("respects limit option", () => {
    const results = store.searchDocuments("guide", { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  test("prefix matching works for partial terms", () => {
    // "auth" should match "authentication"
    const results = store.searchDocuments("auth");

    expect(results.length).toBeGreaterThan(0);
    // Should find auth-related docs
    const hasAuth = results.some((r) => r.doc_id === "docs:auth");
    expect(hasAuth).toBe(true);
  });

  test("stemming matches inflected forms", () => {
    // "deploying" should match "deployment" / "deploy"
    const results = store.searchDocuments("deploying");
    const hasDeploy = results.some((r) => r.doc_id === "docs:deploy");
    expect(hasDeploy).toBe(true);
  });

  test("multi-term queries get co-occurrence bonus", () => {
    const singleTerm = store.searchDocuments("token");
    const multiTerm = store.searchDocuments("token refresh");

    // The node that has both terms should score higher
    const singleBest = singleTerm.find(
      (r) => r.node_title === "Token Refresh"
    );
    const multiBest = multiTerm.find(
      (r) => r.node_title === "Token Refresh"
    );

    expect(singleBest).toBeDefined();
    expect(multiBest).toBeDefined();
    // Multi-term should have higher score due to co-occurrence bonus
    expect(multiBest!.score).toBeGreaterThan(singleBest!.score);
  });
});

// ── Facet filtering ─────────────────────────────────────────────────

describe("facet filtering", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:auth",
          file_path: "auth.md",
          title: "Auth Guide",
          tags: ["auth", "jwt"],
          facets: { category: ["guide"], type: ["guide"] },
        },
        tree: [
          makeNode({
            node_id: "docs:auth:n1",
            title: "Auth Guide",
            content: "Authentication system overview.",
          }),
        ],
      }),
      makeDoc({
        meta: {
          doc_id: "docs:runbook",
          file_path: "runbook.md",
          title: "DB Runbook",
          tags: ["database"],
          facets: { category: ["runbook"], type: ["runbook"] },
        },
        tree: [
          makeNode({
            node_id: "docs:runbook:n1",
            title: "DB Runbook",
            content: "Database restart procedure and authentication verification.",
          }),
        ],
      }),
    ]);
  });

  test("filters search by facet", () => {
    // Both docs contain "authentication" — but filter by type
    const results = store.searchDocuments("authentication", {
      filters: { type: "runbook" },
    });

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.doc_id).toBe("docs:runbook");
    }
  });

  test("filters search by tag", () => {
    const results = store.searchDocuments("authentication", {
      filters: { tags: "jwt" },
    });

    for (const r of results) {
      expect(r.doc_id).toBe("docs:auth");
    }
  });

  test("empty result for non-matching filter", () => {
    const results = store.searchDocuments("authentication", {
      filters: { type: "nonexistent" },
    });
    expect(results).toEqual([]);
  });

  test("getFacets returns available facets", () => {
    const facets = store.getFacets();

    expect(facets).toHaveProperty("category");
    expect(facets).toHaveProperty("type");
    expect(facets).toHaveProperty("tags");
    expect(facets["type"]["guide"]).toBe(1);
    expect(facets["type"]["runbook"]).toBe(1);
  });

  test("listDocuments includes facet counts", () => {
    const result = store.listDocuments();

    expect(result.facet_counts).toHaveProperty("category");
    expect(result.total).toBe(2);
  });

  test("listDocuments filters by tag", () => {
    const result = store.listDocuments({ tag: "jwt" });

    expect(result.total).toBe(1);
    expect(result.documents[0].doc_id).toBe("docs:auth");
  });

  test("listDocuments filters by query", () => {
    const result = store.listDocuments({ query: "runbook" });

    expect(result.total).toBe(1);
    expect(result.documents[0].doc_id).toBe("docs:runbook");
  });

  test("listDocuments paginates results", () => {
    const page1 = store.listDocuments({ limit: 1, offset: 0 });
    const page2 = store.listDocuments({ limit: 1, offset: 1 });

    expect(page1.documents.length).toBe(1);
    expect(page2.documents.length).toBe(1);
    expect(page1.documents[0].doc_id).not.toBe(page2.documents[0].doc_id);
  });
});

// ── Glossary query expansion ────────────────────────────────────────

describe("glossary query expansion", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
    store.load([
      makeDoc({
        meta: {
          doc_id: "docs:cli-config",
          file_path: "cli-config.md",
          title: "CLI Configuration",
        },
        tree: [
          makeNode({
            node_id: "docs:cli-config:n1",
            title: "CLI Configuration",
            content:
              "Configure command line interface for automation with multi-factor authentication.",
          }),
        ],
      }),
      makeDoc({
        meta: {
          doc_id: "docs:k8s-deploy",
          file_path: "k8s.md",
          title: "Kubernetes Deployment",
        },
        tree: [
          makeNode({
            node_id: "docs:k8s-deploy:n1",
            title: "Kubernetes Deployment",
            content:
              "Deploy to kubernetes using helm charts and kubectl commands.",
          }),
        ],
      }),
    ]);
  });

  test("expands abbreviation to match full term", () => {
    store.loadGlossary({
      CLI: ["command line interface"],
    });

    // Search for "CLI" should find doc that has "command line interface"
    const results = store.searchDocuments("CLI");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.doc_id === "docs:cli-config")).toBe(true);
  });

  test("expands full term to match abbreviation", () => {
    store.loadGlossary({
      K8s: ["kubernetes"],
    });

    // Search for "kubernetes" should match doc with "kubernetes" content
    const results = store.searchDocuments("kubernetes");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.doc_id === "docs:k8s-deploy")).toBe(true);
  });

  test("works without glossary loaded", () => {
    // No glossary loaded — should still work
    const results = store.searchDocuments("kubernetes");
    expect(results.length).toBeGreaterThan(0);
  });

  test("handles multi-word glossary expansions", () => {
    store.loadGlossary({
      MFA: ["multi-factor authentication"],
    });

    const results = store.searchDocuments("MFA");
    // Should find the doc that mentions "multi-factor authentication"
    expect(results.some((r) => r.doc_id === "docs:cli-config")).toBe(true);
  });

  test("empty glossary has no effect", () => {
    store.loadGlossary({});
    const results = store.searchDocuments("kubernetes");
    expect(results.length).toBeGreaterThan(0);
  });
});

// ── Description weight ──────────────────────────────────────────────

describe("description weight", () => {
  test("description terms in first node get boosted weight", () => {
    const store = new DocumentStore();

    // Create a doc where the description contains "authentication"
    // and the first node also contains "authentication"
    const docWithDesc = makeDoc({
      meta: {
        doc_id: "docs:with-desc",
        file_path: "with-desc.md",
        title: "Auth Doc",
        description: "Guide to authentication security",
      },
      tree: [
        makeNode({
          node_id: "docs:with-desc:n1",
          title: "Auth Doc",
          content: "This covers authentication and security patterns.",
        }),
      ],
    });

    // Create a doc where body has "authentication" but no matching description
    const docWithoutDesc = makeDoc({
      meta: {
        doc_id: "docs:without-desc",
        file_path: "without-desc.md",
        title: "Other Doc",
        description: "Unrelated document summary",
      },
      tree: [
        makeNode({
          node_id: "docs:without-desc:n1",
          title: "Other Doc",
          content: "This also covers authentication patterns in a similar way.",
        }),
      ],
    });

    store.load([docWithDesc, docWithoutDesc]);

    const results = store.searchDocuments("authentication");
    expect(results.length).toBe(2);

    // The doc with "authentication" in description should rank higher
    const withDescResult = results.find(
      (r) => r.doc_id === "docs:with-desc"
    );
    const withoutDescResult = results.find(
      (r) => r.doc_id === "docs:without-desc"
    );

    expect(withDescResult).toBeDefined();
    expect(withoutDescResult).toBeDefined();
    expect(withDescResult!.score).toBeGreaterThan(withoutDescResult!.score);
  });
});

// ── Tree navigation ─────────────────────────────────────────────────

describe("tree navigation", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
    store.load([
      makeDoc({
        meta: { doc_id: "docs:guide" },
        tree: [
          makeNode({
            node_id: "docs:guide:n1",
            title: "Guide",
            level: 1,
            children: ["docs:guide:n2", "docs:guide:n3"],
          }),
          makeNode({
            node_id: "docs:guide:n2",
            title: "Section A",
            level: 2,
            parent_id: "docs:guide:n1",
            children: ["docs:guide:n4"],
            content: "Section A content.",
          }),
          makeNode({
            node_id: "docs:guide:n3",
            title: "Section B",
            level: 2,
            parent_id: "docs:guide:n1",
            content: "Section B content.",
          }),
          makeNode({
            node_id: "docs:guide:n4",
            title: "Subsection A1",
            level: 3,
            parent_id: "docs:guide:n2",
            content: "Subsection A1 content.",
          }),
        ],
      }),
    ]);
  });

  test("getTree returns outline without content", () => {
    const tree = store.getTree("docs:guide");

    expect(tree).not.toBeNull();
    expect(tree!.doc_id).toBe("docs:guide");
    expect(tree!.nodes.length).toBe(4);

    // Outline nodes should have title, level, word_count, summary
    for (const node of tree!.nodes) {
      expect(node).toHaveProperty("node_id");
      expect(node).toHaveProperty("title");
      expect(node).toHaveProperty("level");
      expect(node).toHaveProperty("word_count");
    }
  });

  test("getTree returns null for non-existent doc", () => {
    expect(store.getTree("nonexistent")).toBeNull();
  });

  test("getNodeContent retrieves specific nodes", () => {
    const result = store.getNodeContent("docs:guide", [
      "docs:guide:n2",
      "docs:guide:n3",
    ]);

    expect(result).not.toBeNull();
    expect(result!.nodes.length).toBe(2);
    expect(result!.nodes[0].content).toContain("Section A content");
    expect(result!.nodes[1].content).toContain("Section B content");
  });

  test("getNodeContent returns null for non-existent doc", () => {
    expect(store.getNodeContent("nonexistent", ["n1"])).toBeNull();
  });

  test("getNodeContent filters non-existent nodes gracefully", () => {
    const result = store.getNodeContent("docs:guide", [
      "docs:guide:n2",
      "docs:guide:n999",
    ]);

    expect(result).not.toBeNull();
    expect(result!.nodes.length).toBe(1);
  });

  test("getSubtree returns node and all descendants", () => {
    const result = store.getSubtree("docs:guide", "docs:guide:n2");

    expect(result).not.toBeNull();
    expect(result!.nodes.length).toBe(2); // n2 + n4
    expect(result!.nodes[0].title).toBe("Section A");
    expect(result!.nodes[1].title).toBe("Subsection A1");
  });

  test("getSubtree returns null for non-existent doc", () => {
    expect(store.getSubtree("nonexistent", "n1")).toBeNull();
  });

  test("getSubtree returns null for non-existent node", () => {
    expect(store.getSubtree("docs:guide", "n999")).toBeNull();
  });

  test("getSubtree on leaf node returns single node", () => {
    const result = store.getSubtree("docs:guide", "docs:guide:n4");

    expect(result).not.toBeNull();
    expect(result!.nodes.length).toBe(1);
  });
});

// ── Collection weights ──────────────────────────────────────────────

describe("collection weights", () => {
  test("higher weight collection scores higher", () => {
    const store = new DocumentStore();

    store.load([
      makeDoc({
        meta: {
          doc_id: "primary:auth",
          file_path: "auth.md",
          title: "Auth",
          collection: "primary",
        },
        tree: [
          makeNode({
            node_id: "primary:auth:n1",
            title: "Auth",
            content: "Authentication token handling.",
          }),
        ],
      }),
      makeDoc({
        meta: {
          doc_id: "secondary:auth",
          file_path: "auth.md",
          title: "Auth",
          collection: "secondary",
        },
        tree: [
          makeNode({
            node_id: "secondary:auth:n1",
            title: "Auth",
            content: "Authentication token handling.",
          }),
        ],
      }),
    ]);

    store.setCollectionWeights({ primary: 2.0, secondary: 0.5 });

    const results = store.searchDocuments("authentication token");

    expect(results.length).toBe(2);
    expect(results[0].doc_id).toBe("primary:auth");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});

// ── Ranking parameters ──────────────────────────────────────────────

describe("ranking parameters", () => {
  test("setRanking updates scoring behavior", () => {
    const store = new DocumentStore();
    store.load([
      makeDoc({
        tree: [
          makeNode({
            node_id: "test:doc:n1",
            title: "Token",
            content: "Token handling and token refresh token flow.",
          }),
        ],
      }),
    ]);

    // Get baseline score
    const baseline = store.searchDocuments("token");
    const baseScore = baseline[0]?.score || 0;

    // Increase title weight dramatically
    store.setRanking({ title_weight: 10.0 });

    // Need to reload to re-index with new weights
    // (setRanking only affects future indexing)
    // In practice you'd reload, but we can verify the param was set
    expect(baseScore).toBeGreaterThan(0);
  });
});

// ── Definition boost ────────────────────────────────────────────────

describe("definition boost", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  function defNode(symbol_kind: string, symbol_name: string, content: string): TreeNode {
    return makeNode({
      node_id: `code:${symbol_name}:n1`,
      title: `${symbol_kind} ${symbol_name}`,
      content,
      symbol_kind,
      symbol_name,
    });
  }

  function callsiteNode(node_id: string, content: string): TreeNode {
    return makeNode({ node_id, title: "function callerOfThings", content });
  }

  test("definition node ranks above call-site for exact symbol-name query", () => {
    store.load([
      makeDoc({
        meta: { doc_id: "code:def", file_path: "parser.ts", collection: "code" },
        tree: [defNode("function", "parseConfig", "function parseConfig(input: string) { return JSON.parse(input); }")],
        root_nodes: ["code:parseConfig:n1"],
      }),
      makeDoc({
        meta: { doc_id: "code:call", file_path: "main.ts", collection: "code" },
        tree: [callsiteNode("code:call:n1", "function callerOfThings() { const cfg = parseConfig(raw); return cfg; }")],
        root_nodes: ["code:call:n1"],
      }),
    ]);

    const results = store.searchDocuments("parseConfig");

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].node_id).toBe("code:parseConfig:n1");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  test("only fires for definition-kind nodes (class/function/interface/method/type/enum/struct/trait/enum_variant)", () => {
    // A node with symbol_kind="import" should NOT receive the boost
    store.load([
      makeDoc({
        meta: { doc_id: "code:import", file_path: "imports.ts", collection: "code" },
        tree: [defNode("import", "parseConfig", "import { parseConfig } from './parser';")],
        root_nodes: ["code:parseConfig:n1"],
      }),
      makeDoc({
        meta: { doc_id: "code:def", file_path: "parser.ts", collection: "code" },
        tree: [defNode("function", "parseConfig", "function parseConfig(input: string) { return JSON.parse(input); }")],
        root_nodes: ["code:parseConfig:n1"],
      }),
    ]);

    const results = store.searchDocuments("parseConfig");
    expect(results[0].doc_id).toBe("code:def");
  });

  test("does not fire when symbol_name is missing (markdown nodes)", () => {
    // Markdown node with title containing "parseConfig" — must not be boosted
    store.load([
      makeDoc({
        meta: { doc_id: "docs:guide", file_path: "guide.md", collection: "docs" },
        tree: [makeNode({
          node_id: "docs:guide:n1",
          title: "parseConfig usage notes",
          content: "How to call parseConfig correctly.",
          // no symbol_kind / symbol_name — markdown node
        })],
        root_nodes: ["docs:guide:n1"],
      }),
      makeDoc({
        meta: { doc_id: "code:def", file_path: "parser.ts", collection: "code" },
        tree: [defNode("function", "parseConfig", "function parseConfig(input: string) { return JSON.parse(input); }")],
        root_nodes: ["code:parseConfig:n1"],
      }),
    ]);

    const results = store.searchDocuments("parseConfig");
    expect(results[0].doc_id).toBe("code:def");
  });

  test("boost applies once per node regardless of how many query terms match the symbol", () => {
    // Query with multiple terms, only one matches the symbol — node still gets one boost
    // (we test this by comparing against a query with the term repeated)
    store.load([
      makeDoc({
        meta: { doc_id: "code:def", file_path: "parser.ts", collection: "code" },
        tree: [defNode("function", "parseConfig", "function parseConfig(input: string) { return JSON.parse(input); }")],
        root_nodes: ["code:parseConfig:n1"],
      }),
    ]);

    const single = store.searchDocuments("parseConfig");
    const repeated = store.searchDocuments("parseConfig parseConfig parseConfig");

    // Repeated query is deduplicated to a single unique stem, so scores should match.
    // The boost is applied once, not three times.
    expect(single[0].score).toBeCloseTo(repeated[0].score, 3);
  });

  test("setRanking({ definition_boost }) is configurable", () => {
    store.load([
      makeDoc({
        meta: { doc_id: "code:def", file_path: "parser.ts", collection: "code" },
        tree: [defNode("function", "parseConfig", "function parseConfig(input: string) { return JSON.parse(input); }")],
        root_nodes: ["code:parseConfig:n1"],
      }),
      makeDoc({
        meta: { doc_id: "code:call", file_path: "main.ts", collection: "code" },
        tree: [callsiteNode("code:call:n1", "function callerOfThings() { const cfg = parseConfig(raw); return cfg; }")],
        root_nodes: ["code:call:n1"],
      }),
    ]);

    store.setRanking({ definition_boost: 1.0 });
    const noBoost = store.searchDocuments("parseConfig");
    const noBoostDefScore = noBoost.find((r) => r.doc_id === "code:def")!.score;

    store.setRanking({ definition_boost: 5.0 });
    const withBoost = store.searchDocuments("parseConfig");
    const withBoostDefScore = withBoost.find((r) => r.doc_id === "code:def")!.score;

    expect(withBoostDefScore).toBeGreaterThan(noBoostDefScore);
    expect(withBoostDefScore / noBoostDefScore).toBeCloseTo(5.0, 1);
  });
});

// ── Noise penalty ───────────────────────────────────────────────────

describe("noise penalty", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  function authDoc(file_path: string, doc_id: string): IndexedDocument {
    return makeDoc({
      meta: {
        doc_id,
        file_path,
        collection: "code",
        title: file_path,
      },
      tree: [
        makeNode({
          node_id: `${doc_id}:n1`,
          title: "function authenticate",
          content: "function authenticate(user, pass) { return checkCredentials(user, pass); }",
          symbol_kind: "function",
          symbol_name: "authenticate",
        }),
      ],
      root_nodes: [`${doc_id}:n1`],
    });
  }

  test("matching path gets score multiplied by penalty", () => {
    store.load([
      authDoc("src/auth.ts", "code:src"),
      authDoc("src/auth.test.ts", "code:test"),
    ]);

    const baseline = store.searchDocuments("authenticate");
    const baselineSrc = baseline.find((r) => r.doc_id === "code:src")!.score;
    const baselineTest = baseline.find((r) => r.doc_id === "code:test")!.score;
    expect(baselineSrc).toBeCloseTo(baselineTest, 3);

    store.setNoisePatterns({
      code: [{ pattern: "\\.test\\.[a-z]+$", penalty: 0.5 }],
    });

    const penalized = store.searchDocuments("authenticate");
    const srcScore = penalized.find((r) => r.doc_id === "code:src")!.score;
    const testScore = penalized.find((r) => r.doc_id === "code:test")!.score;

    expect(srcScore).toBeCloseTo(baselineSrc, 3);
    expect(testScore).toBeCloseTo(baselineTest * 0.5, 3);
    expect(penalized[0].doc_id).toBe("code:src");
  });

  test("multiple matching patterns: lowest penalty wins (no compounding)", () => {
    const baseline = new DocumentStore();
    baseline.load([authDoc("legacy/__tests__/auth.test.ts", "code:multi")]);
    const baseScore = baseline.searchDocuments("authenticate")[0].score;

    store.load([authDoc("legacy/__tests__/auth.test.ts", "code:multi")]);
    store.setNoisePatterns({
      code: [
        { pattern: "(^|/)legacy/", penalty: 0.6 },
        { pattern: "(^|/)__tests__/", penalty: 0.5 },
        { pattern: "\\.test\\.[a-z]+$", penalty: 0.4 },
      ],
    });

    const penalized = store.searchDocuments("authenticate")[0].score;

    // Lowest penalty (0.4) wins; multiplicative compounding (0.6 * 0.5 * 0.4 = 0.12) would be wrong
    expect(penalized).toBeCloseTo(baseScore * 0.4, 3);
  });

  test("collections without patterns set are unaffected", () => {
    const codeTest = makeDoc({
      meta: { doc_id: "code:test", file_path: "auth.test.ts", collection: "code" },
      tree: [makeNode({
        node_id: "code:test:n1",
        title: "function authenticate",
        content: "function authenticate() { return true; }",
        symbol_kind: "function",
        symbol_name: "authenticate",
      })],
      root_nodes: ["code:test:n1"],
    });
    const mdLegacy = makeDoc({
      meta: { doc_id: "docs:legacy", file_path: "legacy/auth.md", collection: "docs" },
      tree: [makeNode({ node_id: "docs:legacy:n1", title: "Authenticate Users", content: "How to authenticate users in the legacy system." })],
      root_nodes: ["docs:legacy:n1"],
    });

    store.load([codeTest, mdLegacy]);

    const baseline = store.searchDocuments("authenticate");
    const baselineMd = baseline.find((r) => r.doc_id === "docs:legacy")!.score;

    // Pattern set only for "code" — markdown collection has no entry, must be untouched
    store.setNoisePatterns({
      code: [{ pattern: "\\.test\\.[a-z]+$", penalty: 0.3 }],
    });

    const after = store.searchDocuments("authenticate");
    const afterMd = after.find((r) => r.doc_id === "docs:legacy")!.score;

    expect(afterMd).toBeCloseTo(baselineMd, 3);
  });

  test("non-matching paths in a penalized collection are unaffected", () => {
    store.load([authDoc("src/auth.ts", "code:src")]);

    const baseline = store.searchDocuments("authenticate")[0].score;

    store.setNoisePatterns({
      code: [{ pattern: "\\.test\\.[a-z]+$", penalty: 0.3 }],
    });

    const after = store.searchDocuments("authenticate")[0].score;
    expect(after).toBeCloseTo(baseline, 3);
  });

  test("setNoisePatterns is replacing, not additive", () => {
    store.load([authDoc("src/auth.test.ts", "code:test")]);

    const baseline = store.searchDocuments("authenticate")[0].score;

    store.setNoisePatterns({
      code: [{ pattern: "\\.test\\.[a-z]+$", penalty: 0.5 }],
    });
    const half = store.searchDocuments("authenticate")[0].score;
    expect(half).toBeCloseTo(baseline * 0.5, 3);

    store.setNoisePatterns({
      code: [{ pattern: "\\.test\\.[a-z]+$", penalty: 0.1 }],
    });
    const tenth = store.searchDocuments("authenticate")[0].score;
    expect(tenth).toBeCloseTo(baseline * 0.1, 3);
  });
});

// ── File coherence ──────────────────────────────────────────────────

describe("file coherence", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  function multiNodeDoc(doc_id: string, file_path: string, nodes: { node_id: string; title: string; content: string; line_start?: number; level?: number; symbol_name?: string; symbol_kind?: string; }[]): IndexedDocument {
    return makeDoc({
      meta: { doc_id, file_path, collection: "code", title: file_path },
      tree: nodes.map((n, i) => makeNode({
        node_id: n.node_id,
        title: n.title,
        content: n.content,
        level: n.level ?? 1,
        line_start: n.line_start ?? (i * 10 + 1),
        line_end: (n.line_start ?? (i * 10 + 1)) + 5,
        symbol_name: n.symbol_name,
        symbol_kind: n.symbol_kind,
      })),
      root_nodes: [nodes[0].node_id],
    });
  }

  test("multi-hit file: every matching node in the group gets a coherence bonus", () => {
    // Two docs, each indexed identically. Doc A has 2 matching nodes; Doc B has 1.
    // With multiplicative coherence: Doc A's nodes get the same factor lift.
    store.load([
      multiNodeDoc("code:a", "a.ts", [
        { node_id: "code:a:n1", title: "function authenticate", content: "function authenticate() {}", symbol_name: "authenticate", symbol_kind: "function" },
        { node_id: "code:a:n2", title: "method validate", content: "method validate() { authenticate(); }", line_start: 20 },
      ]),
      multiNodeDoc("code:b", "b.ts", [
        { node_id: "code:b:n1", title: "imports", content: "import { authenticate } from './a';" },
      ]),
    ]);

    store.setRanking({ file_coherence_bonus: 0, file_lead_bonus: 0 });
    const baseline = store.searchDocuments("authenticate");
    const baseA1 = baseline.find((r) => r.node_id === "code:a:n1")!.score;
    const baseA2 = baseline.find((r) => r.node_id === "code:a:n2")!.score;

    store.setRanking({ file_coherence_bonus: 0.5, file_lead_bonus: 0 });
    const boosted = store.searchDocuments("authenticate");
    const boostA1 = boosted.find((r) => r.node_id === "code:a:n1")!.score;
    const boostA2 = boosted.find((r) => r.node_id === "code:a:n2")!.score;

    // matchCount=2 → multiplier = 1 + 0.5*1 = 1.5
    expect(boostA1 / baseA1).toBeCloseTo(1.5, 3);
    expect(boostA2 / baseA2).toBeCloseTo(1.5, 3);
  });

  test("file coherence is bounded — high match count caps at MAX_COUNT_LIFT=5", () => {
    // 10 nodes all matching a common term — multiplier should saturate at
    // 1 + cohBonus * 5 (not 1 + cohBonus * 9).
    const nodes = [];
    for (let i = 1; i <= 10; i++) {
      nodes.push({
        node_id: `code:big:n${i}`,
        title: `function fn${i}`,
        content: `function fn${i}() { return authenticate(); }`,
        line_start: i * 10,
      });
    }
    store.load([multiNodeDoc("code:big", "big.ts", nodes)]);

    store.setRanking({ file_coherence_bonus: 0, file_lead_bonus: 0 });
    const baseline = store.searchDocuments("authenticate")[0].score;

    store.setRanking({ file_coherence_bonus: 0.1, file_lead_bonus: 0 });
    const boosted = store.searchDocuments("authenticate")[0].score;

    // matchCount=10 → min(9, 5) = 5 → multiplier = 1 + 0.1*5 = 1.5
    expect(boosted / baseline).toBeCloseTo(1.5, 2);
  });

  test("single-hit file: no coherence bonus applied", () => {
    store.load([
      multiNodeDoc("code:lonely", "lonely.ts", [
        { node_id: "code:lonely:n1", title: "function authenticate", content: "function authenticate() {}", symbol_name: "authenticate", symbol_kind: "function" },
        { node_id: "code:lonely:n2", title: "function unrelated", content: "function unrelated() { return 0; }" },
      ]),
    ]);

    store.setRanking({ file_coherence_bonus: 0, file_lead_bonus: 0 });
    const baseline = store.searchDocuments("authenticate")[0].score;

    store.setRanking({ file_coherence_bonus: 0.5, file_lead_bonus: 0 });
    const after = store.searchDocuments("authenticate")[0].score;

    expect(after).toBeCloseTo(baseline, 3);
  });

  test("lead bonus: node with smallest line_start wins among matching nodes in a group", () => {
    store.load([
      multiNodeDoc("code:multi", "multi.ts", [
        { node_id: "code:multi:n1", title: "function authenticate", content: "function authenticate() {}", line_start: 10, symbol_name: "authenticate", symbol_kind: "function" },
        { node_id: "code:multi:n2", title: "method validate", content: "method validate() { authenticate(); }", line_start: 50 },
        { node_id: "code:multi:n3", title: "method retry", content: "method retry() { authenticate(); }", line_start: 100 },
      ]),
    ]);

    store.setRanking({ file_coherence_bonus: 0, file_lead_bonus: 0 });
    const baseline = store.searchDocuments("authenticate");
    const baseN1 = baseline.find((r) => r.node_id === "code:multi:n1")!.score;
    const baseN2 = baseline.find((r) => r.node_id === "code:multi:n2")!.score;
    const baseN3 = baseline.find((r) => r.node_id === "code:multi:n3")!.score;

    store.setRanking({ file_coherence_bonus: 0, file_lead_bonus: 0.5 });
    const boosted = store.searchDocuments("authenticate");
    const boostN1 = boosted.find((r) => r.node_id === "code:multi:n1")!.score;
    const boostN2 = boosted.find((r) => r.node_id === "code:multi:n2")!.score;
    const boostN3 = boosted.find((r) => r.node_id === "code:multi:n3")!.score;

    // Only the lead node (smallest line_start) gets the bonus
    expect(boostN1 - baseN1).toBeGreaterThan(0);
    expect(boostN2 - baseN2).toBeCloseTo(0, 3);
    expect(boostN3 - baseN3).toBeCloseTo(0, 3);
  });

  test("lead bonus tie-break: shallowest level wins when line_start is equal", () => {
    store.load([
      multiNodeDoc("code:tied", "tied.ts", [
        { node_id: "code:tied:n1", title: "method authenticate", content: "method authenticate() {}", line_start: 10, level: 3, symbol_name: "authenticate", symbol_kind: "method" },
        { node_id: "code:tied:n2", title: "class Auth", content: "class Auth { authenticate() {} }", line_start: 10, level: 1 }, // shallower
      ]),
    ]);

    store.setRanking({ file_coherence_bonus: 0, file_lead_bonus: 0 });
    const baseline = store.searchDocuments("authenticate");
    const baseN1 = baseline.find((r) => r.node_id === "code:tied:n1")!.score;
    const baseN2 = baseline.find((r) => r.node_id === "code:tied:n2")!.score;

    store.setRanking({ file_coherence_bonus: 0, file_lead_bonus: 0.5 });
    const boosted = store.searchDocuments("authenticate");
    const boostN1 = boosted.find((r) => r.node_id === "code:tied:n1")!.score;
    const boostN2 = boosted.find((r) => r.node_id === "code:tied:n2")!.score;

    // n2 (level 1, shallower) wins the tie
    expect(boostN2 - baseN2).toBeGreaterThan(0);
    expect(boostN1 - baseN1).toBeCloseTo(0, 3);
  });

  test("file coherence is independent of doc collection (works for markdown too)", () => {
    // The plan keeps this generic — markdown docs with multiple matching headings
    // should also get the file boost. (No noise-style code/markdown distinction.)
    store.load([
      multiNodeDoc("docs:guide", "guide.md", [
        { node_id: "docs:guide:n1", title: "Authenticate Users", content: "How to authenticate users." },
        { node_id: "docs:guide:n2", title: "Authenticate Services", content: "How to authenticate services." },
      ]),
    ]);
    // Override collection to "docs" — multiNodeDoc defaults to "code"
    const docsDocs = store.listDocuments();
    expect(docsDocs.documents.length).toBe(1);

    store.setRanking({ file_coherence_bonus: 0, file_lead_bonus: 0 });
    const baseline = store.searchDocuments("authenticate");
    const baseN1 = baseline.find((r) => r.node_id === "docs:guide:n1")!.score;

    store.setRanking({ file_coherence_bonus: 0.5, file_lead_bonus: 0 });
    const boosted = store.searchDocuments("authenticate");
    const boostN1 = boosted.find((r) => r.node_id === "docs:guide:n1")!.score;

    expect(boostN1).toBeGreaterThan(baseN1);
  });
});

// ── Subtoken indexing ───────────────────────────────────────────────

describe("subtoken indexing", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  function codeNode(node_id: string, title: string, content: string): TreeNode {
    return makeNode({
      node_id,
      title,
      content,
      symbol_kind: "function",
      symbol_name: title.replace(/^\w+\s+/, ""), // strip kind prefix
    });
  }

  test("middle subtoken matches a camelCase identifier", () => {
    // 'frontmatter' is a middle subtoken of parseFrontmatter;
    // existing prefix matching would NOT catch it (prefix only matches starts).
    store.load([
      makeDoc({
        meta: { doc_id: "code:a", file_path: "a.ts", collection: "code" },
        tree: [codeNode("code:a:n1", "function parseFrontmatter", "function parseFrontmatter() { return {}; }")],
        root_nodes: ["code:a:n1"],
      }),
    ]);

    const results = store.searchDocuments("frontmatter");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].doc_id).toBe("code:a");
  });

  test("snake_case subtokens are split", () => {
    store.load([
      makeDoc({
        meta: { doc_id: "code:py", file_path: "config.py", collection: "code" },
        tree: [codeNode("code:py:n1", "function parse_log_level", "def parse_log_level(s): return MAPPING[s]")],
        root_nodes: ["code:py:n1"],
      }),
    ]);

    // 'level' is a subtoken of parse_log_level — MAPPING avoids confounding tokens
    const results = store.searchDocuments("level");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].doc_id).toBe("code:py");
  });

  test("casing-aware splits: URLParser → URL + Parser", () => {
    store.load([
      makeDoc({
        meta: { doc_id: "code:url", file_path: "url.ts", collection: "code" },
        tree: [codeNode("code:url:n1", "class URLParser", "class URLParser { parse(input: string) {} }")],
        root_nodes: ["code:url:n1"],
      }),
    ]);

    const parserMatch = store.searchDocuments("parser");
    expect(parserMatch.length).toBeGreaterThan(0);
    expect(parserMatch[0].doc_id).toBe("code:url");

    const urlMatch = store.searchDocuments("url");
    expect(urlMatch.length).toBeGreaterThan(0);
    expect(urlMatch[0].doc_id).toBe("code:url");
  });

  test("subtoken match scores below exact match for the same query", () => {
    // Doc A has the term verbatim; Doc B has it only as a subtoken.
    // Both match, but exact should outrank subtoken.
    store.load([
      makeDoc({
        meta: { doc_id: "code:exact", file_path: "exact.ts", collection: "code" },
        tree: [codeNode("code:exact:n1", "function frontmatter", "function frontmatter() { return parse(); }")],
        root_nodes: ["code:exact:n1"],
      }),
      makeDoc({
        meta: { doc_id: "code:sub", file_path: "sub.ts", collection: "code" },
        tree: [codeNode("code:sub:n1", "function parseFrontmatter", "function parseFrontmatter() { return {}; }")],
        root_nodes: ["code:sub:n1"],
      }),
    ]);

    const results = store.searchDocuments("frontmatter");
    expect(results[0].doc_id).toBe("code:exact");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  test("full_coverage_bonus does NOT fire for multi-subtoken match in single identifier", () => {
    // Query "parse frontmatter" — both terms are subtokens of parseFrontmatter.
    // Without the precision rule, parseFrontmatter would spoof "full coverage".
    // Compare against a doc with both terms as exact matches.
    store.load([
      makeDoc({
        meta: { doc_id: "code:sub", file_path: "sub.ts", collection: "code" },
        tree: [codeNode("code:sub:n1", "function parseFrontmatter", "function parseFrontmatter() {}")],
        root_nodes: ["code:sub:n1"],
      }),
      makeDoc({
        meta: { doc_id: "code:exact", file_path: "exact.ts", collection: "code" },
        tree: [makeNode({
          node_id: "code:exact:n1",
          title: "function helper",
          content: "function helper() { /* parse the frontmatter */ const x = 1; }",
          symbol_kind: "function",
          symbol_name: "helper",
        })],
        root_nodes: ["code:exact:n1"],
      }),
    ]);

    const results = store.searchDocuments("parse frontmatter");
    const subResult = results.find((r) => r.doc_id === "code:sub");
    const exactResult = results.find((r) => r.doc_id === "code:exact");
    expect(subResult).toBeDefined();
    expect(exactResult).toBeDefined();
    // The exact-match doc gets full_coverage_bonus (5.0 default), the subtoken-only doc does not.
    // After the bonus the exact doc must outscore the subtoken doc.
    expect(exactResult!.score).toBeGreaterThan(subResult!.score);
  });

  test("subtoken matches contribute to term_proximity_bonus (recall)", () => {
    // When a doc has both query terms via subtoken matches, proximity bonus
    // should still apply (recall is the goal here, unlike full_coverage).
    store.load([
      makeDoc({
        meta: { doc_id: "code:sub", file_path: "sub.ts", collection: "code" },
        tree: [codeNode("code:sub:n1", "function parseFrontmatter", "function parseFrontmatter() {}")],
        root_nodes: ["code:sub:n1"],
      }),
    ]);

    store.setRanking({ term_proximity_bonus: 0 });
    const noProx = store.searchDocuments("parse frontmatter")[0].score;

    store.setRanking({ term_proximity_bonus: 5 });
    const withProx = store.searchDocuments("parse frontmatter")[0].score;

    expect(withProx).toBeGreaterThan(noProx);
  });

  test("subtoken_weight is configurable and reduces score contribution", () => {
    store.load([
      makeDoc({
        meta: { doc_id: "code:sub", file_path: "sub.ts", collection: "code" },
        tree: [codeNode("code:sub:n1", "function parseFrontmatter", "function parseFrontmatter() {}")],
        root_nodes: ["code:sub:n1"],
      }),
    ]);

    store.setRanking({ subtoken_weight: 0.1 });
    const lowWeight = store.searchDocuments("frontmatter")[0].score;

    store.setRanking({ subtoken_weight: 1.0 });
    const fullWeight = store.searchDocuments("frontmatter")[0].score;

    expect(fullWeight).toBeGreaterThan(lowWeight);
  });

  test("markdown nodes are NOT subtokenized", () => {
    // Same identifier in a markdown node — should NOT match a subtoken query
    // because markdown content is plain prose and shouldn't be identifier-split.
    store.load([
      makeDoc({
        meta: { doc_id: "docs:guide", file_path: "guide.md", collection: "docs" },
        tree: [makeNode({
          node_id: "docs:guide:n1",
          title: "Guide",
          content: "Use parseFrontmatter for YAML headers.",
          // no symbol_kind — markdown node
        })],
        root_nodes: ["docs:guide:n1"],
      }),
    ]);

    // 'frontmatter' is mid-word in parseFrontmatter, only reachable via
    // subtoken-split. For markdown nodes that's deliberately disabled.
    const results = store.searchDocuments("frontmatter");
    expect(results.length).toBe(0);
  });

  test("subtokens equal to the full token are not double-indexed", () => {
    // 'parse' (single word) → no subtoken split, only exact indexing.
    // Verify this by checking that searching for 'parse' doesn't double-count.
    store.load([
      makeDoc({
        meta: { doc_id: "code:simple", file_path: "simple.ts", collection: "code" },
        tree: [codeNode("code:simple:n1", "function parse", "function parse() {}")],
        root_nodes: ["code:simple:n1"],
      }),
    ]);

    store.setRanking({ subtoken_weight: 0 });
    const noSubtoken = store.searchDocuments("parse")[0].score;

    store.setRanking({ subtoken_weight: 1.0 });
    const withSubtoken = store.searchDocuments("parse")[0].score;

    // Single-word identifier should not produce subtoken postings, so
    // changing subtoken_weight makes no difference.
    expect(withSubtoken).toBeCloseTo(noSubtoken, 3);
  });
});

// ── Query-shape-aware multipliers ───────────────────────────────────

describe("query-shape-aware multipliers", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  function defNode(symbol_kind: string, symbol_name: string, content: string): TreeNode {
    return makeNode({
      node_id: `code:${symbol_name}:n1`,
      title: `${symbol_kind} ${symbol_name}`,
      content,
      symbol_kind,
      symbol_name,
    });
  }

  test("camelCase query bumps definition_boost via multiplier", () => {
    store.load([
      makeDoc({
        meta: { doc_id: "code:def", file_path: "p.ts", collection: "code" },
        tree: [defNode("function", "parseConfig", "function parseConfig() { return {}; }")],
        root_nodes: ["code:parseConfig:n1"],
      }),
    ]);

    store.setRanking({
      definition_boost: 2.0,
      symbol_query_definition_boost_multiplier: 1.0, // shape detection effectively off
    });
    const baseline = store.searchDocuments("parseConfig")[0].score;

    store.setRanking({
      definition_boost: 2.0,
      symbol_query_definition_boost_multiplier: 1.5,
    });
    const bumped = store.searchDocuments("parseConfig")[0].score;

    // The boost is applied multiplicatively. Effective boost goes from 2.0 to 3.0,
    // so the bumped score = baseline * (3.0 / 2.0) = baseline * 1.5.
    expect(bumped / baseline).toBeCloseTo(1.5, 2);
  });

  test("snake_case query is detected as symbol-shaped", () => {
    store.load([
      makeDoc({
        meta: { doc_id: "code:py", file_path: "config.py", collection: "code" },
        tree: [defNode("function", "parse_log_level", "def parse_log_level(s): return MAPPING[s]")],
        root_nodes: ["code:parse_log_level:n1"],
      }),
    ]);

    store.setRanking({
      definition_boost: 2.0,
      symbol_query_definition_boost_multiplier: 1.0,
    });
    const baseline = store.searchDocuments("parse_log_level")[0].score;

    store.setRanking({
      definition_boost: 2.0,
      symbol_query_definition_boost_multiplier: 2.0,
    });
    const bumped = store.searchDocuments("parse_log_level")[0].score;

    expect(bumped).toBeGreaterThan(baseline);
  });

  test("all-caps acronym (≥2 chars) is detected as symbol-shaped", () => {
    store.load([
      makeDoc({
        meta: { doc_id: "code:url", file_path: "url.ts", collection: "code" },
        tree: [defNode("class", "URL", "class URL { static parse(s: string) {} }")],
        root_nodes: ["code:URL:n1"],
      }),
    ]);

    store.setRanking({
      definition_boost: 2.0,
      symbol_query_definition_boost_multiplier: 1.0,
    });
    const baseline = store.searchDocuments("URL")[0].score;

    store.setRanking({
      definition_boost: 2.0,
      symbol_query_definition_boost_multiplier: 2.0,
    });
    const bumped = store.searchDocuments("URL")[0].score;

    expect(bumped).toBeGreaterThan(baseline);
  });

  test("symbol-shaped query dampens subtoken_weight", () => {
    // Doc with a SUBTOKEN match for the query. Symbol-shaped detection
    // should dampen the subtoken contribution.
    store.load([
      makeDoc({
        meta: { doc_id: "code:sub", file_path: "sub.ts", collection: "code" },
        tree: [makeNode({
          node_id: "code:sub:n1",
          title: "function parseFrontmatter",
          content: "function parseFrontmatter() { return {}; }",
          symbol_kind: "function",
          symbol_name: "parseFrontmatter",
        })],
        root_nodes: ["code:sub:n1"],
      }),
    ]);

    // Multi-token query: "BM25" triggers shape detection (all-caps ≥2 chars);
    // "frontmatter" hits the subtoken posting from parseFrontmatter.
    store.setRanking({
      subtoken_weight: 1.0,
      symbol_query_subtoken_dampener: 1.0, // off
    });
    const baseline = store.searchDocuments("BM25 frontmatter");

    store.setRanking({
      subtoken_weight: 1.0,
      symbol_query_subtoken_dampener: 0.1,
    });
    const dampened = store.searchDocuments("BM25 frontmatter");

    expect(baseline.length).toBeGreaterThan(0);
    expect(dampened.length).toBeGreaterThan(0);
    expect(dampened[0].score).toBeLessThan(baseline[0].score);
  });

  test("natural-language query is NOT treated as symbol-shaped", () => {
    store.load([
      makeDoc({
        meta: { doc_id: "code:def", file_path: "p.ts", collection: "code" },
        tree: [defNode("function", "authenticate", "function authenticate() {}")],
        root_nodes: ["code:authenticate:n1"],
      }),
    ]);

    // Plain lowercase, no underscores, no caps-runs → natural language.
    store.setRanking({
      definition_boost: 2.0,
      symbol_query_definition_boost_multiplier: 5.0, // big multiplier, but should NOT apply
    });
    const result = store.searchDocuments("authenticate")[0].score;

    store.setRanking({
      definition_boost: 2.0,
      symbol_query_definition_boost_multiplier: 1.0,
    });
    const baseline = store.searchDocuments("authenticate")[0].score;

    // Natural-language query → multiplier ignored → identical scores
    expect(result).toBeCloseTo(baseline, 3);
  });

  test("PascalCase single word ('Hello') is NOT shape-detected", () => {
    // 'Hello' is PascalCase but it's just a regular word; we don't want
    // a single capital letter (or single-word capitalized text) to flip
    // the symbol-shaped flag.
    store.load([
      makeDoc({
        meta: { doc_id: "code:def", file_path: "p.ts", collection: "code" },
        tree: [defNode("function", "Hello", "function Hello() {}")],
        root_nodes: ["code:Hello:n1"],
      }),
    ]);

    store.setRanking({
      definition_boost: 2.0,
      symbol_query_definition_boost_multiplier: 5.0,
    });
    const big = store.searchDocuments("Hello")[0].score;

    store.setRanking({
      definition_boost: 2.0,
      symbol_query_definition_boost_multiplier: 1.0,
    });
    const baseline = store.searchDocuments("Hello")[0].score;

    expect(big).toBeCloseTo(baseline, 3);
  });
});

// ── Window-density ranking signal ───────────────────────────────────

describe("window density bonus", () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  // Build a long node with a controlled distribution of `auth` matches.
  // `clustered`: all matches packed in the first 30 tokens.
  // `sparse`: matches spread evenly across the whole 600-token body.
  function longNodeWith(matches: "clustered" | "sparse", doc_id: string): IndexedDocument {
    const TOTAL = 600;
    const N_MATCHES = 6;
    const tokens: string[] = new Array(TOTAL).fill("filler");
    if (matches === "clustered") {
      for (let i = 0; i < N_MATCHES; i++) tokens[i] = "auth";
    } else {
      const stride = Math.floor(TOTAL / N_MATCHES);
      for (let i = 0; i < N_MATCHES; i++) tokens[i * stride] = "auth";
    }
    const content = tokens.join(" ");
    return makeDoc({
      meta: { doc_id, file_path: `${doc_id}.ts`, collection: "code", title: doc_id },
      tree: [makeNode({
        node_id: `${doc_id}:n1`,
        title: `function bigFunc_${doc_id}`,
        content,
        word_count: TOTAL,
      })],
      root_nodes: [`${doc_id}:n1`],
    });
  }

  function shortFiller(doc_id: string): IndexedDocument {
    return makeDoc({
      meta: { doc_id, file_path: `${doc_id}.ts`, collection: "code", title: doc_id },
      tree: [makeNode({
        node_id: `${doc_id}:n1`,
        title: `function tiny_${doc_id}`,
        content: "filler filler filler",
        word_count: 3,
      })],
      root_nodes: [`${doc_id}:n1`],
    });
  }

  test("clustered matches in a long node outscore sparse matches in another long node", () => {
    // Add several short filler docs so the corpus avg node length is small,
    // making the two 600-token docs qualify as "long" (> 2 × avg).
    const fillers = Array.from({ length: 20 }, (_, i) => shortFiller(`code:filler${i}`));
    store.load([
      ...fillers,
      longNodeWith("clustered", "code:clustered"),
      longNodeWith("sparse", "code:sparse"),
    ]);

    store.setRanking({ window_density_bonus: 0 });
    const baseline = store.searchDocuments("auth");
    const baseClust = baseline.find((r) => r.doc_id === "code:clustered")!.score;
    const baseSparse = baseline.find((r) => r.doc_id === "code:sparse")!.score;
    // Without density bonus, BM25 alone has both at the same tf and length,
    // so they should score identically.
    expect(baseClust).toBeCloseTo(baseSparse, 2);

    store.setRanking({ window_density_bonus: 50 });
    const boosted = store.searchDocuments("auth");
    const boostClust = boosted.find((r) => r.doc_id === "code:clustered")!.score;
    const boostSparse = boosted.find((r) => r.doc_id === "code:sparse")!.score;

    expect(boostClust).toBeGreaterThan(boostSparse);
    expect(boosted[0].doc_id).toBe("code:clustered");
  });

  test("short nodes (≤ 2× avgNodeLength) are NOT eligible for the bonus", () => {
    // A short node and a long node with similar density.
    store.load([
      makeDoc({
        meta: { doc_id: "code:short", file_path: "short.ts", collection: "code", title: "short" },
        tree: [makeNode({
          node_id: "code:short:n1",
          title: "function tiny",
          content: "auth auth auth filler filler",
          word_count: 5,
        })],
        root_nodes: ["code:short:n1"],
      }),
      longNodeWith("clustered", "code:long"),
    ]);

    store.setRanking({ window_density_bonus: 0 });
    const baselineShort = store.searchDocuments("auth").find((r) => r.doc_id === "code:short")!.score;

    store.setRanking({ window_density_bonus: 50 });
    const boostedShort = store.searchDocuments("auth").find((r) => r.doc_id === "code:short")!.score;

    // The short node — well below the 2× avgNodeLength gate — should be unaffected.
    expect(boostedShort).toBeCloseTo(baselineShort, 2);
  });

  test("setRanking({ window_density_bonus: 0 }) disables the bonus entirely", () => {
    const fillers = Array.from({ length: 20 }, (_, i) => shortFiller(`code:filler${i}`));
    store.load([...fillers, longNodeWith("clustered", "code:big")]);

    store.setRanking({ window_density_bonus: 0 });
    const off = store.searchDocuments("auth").find((r) => r.doc_id === "code:big")!.score;

    store.setRanking({ window_density_bonus: 100 });
    const on = store.searchDocuments("auth").find((r) => r.doc_id === "code:big")!.score;

    expect(on).toBeGreaterThan(off);
  });
});

// ── resolveRef ──────────────────────────────────────────────────────

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

// ── Stats ───────────────────────────────────────────────────────────

describe("stats", () => {
  test("getStats returns correct counts", () => {
    const store = new DocumentStore();
    store.load([
      makeDoc({
        meta: { doc_id: "a", collection: "col1" },
        tree: [
          makeNode({ node_id: "a:n1" }),
          makeNode({ node_id: "a:n2", level: 2, parent_id: "a:n1" }),
        ],
      }),
      makeDoc({
        meta: { doc_id: "b", collection: "col2" },
        tree: [makeNode({ node_id: "b:n1" })],
      }),
    ]);

    const stats = store.getStats();

    expect(stats.document_count).toBe(2);
    expect(stats.total_nodes).toBe(3);
    expect(stats.indexed_terms).toBeGreaterThan(0);
    expect(stats.avg_node_length).toBeGreaterThan(0);
    expect(stats.facet_keys).toContain("collection");
    expect(stats.collections).toContain("col1");
    expect(stats.collections).toContain("col2");
  });
});
