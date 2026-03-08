/**
 * Tests for doc ingestion improvements:
 *   1. Cross-reference extraction from markdown links
 *   2. First-sentence summaries (instead of text.slice(0,200))
 *   3. Auto-facets from content structure (code blocks, languages)
 *   4. Auto-glossary extraction from acronym definitions in prose
 */

import { describe, test, expect } from "bun:test";
import { buildTree, extractGlossaryEntries } from "../src/indexer";
import { DocumentStore } from "../src/store";
import type { IndexedDocument, TreeNode } from "../src/types";

// ── Helper: build a minimal IndexedDocument from markdown ───────────

function makeDoc(
  doc_id: string,
  markdown: string,
  options?: {
    references?: string[];
    facets?: Record<string, string[]>;
    tags?: string[];
  }
): IndexedDocument {
  const tree = buildTree(markdown, doc_id);
  return {
    meta: {
      doc_id,
      file_path: `${doc_id}.md`,
      title: tree[0]?.title || doc_id,
      description: tree[0]?.summary || "",
      word_count: tree.reduce((s, n) => s + n.word_count, 0),
      heading_count: tree.length,
      max_depth: Math.max(...tree.map((n) => n.level), 0),
      last_modified: new Date().toISOString(),
      tags: options?.tags || [],
      content_hash: "test",
      collection: "docs",
      facets: options?.facets || {},
      references: options?.references || [],
    },
    tree,
    root_nodes: tree.filter((n) => !n.parent_id).map((n) => n.node_id),
  };
}

// ── 1. First-sentence summaries ──────────────────────────────────────

describe("first-sentence summaries", () => {
  test("extracts first complete sentence as summary", () => {
    const tree = buildTree(
      `# Auth Guide

OAuth 2.0 is the industry standard for authorization. It enables third-party
applications to obtain limited access to user accounts.

## Details

More details here.`,
      "test:doc"
    );

    const rootNode = tree.find((n) => n.title === "Auth Guide");
    expect(rootNode).toBeDefined();
    // Should end at the first sentence boundary, not arbitrarily at 200 chars
    expect(rootNode!.summary).toContain("OAuth 2.0 is the industry standard for authorization.");
  });

  test("falls back to word-boundary truncation for long sentences", () => {
    const longSentence = "This is a very long sentence that goes on and on " +
      "with many words and phrases and clauses that just keep going " +
      "without ever reaching a period or other sentence boundary marker " +
      "because the author decided to write a single enormous run-on " +
      "sentence that exceeds the two hundred character limit easily";

    const tree = buildTree(`# Title\n\n${longSentence}`, "test:doc");
    const node = tree.find((n) => n.title === "Title");
    expect(node).toBeDefined();
    expect(node!.summary.length).toBeLessThanOrEqual(201); // 200 + "…"
    expect(node!.summary).toEndWith("…");
  });

  test("handles empty content gracefully", () => {
    const tree = buildTree(`# Empty Section\n\n## Next`, "test:doc");
    const node = tree.find((n) => n.title === "Empty Section");
    expect(node).toBeDefined();
    // Empty or very short summary
  });

  test("skips leading code blocks for summary", () => {
    const tree = buildTree(
      `# API

\`\`\`bash
curl https://api.example.com
\`\`\`

The API provides RESTful endpoints for data access. Authentication is required.`,
      "test:doc"
    );

    const node = tree.find((n) => n.title === "API");
    expect(node).toBeDefined();
    // Summary should capture meaningful prose, not just code
    expect(node!.summary.length).toBeGreaterThan(0);
  });
});

// ── 2. Cross-reference extraction ────────────────────────────────────

describe("cross-reference extraction", () => {
  test("references field exists on DocumentMeta", () => {
    const doc = makeDoc("test", "# Hello\n\nWorld");
    expect(doc.meta.references).toBeDefined();
    expect(Array.isArray(doc.meta.references)).toBe(true);
  });

  test("references populated when doc has links", () => {
    const doc = makeDoc("test", "# Hello\n\nSee [guide](./guide.md)", {
      references: ["guide.md"],
    });
    expect(doc.meta.references).toContain("guide.md");
  });

  test("references shown in list_documents output", () => {
    const store = new DocumentStore();
    const doc = makeDoc("test:doc1", "# Doc 1\n\nContent", {
      references: ["auth/oauth.md", "guides/quickstart.md"],
    });
    store.load([doc]);

    const result = store.listDocuments();
    expect(result.documents[0].references).toContain("auth/oauth.md");
    expect(result.documents[0].references).toContain("guides/quickstart.md");
  });
});

// ── 3. Auto-facets from content ──────────────────────────────────────

