/**
 * Tests for the wiki curation toolset.
 *
 * Covers both the curator module's direct API (find_similar, draft,
 * write) and the full MCP round trip when WIKI_WRITE is enabled.
 *
 * See docs/wiki-curation-spec.md §8 for the acceptance matrix.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  CuratorError,
  draftWikiEntry,
  findSimilar,
  writeWikiEntry,
  type WikiOptions,
} from "../src/curator";
import { DocumentStore } from "../src/store";
import { indexFile } from "../src/indexer";
import { createMcpTestClient, getToolText, type McpTestHarness } from "./fixtures/helpers";

// ── Helpers ─────────────────────────────────────────────────────────

async function makeTmpWiki(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "treenav-curator-"));
}

async function writeSeed(
  root: string,
  relPath: string,
  body: string
): Promise<void> {
  const full = join(root, relPath);
  const dir = full.substring(0, full.lastIndexOf("/"));
  await Bun.write(join(dir, ".keep"), "");
  await writeFile(full, body, "utf8");
}

async function seedStore(
  root: string,
  files: Array<{ path: string; body: string }>
): Promise<DocumentStore> {
  for (const f of files) {
    await writeSeed(root, f.path, f.body);
  }
  const store = new DocumentStore();
  const indexed = [];
  for (const f of files) {
    indexed.push(await indexFile(join(root, f.path), root, "docs"));
  }
  store.load(indexed);
  return store;
}

function authDocBody(): string {
  return `---
title: Authentication Guide
type: guide
category: auth
tags: [auth, jwt, security]
---

# Authentication Guide

This document describes how the service authenticates users using JWT tokens.
The authentication flow uses refresh tokens for session management.

## Token Refresh

The token refresh mechanism exchanges a refresh token for a new access token.
Refresh tokens expire after 30 days while access tokens live for one hour.

## Error Handling

When authentication fails, the service returns a 401 status code.
`;
}

function deployDocBody(): string {
  return `---
title: Deployment Runbook
type: runbook
category: ops
tags: [deploy, production, rollback]
---

# Deployment Runbook

Steps to deploy services to production with zero downtime.

## Rollback

To rollback a failed deployment, use the rollback command with the previous
version tag. Always verify health checks after rolling back.
`;
}

// ── 1. findSimilar ──────────────────────────────────────────────────

describe("findSimilar", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTmpWiki();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("returns empty matches for empty input", async () => {
    const store = await seedStore(root, [
      { path: "guides/auth.md", body: authDocBody() },
    ]);
    const result = findSimilar(store, "");
    expect(result.matches).toEqual([]);
    expect(result.tokens_analyzed).toBe(0);
    expect(result.suggest_merge).toBe(false);
  });

  test("finds overlap when text duplicates an existing doc", async () => {
    const store = await seedStore(root, [
      { path: "guides/auth.md", body: authDocBody() },
      { path: "runbooks/deploy.md", body: deployDocBody() },
    ]);
    const result = findSimilar(
      store,
      "Authentication using JWT refresh tokens and access token lifetime"
    );
    expect(result.matches.length).toBeGreaterThan(0);
    // The auth doc should be the top hit
    expect(result.matches[0].doc_id).toContain("auth");
    expect(result.matches[0].overlap).toBeGreaterThan(0);
  });

  test("flags duplicate when overlap exceeds threshold", async () => {
    const store = await seedStore(root, [
      { path: "guides/auth.md", body: authDocBody() },
    ]);
    const result = findSimilar(
      store,
      "authentication guide jwt tokens refresh session management service describes how authenticate users access token",
      { duplicateThreshold: 0.3 }
    );
    expect(result.suggest_merge).toBe(true);
  });

  test("respects limit", async () => {
    const store = await seedStore(root, [
      { path: "guides/auth.md", body: authDocBody() },
      { path: "runbooks/deploy.md", body: deployDocBody() },
    ]);
    const result = findSimilar(store, "production deploy rollback authentication", {
      limit: 1,
    });
    expect(result.matches.length).toBeLessThanOrEqual(1);
  });
});

// ── 2. draftWikiEntry ───────────────────────────────────────────────

describe("draftWikiEntry", () => {
  let root: string;
  let wiki: WikiOptions;

  beforeEach(async () => {
    root = await makeTmpWiki();
    wiki = { root, collectionName: "docs", duplicateThreshold: 0.35 };
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("synthesizes path slug from topic when none provided", async () => {
    const store = await seedStore(root, []);
    const draft = draftWikiEntry(store, wiki, {
      topic: "Distributed Tracing",
      raw_content: "Distributed tracing uses spans to track requests.",
    });
    expect(draft.suggested_path).toBe("distributed-tracing.md");
    expect(draft.frontmatter.title).toBe("Distributed Tracing");
  });

  test("infers type from suggested path directory", async () => {
    const store = await seedStore(root, []);
    const draft = draftWikiEntry(store, wiki, {
      topic: "Database Restore",
      raw_content: "Steps to restore the database from backup.",
      suggested_path: "runbooks/db-restore.md",
    });
    expect(draft.frontmatter.type).toBe("runbook");
  });

  test("aggregates tags from related documents", async () => {
    const store = await seedStore(root, [
      { path: "guides/auth.md", body: authDocBody() },
    ]);
    const draft = draftWikiEntry(store, wiki, {
      topic: "OAuth Implementation",
      raw_content:
        "OAuth 2.0 implementation using JWT tokens and refresh flows for authentication",
    });
    // Auth doc has tags [auth, jwt, security] — at least one should bubble up
    expect(draft.backlinks.length).toBeGreaterThan(0);
    const tagSet = new Set(draft.frontmatter.tags);
    expect(
      tagSet.has("auth") || tagSet.has("jwt") || tagSet.has("security")
    ).toBe(true);
  });

  test("returns duplicate_warning when overlap is high", async () => {
    const store = await seedStore(root, [
      { path: "guides/auth.md", body: authDocBody() },
    ]);
    const draft = draftWikiEntry(store, wiki, {
      topic: "Authentication",
      raw_content:
        "authentication guide jwt tokens refresh session management service describes how authenticate users access token",
    });
    expect(draft.duplicate_warning).toBeDefined();
    expect(draft.duplicate_warning!.overlap).toBeGreaterThan(0);
  });

  test("rejects path that escapes wiki root", async () => {
    const store = await seedStore(root, []);
    expect(() =>
      draftWikiEntry(store, wiki, {
        topic: "foo",
        raw_content: "bar",
        suggested_path: "../../etc/passwd.md",
      })
    ).toThrow(CuratorError);
  });

  test("detects known glossary terms in raw content", async () => {
    const store = await seedStore(root, []);
    store.loadGlossary({ CLI: ["command line interface"] });
    const draft = draftWikiEntry(store, wiki, {
      topic: "CLI Usage",
      raw_content: "Use the CLI to manage deployments",
    });
    expect(draft.glossary_hits.length).toBeGreaterThan(0);
  });
});

// ── 3. writeWikiEntry ───────────────────────────────────────────────

describe("writeWikiEntry", () => {
  let root: string;
  let wiki: WikiOptions;
  let store: DocumentStore;

  beforeEach(async () => {
    root = await makeTmpWiki();
    wiki = { root, collectionName: "docs", duplicateThreshold: 0.35 };
    store = await seedStore(root, [
      { path: "guides/auth.md", body: authDocBody() },
    ]);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("rejects path that escapes root", async () => {
    let caught: CuratorError | undefined;
    try {
      await writeWikiEntry(store, wiki, {
        path: "../escape.md",
        frontmatter: { title: "Escape" },
        content: "nope",
      });
    } catch (err) {
      caught = err as CuratorError;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("PATH_ESCAPE");
  });

  test("rejects non-markdown extension", async () => {
    let caught: CuratorError | undefined;
    try {
      await writeWikiEntry(store, wiki, {
        path: "notes/foo.txt",
        frontmatter: { title: "Foo" },
        content: "bar",
      });
    } catch (err) {
      caught = err as CuratorError;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("PATH_INVALID");
  });

  test("rejects absolute path", async () => {
    let caught: CuratorError | undefined;
    try {
      await writeWikiEntry(store, wiki, {
        path: "/etc/passwd.md",
        frontmatter: { title: "No" },
        content: "no",
      });
    } catch (err) {
      caught = err as CuratorError;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("PATH_INVALID");
  });

  test("rejects invalid frontmatter shape", async () => {
    let caught: CuratorError | undefined;
    try {
      await writeWikiEntry(store, wiki, {
        path: "notes/foo.md",
        // @ts-expect-error deliberately invalid
        frontmatter: "not an object",
        content: "body",
      });
    } catch (err) {
      caught = err as CuratorError;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("FRONTMATTER_INVALID");
  });

  test("rejects duplicate without allow_duplicate", async () => {
    let caught: CuratorError | undefined;
    try {
      await writeWikiEntry(store, wiki, {
        path: "notes/dupe.md",
        frontmatter: { title: "Dupe" },
        content:
          "authentication guide jwt tokens refresh session management service describes how authenticate users access token",
      });
    } catch (err) {
      caught = err as CuratorError;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("DUPLICATE");
  });

  test("dry_run does not touch disk or re-index", async () => {
    const before = store.getStats().document_count;
    const result = await writeWikiEntry(store, wiki, {
      path: "notes/dry.md",
      frontmatter: { title: "Dry", type: "note", tags: ["misc"] },
      content: "A totally new topic about gardening and horticulture.",
      dry_run: true,
    });
    expect(result.written).toBe(false);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.reindex_ms).toBe(0);
    // Store unchanged
    expect(store.getStats().document_count).toBe(before);
    // File not on disk
    await expect(stat(join(root, "notes/dry.md"))).rejects.toThrow();
  });

  test("successful write creates file and re-indexes", async () => {
    const before = store.getStats().document_count;
    const result = await writeWikiEntry(store, wiki, {
      path: "notes/gardening.md",
      frontmatter: {
        title: "Gardening",
        type: "note",
        tags: ["misc", "hobby"],
      },
      content:
        "A brand new entry about gardening tomatoes and kale in raised beds.",
    });
    expect(result.written).toBe(true);
    expect(result.doc_id).toBeDefined();
    expect(result.root_node_id).toBeDefined();
    expect(result.reindex_ms).toBeGreaterThanOrEqual(0);
    // File exists
    const st = await stat(join(root, "notes/gardening.md"));
    expect(st.isFile()).toBe(true);
    // Store has one more doc
    expect(store.getStats().document_count).toBe(before + 1);
    // New entry is searchable via the regular BM25 engine
    const hits = store.searchDocuments("gardening tomatoes kale");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].doc_id).toBe(result.doc_id);
  });

  test("creates nested directories if needed", async () => {
    const result = await writeWikiEntry(store, wiki, {
      path: "a/b/c/deep.md",
      frontmatter: { title: "Deep" },
      content: "Nested directory content about platypi.",
    });
    expect(result.written).toBe(true);
    const st = await stat(join(root, "a/b/c/deep.md"));
    expect(st.isFile()).toBe(true);
  });

  test("refuses overwrite by default", async () => {
    // Seed a file
    await writeWikiEntry(store, wiki, {
      path: "notes/original.md",
      frontmatter: { title: "Original" },
      content: "Original unique content about origami cranes and folding.",
    });
    // Second write to same path without overwrite should fail
    let caught: CuratorError | undefined;
    try {
      await writeWikiEntry(store, wiki, {
        path: "notes/original.md",
        frontmatter: { title: "Replacement" },
        content: "Totally different content about something else entirely.",
      });
    } catch (err) {
      caught = err as CuratorError;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("EXISTS");
  });

  test("allows overwrite when explicitly requested", async () => {
    await writeWikiEntry(store, wiki, {
      path: "notes/replace-me.md",
      frontmatter: { title: "First" },
      content: "First version distinctive words platypus axolotl.",
    });
    const result = await writeWikiEntry(store, wiki, {
      path: "notes/replace-me.md",
      frontmatter: { title: "Second" },
      content: "Second version completely different jellyfish octopus.",
      overwrite: true,
    });
    expect(result.written).toBe(true);
  });
});

// ── 4. MCP round trip ───────────────────────────────────────────────

describe("MCP curation round trip", () => {
  let root: string;
  let harness: McpTestHarness;

  beforeEach(async () => {
    root = await makeTmpWiki();
  });
  afterEach(async () => {
    if (harness) await harness.cleanup();
    await rm(root, { recursive: true, force: true });
  });

  test("curation tools are NOT registered without wiki option", async () => {
    harness = await createMcpTestClient([]);
    const { tools } = await harness.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("find_similar");
    expect(names).not.toContain("draft_wiki_entry");
    expect(names).not.toContain("write_wiki_entry");
  });

  test("curation tools ARE registered when wiki option is passed", async () => {
    harness = await createMcpTestClient([], {
      wiki: { root, duplicateThreshold: 0.35 },
    });
    const { tools } = await harness.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("find_similar");
    expect(names).toContain("draft_wiki_entry");
    expect(names).toContain("write_wiki_entry");
  });

  test("full workflow: draft → write → search via MCP client", async () => {
    // Seed with a pre-existing doc on disk
    await writeSeed(root, "guides/auth.md", authDocBody());
    const indexed = await indexFile(
      join(root, "guides/auth.md"),
      root,
      "docs"
    );
    harness = await createMcpTestClient([indexed], {
      wiki: { root, collectionName: "docs", duplicateThreshold: 0.35 },
    });

    // 1. Draft a new entry
    const draftRes = await harness.client.callTool({
      name: "draft_wiki_entry",
      arguments: {
        topic: "Service Mesh Basics",
        raw_content:
          "Service meshes provide observability, traffic management, and mTLS for microservices deployments.",
        suggested_path: "guides/service-mesh.md",
      },
    });
    const draftText = getToolText(draftRes as any);
    expect(draftText).toContain("service-mesh.md");
    expect(draftText).toContain("guide"); // inferred type

    // 2. Write the entry
    const writeRes = await harness.client.callTool({
      name: "write_wiki_entry",
      arguments: {
        path: "guides/service-mesh.md",
        frontmatter: {
          title: "Service Mesh Basics",
          type: "guide",
          tags: ["mesh", "networking", "observability"],
        },
        content:
          "# Service Mesh Basics\n\nService meshes provide traffic management and mTLS.\n\n## Observability\n\nDistributed tracing and metrics collection across microservices.\n",
      },
    });
    const writeText = getToolText(writeRes as any);
    expect(writeText).toContain('"written": true');
    expect(writeText).toContain("service-mesh");

    // 3. The new entry should be searchable via the regular search tool
    const searchRes = await harness.client.callTool({
      name: "search_documents",
      arguments: { query: "service mesh mTLS observability" },
    });
    const searchText = getToolText(searchRes as any);
    expect(searchText).toContain("service-mesh");
  });

  test("find_similar via MCP reports overlap", async () => {
    await writeSeed(root, "guides/auth.md", authDocBody());
    const indexed = await indexFile(
      join(root, "guides/auth.md"),
      root,
      "docs"
    );
    harness = await createMcpTestClient([indexed], {
      wiki: { root, collectionName: "docs", duplicateThreshold: 0.35 },
    });

    const res = await harness.client.callTool({
      name: "find_similar",
      arguments: {
        content:
          "authentication guide jwt tokens refresh session management",
      },
    });
    const text = getToolText(res as any);
    expect(text).toContain("matches");
    expect(text).toContain("auth");
  });
});
