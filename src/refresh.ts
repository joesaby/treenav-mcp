/**
 * Index refresh — re-scan the configured roots and reload the store when
 * anything changed. Backs the `refresh_index` MCP tool.
 *
 * Strategy: re-read and re-parse everything, then diff content hashes
 * against the loaded store. The reload is skipped on a clean diff, but the
 * parse cost is paid on every call — refresh cost scales with corpus size,
 * not with the number of changed files. A full `store.load()` (rather than
 * per-document incremental patching) keeps the derived structures that
 * `addDocument()` does not maintain — row index, reference map,
 * auto-glossary — consistent. Ranking params, collection weights, and
 * noise patterns survive a reload.
 *
 * Glossary: `store.load()` re-merges auto-extracted glossary entries,
 * which `loadGlossary(file)` had cleared at startup. To keep the
 * post-refresh state identical to the startup state, pass `glossary_path`
 * and the explicit glossary file is re-applied after the reload.
 */

import { existsSync } from "node:fs";
import type { IndexConfig } from "./types";
import type { DocumentStore } from "./store";
import { indexAllCollections } from "./indexer";

export interface RefreshSummary {
  /** Documents in the index after the refresh. */
  total: number;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  /** False when nothing changed and the reload was skipped. */
  reloaded: boolean;
  duration_ms: number;
}

export interface RefreshOptions {
  /** Explicit glossary file re-applied after a reload (mirrors startup). */
  glossary_path?: string;
}

export async function refreshStore(
  store: DocumentStore,
  config: IndexConfig,
  options: RefreshOptions = {}
): Promise<RefreshSummary> {
  const t0 = Date.now();
  const documents = await indexAllCollections(config);

  let added = 0;
  let changed = 0;
  let unchanged = 0;
  const newIds = new Set<string>();
  for (const doc of documents) {
    newIds.add(doc.meta.doc_id);
    const existing = store.getDocMeta(doc.meta.doc_id);
    if (!existing) added++;
    else if (existing.content_hash !== doc.meta.content_hash) changed++;
    else unchanged++;
  }
  const removed = store.getAllDocIds().filter((id) => !newIds.has(id)).length;

  const reloaded = added > 0 || changed > 0 || removed > 0;
  if (reloaded) {
    store.load(documents);

    // Re-apply the explicit glossary so the post-refresh glossary state
    // matches startup: loadGlossary() clears the auto-extracted entries
    // that load() just re-merged.
    if (options.glossary_path && existsSync(options.glossary_path)) {
      try {
        const glossaryData = await Bun.file(options.glossary_path).json();
        store.loadGlossary(glossaryData);
      } catch {
        // Mirror startup behavior: a bad glossary file is non-fatal.
      }
    }
  }

  return {
    total: documents.length,
    added,
    changed,
    removed,
    unchanged,
    reloaded,
    duration_ms: Date.now() - t0,
  };
}
