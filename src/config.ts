/**
 * Environment → IndexConfig resolution, shared by the stdio (server.ts)
 * and HTTP (server-http.ts) entrypoints so the two transports cannot
 * drift apart in how they interpret configuration.
 *
 * Collection sources:
 *   - DOCS_ROOTS: comma-separated weighted roots ("./docs:1.0,./rfcs:0.5"),
 *     each becoming a named collection (Pagefind multisite equivalent).
 *     The collection name is the folder basename.
 *   - DOCS_ROOT: single root indexed as the "docs" collection. Ignored
 *     when DOCS_ROOTS is set.
 *   - CODE_ROOT: optional code collection (AST-based indexing).
 */

import { basename } from "node:path";
import { join } from "node:path";
import type { CollectionConfig, IndexConfig } from "./types";
import { singleRootConfig } from "./types";

export interface ResolvedServerConfig {
  config: IndexConfig;
  /** Human-readable summary of all indexed roots, for startup logging. */
  roots_label: string;
  /** Default glossary location: glossary.json in the first docs root. */
  glossary_path: string;
  code_root: string | undefined;
  code_collection_name: string;
}

/**
 * Parse a DOCS_ROOTS spec: comma-separated `path` or `path:weight` entries.
 * Weight defaults to 1.0. Collection names come from the folder basename;
 * duplicate basenames get a numeric suffix ("docs", "docs-2", ...).
 */
export function parseDocsRoots(spec: string): CollectionConfig[] {
  const collections: CollectionConfig[] = [];
  const nameCounts = new Map<string, number>();

  for (const rawEntry of spec.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    let root = entry;
    let weight = 1.0;
    const colonIdx = entry.lastIndexOf(":");
    if (colonIdx > 0) {
      const tail = entry.slice(colonIdx + 1).trim();
      const parsed = Number(tail);
      // Only treat the tail as a weight if it's a plain finite number —
      // otherwise the colon is part of the path (e.g. Windows drive letters).
      if (tail !== "" && Number.isFinite(parsed)) {
        weight = parsed;
        root = entry.slice(0, colonIdx);
      }
    }

    let name = basename(root.replace(/[/\\]+$/, "")) || "docs";
    const count = (nameCounts.get(name) ?? 0) + 1;
    nameCounts.set(name, count);
    if (count > 1) name = `${name}-${count}`;

    collections.push({ name, root, weight, glob_pattern: "**/*.md" });
  }

  return collections;
}

/**
 * Collection name → weight map for DocumentStore.setCollectionWeights().
 * Covers docs collections (DOCS_ROOTS weights) and the code collection
 * (CODE_WEIGHT).
 */
export function collectionWeights(config: IndexConfig): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const c of config.collections) weights[c.name] = c.weight;
  for (const c of config.code_collections ?? []) weights[c.name] = c.weight;
  return weights;
}

export function buildConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): ResolvedServerConfig {
  const docs_root = env.DOCS_ROOT || "./docs";
  const config: IndexConfig = singleRootConfig(docs_root);
  config.max_depth = parseInt(env.MAX_DEPTH || "6");
  config.summary_length = parseInt(env.SUMMARY_LENGTH || "200");

  // Multi-root weighted collections (Pagefind multisite equivalent).
  if (env.DOCS_ROOTS) {
    const collections = parseDocsRoots(env.DOCS_ROOTS);
    if (collections.length > 0) {
      config.collections = collections;
    }
  }

  // Multi-glob support: DOCS_GLOB=**/*.md,**/*.csv,**/*.jsonl
  // Applies to every docs collection.
  if (env.DOCS_GLOB) {
    const patterns = env.DOCS_GLOB.split(",").map((p) => p.trim()).filter(Boolean);
    if (patterns.length > 0) {
      for (const collection of config.collections) {
        collection.glob_patterns = patterns;
        collection.glob_pattern = undefined;
      }
    }
  }

  // Code collection: set CODE_ROOT to enable AST-based code indexing.
  const code_root = env.CODE_ROOT;
  const code_collection_name = env.CODE_COLLECTION || "code";
  if (code_root) {
    config.code_collections = [
      {
        name: code_collection_name,
        root: code_root,
        weight: parseFloat(env.CODE_WEIGHT || "1.0"),
        glob_pattern: env.CODE_GLOB,
      },
    ];
  }

  const firstRoot = config.collections[0]?.root ?? docs_root;
  const roots_label = config.collections.map((c) => c.root).join(", ");

  return {
    config,
    roots_label,
    glossary_path: env.GLOSSARY_PATH || join(firstRoot, "glossary.json"),
    code_root,
    code_collection_name,
  };
}
