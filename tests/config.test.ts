/**
 * Tests for src/config.ts — the shared env → IndexConfig resolution used
 * by both the stdio and HTTP server entrypoints.
 */

import { describe, test, expect } from "bun:test";
import { parseDocsRoots, buildConfigFromEnv, collectionWeights } from "../src/config";

describe("parseDocsRoots", () => {
  test("parses comma-separated path:weight entries", () => {
    const collections = parseDocsRoots("./docs:1.0,./api-specs:0.8,./rfcs:0.5");
    expect(collections.length).toBe(3);
    expect(collections[0]).toMatchObject({ name: "docs", root: "./docs", weight: 1.0 });
    expect(collections[1]).toMatchObject({ name: "api-specs", root: "./api-specs", weight: 0.8 });
    expect(collections[2]).toMatchObject({ name: "rfcs", root: "./rfcs", weight: 0.5 });
  });

  test("weight defaults to 1.0 when omitted", () => {
    const collections = parseDocsRoots("./docs,./wiki:0.7");
    expect(collections[0]).toMatchObject({ name: "docs", root: "./docs", weight: 1.0 });
    expect(collections[1]).toMatchObject({ name: "wiki", root: "./wiki", weight: 0.7 });
  });

  test("collection name comes from folder basename", () => {
    const collections = parseDocsRoots("/srv/team/handbook:2.0");
    expect(collections[0].name).toBe("handbook");
    expect(collections[0].root).toBe("/srv/team/handbook");
  });

  test("duplicate basenames get numeric suffixes", () => {
    const collections = parseDocsRoots("./a/docs,./b/docs");
    expect(collections[0].name).toBe("docs");
    expect(collections[1].name).toBe("docs-2");
  });

  test("ignores empty entries and trims whitespace", () => {
    const collections = parseDocsRoots(" ./docs:1.0 , ,./rfcs ");
    expect(collections.length).toBe(2);
    expect(collections.map((c) => c.name)).toEqual(["docs", "rfcs"]);
  });

  test("non-numeric tail after colon is treated as part of the path", () => {
    const collections = parseDocsRoots("./my:docs");
    expect(collections[0].root).toBe("./my:docs");
    expect(collections[0].weight).toBe(1.0);
  });
});

describe("buildConfigFromEnv", () => {
  test("defaults to single ./docs collection", () => {
    const { config, roots_label, code_root } = buildConfigFromEnv({});
    expect(config.collections.length).toBe(1);
    expect(config.collections[0]).toMatchObject({ name: "docs", root: "./docs" });
    expect(roots_label).toBe("./docs");
    expect(code_root).toBeUndefined();
  });

  test("DOCS_ROOTS replaces the single-root collection", () => {
    const { config, roots_label } = buildConfigFromEnv({
      DOCS_ROOTS: "./docs:1.0,./rfcs:0.5",
    });
    expect(config.collections.map((c) => c.name)).toEqual(["docs", "rfcs"]);
    expect(roots_label).toBe("./docs, ./rfcs");
  });

  test("DOCS_GLOB applies to every docs collection", () => {
    const { config } = buildConfigFromEnv({
      DOCS_ROOTS: "./docs,./data",
      DOCS_GLOB: "**/*.md,**/*.csv",
    });
    for (const c of config.collections) {
      expect(c.glob_patterns).toEqual(["**/*.md", "**/*.csv"]);
      expect(c.glob_pattern).toBeUndefined();
    }
  });

  test("CODE_ROOT enables the code collection with CODE_WEIGHT", () => {
    const { config, code_root, code_collection_name } = buildConfigFromEnv({
      CODE_ROOT: "./src",
      CODE_COLLECTION: "engine",
      CODE_WEIGHT: "0.8",
    });
    expect(code_root).toBe("./src");
    expect(code_collection_name).toBe("engine");
    expect(config.code_collections?.[0]).toMatchObject({
      name: "engine",
      root: "./src",
      weight: 0.8,
    });
  });

  test("glossary path defaults to first docs root", () => {
    const { glossary_path } = buildConfigFromEnv({
      DOCS_ROOTS: "./wiki:1.0,./rfcs:0.5",
    });
    expect(glossary_path).toBe("wiki/glossary.json");
  });

  test("GLOSSARY_PATH overrides the default", () => {
    const { glossary_path } = buildConfigFromEnv({
      GLOSSARY_PATH: "/etc/treenav/glossary.json",
    });
    expect(glossary_path).toBe("/etc/treenav/glossary.json");
  });
});

describe("collectionWeights", () => {
  test("maps docs and code collection weights by name", () => {
    const { config } = buildConfigFromEnv({
      DOCS_ROOTS: "./docs:1.0,./rfcs:0.5",
      CODE_ROOT: "./src",
      CODE_WEIGHT: "0.8",
    });
    expect(collectionWeights(config)).toEqual({
      docs: 1.0,
      rfcs: 0.5,
      code: 0.8,
    });
  });
});
