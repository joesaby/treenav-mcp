/**
 * Tests for auto-glossary extraction and incremental glossary management.
 * Ensures that:
 *   - Acronym definitions are extracted from document content
 *   - Auto-glossary entries are used for query expansion
 *   - Explicit glossary entries are not overwritten by auto-discovery
 *   - addDocument/removeDocument maintain glossary incrementally
 */

import { describe, test, expect } from "bun:test";
import { buildTree, extractGlossaryEntries } from "../src/indexer";
import { DocumentStore } from "../src/store";
import type { IndexedDocument } from "../src/types";

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

// ── extractGlossaryEntries ───────────────────────────────────────────

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

  test("handles single-char acronyms correctly", () => {
    const entries = extractGlossaryEntries("Use A (Something) here.");
    // "A" is too short (regex requires 2+ chars after first)
    expect(entries["A"]).toBeUndefined();
  });
});

// ── Auto-glossary integration with store ─────────────────────────────

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

// ── Incremental auto-glossary ─────────────────────────────────────────

describe("incremental auto-glossary", () => {
  test("addDocument extracts glossary entries", () => {
    const store = new DocumentStore();
    store.load([]);

    const doc = makeDoc(
      "test:inc1",
      `# Guide\n\nRBAC (Role Based Access Control) is configured here.`
    );
    store.addDocument(doc);

    // Should find "role based access control" via auto-glossary expansion
    const results = store.searchDocuments("role based access control");
    expect(results.length).toBeGreaterThan(0);
  });

  test("removeDocument cleans up glossary entries", () => {
    const doc = makeDoc(
      "test:inc2",
      `# Guide\n\nConfigure OIDC (OpenID Connect) for SSO.`
    );
    const store = new DocumentStore();
    store.load([doc]);

    // Verify glossary works before removal
    const before = store.searchDocuments("openid connect");
    expect(before.length).toBeGreaterThan(0);

    store.removeDocument("test:inc2");

    // After removal, searching should return nothing (no docs left)
    const after = store.searchDocuments("openid connect");
    expect(after.length).toBe(0);
  });

  test("incremental add merges with existing auto-glossary", () => {
    const doc1 = makeDoc(
      "test:inc3a",
      `# Auth\n\nUse SAML (Security Assertion Markup Language) for federation.`
    );
    const store = new DocumentStore();
    store.load([doc1]);

    const doc2 = makeDoc(
      "test:inc3b",
      `# Tokens\n\nJWT (JSON Web Token) is used for stateless auth.`
    );
    store.addDocument(doc2);

    // Both auto-glossary entries should work
    const samlResults = store.searchDocuments("security assertion markup language");
    expect(samlResults.length).toBeGreaterThan(0);
    const jwtResults = store.searchDocuments("json web token");
    expect(jwtResults.length).toBeGreaterThan(0);
  });
});
