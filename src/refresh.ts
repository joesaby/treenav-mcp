/**
 * Index refresh — re-scan the configured roots and reload the store when
 * anything changed. Backs the `refresh_index` MCP tool.
 *
 * Strategy: re-index everything, then diff content hashes against the
 * loaded store to report what changed. A full `store.load()` (rather than
 * per-document incremental patching) keeps the derived structures that
 * `addDocument()` does not maintain — row index, reference map,
 * auto-glossary — consistent. Ranking params, collection weights, noise
 * patterns, and explicitly loaded glossary entries survive a reload.
 */

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

export async function refreshStore(
  store: DocumentStore,
  config: IndexConfig
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