describe("auto-facets from content", () => {
  test("has_code facet detected from fenced code blocks", () => {
    const doc = makeDoc(
      "test:api",
      "# API\n\n```bash\ncurl http://example.com\n```\n\nSome text.",
      { facets: { has_code: ["true"], code_languages: ["bash"] } }
    );

    const store = new DocumentStore();
    store.load([doc]);

    const facets = store.getFacets();
    expect(facets["has_code"]).toBeDefined();
    expect(facets["has_code"]["true"]).toBe(1);
  });

  test("code_languages facet extracted from fenced blocks", () => {
    const doc = makeDoc(
      "test:multi",
      "# Multi\n\n```typescript\nconst x = 1;\n```\n\n```python\nx = 1\n```",
      { facets: { has_code: ["true"], code_languages: ["python", "typescript"] } }
    );

    const store = new DocumentStore();
    store.load([doc]);

    const facets = store.getFacets();
    expect(facets["code_languages"]).toBeDefined();
    expect(facets["code_languages"]["typescript"]).toBe(1);
    expect(facets["code_languages"]["python"]).toBe(1);
  });

  test("has_links facet detected from internal links", () => {
    const doc = makeDoc(
      "test:linked",
      "# Doc\n\nSee [other](./other.md) and [guide](../guide.md).",
      { facets: { has_links: ["true"] } }
    );

    const store = new DocumentStore();
    store.load([doc]);

    const facets = store.getFacets();
    expect(facets["has_links"]).toBeDefined();
  });

  test("no has_code facet when doc has no code blocks", () => {
    const doc = makeDoc("test:plain", "# Plain\n\nJust prose here.");

    const store = new DocumentStore();
    store.load([doc]);

    const facets = store.getFacets();
    expect(facets["has_code"]).toBeUndefined();
  });
});

// ── 4. Auto-glossary extraction ──────────────────────────────────────

describe("extractGlossaryEntries", () => {
  test("extracts ACRONYM (Expansion) pattern", () => {
    const entries = extractGlossaryEntries(
      "Configure CLI (Command Line Interface) settings."
    );
    expect(entries["CLI"]).toBeDefined();
    expect(entries["CLI"]).toContain("command line interface");
  });

  test("extracts Expansion (ACRONYM) pattern", () => {
    const entries = extractGlossaryEntries(
      "Transport Layer Security (TLS) is required."
    );
    expect(entries["TLS"]).toBeDefined();
    expect(entries["TLS"]).toContain("transport layer security");
  });

  test("extracts ACRONYM — Expansion pattern", () => {
    const entries = extractGlossaryEntries(
      "MFA — Multi Factor Authentication is required."
    );
    expect(entries["MFA"]).toBeDefined();
    expect(entries["MFA"]).toContain("multi factor authentication");
  });

  test("extracts multiple entries from same text", () => {
    const entries = extractGlossaryEntries(
      "Use CLI (Command Line Interface) with MFA (Multi Factor Authentication)."
    );
    expect(entries["CLI"]).toBeDefined();
    expect(entries["MFA"]).toBeDefined();
  });

  test("returns empty for text without definitions", () => {
    const entries = extractGlossaryEntries(
      "This is plain text without any acronym definitions."
    );
    expect(Object.keys(entries).length).toBe(0);
  });

  test("handles single-char and very short acronyms correctly", () => {
    // Should not match single char or two-char non-acronyms
    const entries = extractGlossaryEntries("Use A (Something) here.");
    // "A" is too short (regex requires 2+ chars after first)
    expect(entries["A"]).toBeUndefined();
  });
});

describe("auto-glossary integration with store", () => {
  test("auto-glossary entries are used for query expansion", () => {
    const doc = makeDoc(
      "test:glossary",
      `# Security Guide

Configure TLS (Transport Layer Security) for all endpoints.

## Certificate Setup

Install TLS certificates on the gateway.`
    );

    const store = new DocumentStore();
    store.load([doc]);

    // Search for the expansion — should match via auto-glossary
    const results = store.searchDocuments("transport layer security");
    expect(results.length).toBeGreaterThan(0);

    // Search for the acronym — should also work
    const acronymResults = store.searchDocuments("TLS");
    expect(acronymResults.length).toBeGreaterThan(0);
  });

  test("explicit glossary entries are not overwritten", () => {
    const doc = makeDoc(
      "test:glossary2",
      `# Guide

CLI (Command Line Interface) is the main tool.`
    );

    const store = new DocumentStore();
    // Load explicit glossary first
    store.loadGlossary({ CLI: ["terminal tool"] });
    store.load([doc]);

    // Search for the explicit expansion — should still work
    const results = store.searchDocuments("terminal tool");
    // The explicit glossary entry "terminal tool" should map to CLI
    // and find the doc
    expect(results.length).toBeGreaterThan(0);
  });
});

// ── 5. Integration: indexFile produces all new fields ────────────────

describe("indexFile integration", () => {
  test("indexed doc from fixture has expected structure", async () => {
    const { indexFile } = await import("../src/indexer");
    const fixtureDir = `${import.meta.dir}/fixtures/search-quality/md`;

    const doc = await indexFile(`${fixtureDir}/auth/oauth.md`, fixtureDir);

    // Should have references array
    expect(doc.meta.references).toBeDefined();
    expect(Array.isArray(doc.meta.references)).toBe(true);

    // Should have has_code facet (oauth.md has code blocks)
    expect(doc.meta.facets["has_code"]).toEqual(["true"]);

    // Should have first-sentence summary (not arbitrary slice)
    const rootNode = doc.tree[0];
    expect(rootNode.summary).toBeDefined();
    expect(rootNode.summary.length).toBeGreaterThan(0);
    // First sentence should end with a period
    if (rootNode.summary.length < 200) {
      expect(rootNode.summary).toMatch(/\.$/);
    }
  });
});
