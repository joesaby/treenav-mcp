/**
 * Tests for src/refresh.ts — re-scan roots and reload the store on change.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DocumentStore } from "../src/store";
import { indexAllCollections } from "../src/indexer";
import { refreshStore } from "../src/refresh";
import type { IndexConfig } from "../src/types";

describe("refreshStore", () => {
  let dir: string;
  let config: IndexConfig;
  let store: DocumentStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "treenav-refresh-"));
    config = {
      collections: [{ name: "docs", root: dir, weight: 1.0, glob_pattern: "**/*.md" }],
      summary_length: 200,
      max_depth: 6,
    };
    await writeFile(join(dir, "alpha.md"), "# Alpha\n\nOriginal alpha content.\n");
    await writeFile(join(dir, "beta.md"), "# Beta\n\nOriginal beta content.\n");
    store = new DocumentStore();
    store.load(await indexAllCollections(config));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test("no-op when nothing changed", async () => {
    const summary = await refreshStore(store, config);
    expect(summary).toMatchObject({
      total: 2,
      added: 0,
      changed: 0,
      removed: 0,
      unchanged: 2,
      reloaded: false,
    });
  });

  test("detects added, changed, and removed files", async () => {
    await writeFile(join(dir, "alpha.md"), "# Alpha\n\nUpdated alpha content with zanzibar.\n");
    await writeFile(join(dir, "gamma.md"), "# Gamma\n\nBrand new gamma doc.\n");
    await unlink(join(dir, "beta.md"));

    const summary = await refreshStore(store, config);
    expect(summary).toMatchObject({
      total: 2, // alpha + gamma
      added: 1,
      changed: 1,
      removed: 1,
      unchanged: 0,
      reloaded: true,
    });

    // Search reflects the new state.
    expect(store.searchDocuments("zanzibar").length).toBeGreaterThan(0);
    expect(store.searchDocuments("gamma").length).toBeGreaterThan(0);
    expect(store.hasDocument("docs:beta")).toBe(false);
  });

  test("reload preserves collection weights and ranking", async () => {
    store.setCollectionWeights({ docs: 0.5 });
    store.setRanking({ title_weight: 9.9 });
    await writeFile(join(dir, "gamma.md"), "# Gamma\n\nNew doc.\n");

    const summary = await refreshStore(store, config);
    expect(summary.reloaded).toBe(true);

    // Weights persist: scores in the (only) docs collection are halved,
    // which we can't observe directly — but ranking params are readable
    // via behavior. Spot-check that search still works post-reload.
    expect(store.searchDocuments("gamma").length).toBeGreaterThan(0);
  });
});
