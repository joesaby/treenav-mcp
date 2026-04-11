# Incremental Index

## Summary

The incremental index is the contract that backs the curator write path:
after `internal/curator.WriteWikiEntry` persists a new markdown file and
re-parses it with `internal/indexer.IndexFile`, it calls
`(*DocumentStore).AddDocument` to splice the new (or updated) document
into the live in-memory index without rebuilding from scratch. The
engine must end up in a state that is **bitwise identical** to the state
it would have reached by calling `Load` on the full corpus including the
new document. If `avgdl` drifts, or a posting for an updated document
is left behind, or a facet set still references a removed document, the
BM25 scores will silently diverge from the oracle. Phase B tests guard
this with a parity check: `build(N) → AddDocument(N+1)` vs
`build(N+1)`.

## Go package

`internal/store` — lives on `DocumentStore`, sharing the inverted index
and facet map with the read path.

Exports:

- `(*DocumentStore).AddDocument(doc types.IndexedDocument)`
- `(*DocumentStore).RemoveDocument(docID string)`
- `(*DocumentStore).NeedsReindex(filePath, newHash string) bool`
- `(*DocumentStore).GetContentHash(filePath string) (string, bool)`

## Public API (Go signatures)

```go
package store

// AddDocument upserts a single document. If a document with the same
// doc_id already exists, its postings, node stats, facets, and
// content-hash entry are removed first. After insertion, totalNodes
// and avgNodeLength are recomputed eagerly. Finally the ref map
// (for cross-reference resolution) is rebuilt from the current
// document set.
//
// Matches src/store.ts:101-116.
//
// Safe for concurrent callers; acquires the store write lock for the
// entire operation.
func (s *DocumentStore) AddDocument(doc types.IndexedDocument)

// RemoveDocument deletes a document from the index. No-op if the
// doc_id is unknown. Recomputes corpus stats after deletion.
//
// Matches src/store.ts:131-140.
func (s *DocumentStore) RemoveDocument(docID string)

// NeedsReindex reports whether the content hash for filePath differs
// from the one currently stored. Returns true if the file is unknown
// (never been indexed) or if the hash has changed. Matches
// src/store.ts:122-125.
func (s *DocumentStore) NeedsReindex(filePath, newHash string) bool

// GetContentHash returns the most recent indexed content hash for a
// file, or ok=false if the file has never been indexed. Matches
// src/store.ts:127-129.
func (s *DocumentStore) GetContentHash(filePath string) (string, bool)
```

## Key behaviors

- **Upsert semantics.** `AddDocument` handles both "new doc" and
  "existing doc, content changed" cases via the same code path. The
  removal step is a no-op when the doc_id is new.
- **Postings removal.** Every term's postings slice is rewritten
  excluding entries for the removed doc_id. Terms whose postings list
  becomes empty are deleted from the inverted index map so
  `len(s.index)` reflects the live term count (important for `GetStats`
  and for IDF normalization on the next query).
- **Node stats removal.** `nodeStats` entries keyed by
  `docID + "::" + nodeID` are deleted for every node of the removed
  document.
- **Facet removal.** Every `filters[key][value]` set has the doc_id
  removed. Empty buckets are **not** deleted (parity with the TS code,
  which leaves empty sets in place; see `src/store.ts:309-317`). Phase
  B fixture dumps capture bucket presence, not just contents.
- **Eager corpus stats.** `recalcCorpusStats` is called after every
  mutation. `totalNodes = len(nodeStats)` and `avgNodeLength =
  totalTokens / totalNodes`. This is the critical difference from a
  naive incremental index: if `avgNodeLength` were cached without
  recomputation, BM25 length normalization would slowly drift as new
  documents changed the corpus average. See `src/store.ts:460-470`.
- **Ref map rebuild.** After `AddDocument`, `refMap` is rebuilt from
  scratch (it is small — one entry per doc). This is cheaper than
  incremental ref-map maintenance and matches the TS behavior at
  `src/store.ts:115`.
- **Content hash tracking.** Every `AddDocument` also updates
  `contentHashes[filePath]` so that `NeedsReindex` returns false on
  unchanged files. This is the watcher hook for Phase D: a file watcher
  can call `NeedsReindex(path, hash(read(path)))` and skip reindex when
  the hash is unchanged.
- **Glossary is not rebuilt.** `AddDocument` does **not** re-run
  `buildAutoGlossary`. Glossary terms harvested from the corpus at
  `Load` time remain stable across incremental adds. This is a parity
  requirement with TS (`src/store.ts:101-116` does not call
  `buildAutoGlossary`) and a conscious gotcha: a curator-written file
  with new acronyms will not enrich the glossary until the next full
  `Load`. Documented in the spec's "Known drift" section.
- **Collection weights are not reset.** Any `SetCollectionWeights`
  configuration from before the add persists.
- **Write lock held for the full operation.** Readers wait until the
  mutation, stats recompute, and ref map rebuild all finish.

## Dependencies

- **stdlib:**
  - `sync` — write lock is already held by the outer method call.
  - `strings` — `strings.Split` for the `docID::nodeID` key prefix, and
    basename parsing in the ref map rebuild.
- **third-party:** none.
- **internal:**
  - `internal/types` — shared types.
  - `internal/indexer` — only the type; the curator, not the store,
    invokes `IndexFile` before passing the `IndexedDocument` in.

## Relationship to TS source

- `addDocument` → `src/store.ts:101-116`.
- `removeDocument` → `src/store.ts:131-140`.
- `removeDocumentPostings` → `src/store.ts:290-307`.
- `removeDocumentFilters` → `src/store.ts:309-317`.
- `recalcCorpusStats` → `src/store.ts:460-470`.
- `needsReindex` / `getContentHash` → `src/store.ts:122-129`.
- `buildRefMap` → `src/store.ts:213-219`.

### Notable differences

1. **Concurrency.** The TS write path ran on a single event loop; the
   curator couldn't race with queries. The Go port may serve a query on
   one goroutine and a write on another. `AddDocument` takes
   `sync.RWMutex.Lock()`; search methods take `RLock()`. This is
   validated by `go test -race` in the curator integration test.
2. **No partial state.** On error (which in practice only means an
   internal bug), the Go port panics rather than leaving the index in
   an intermediate state. The spec forbids "partial success" returns.
3. **Index term deletion.** The TS code deletes keys from the inverted
   index when their posting list becomes empty. Go port mirrors this:
   `delete(s.index, term)` when `len(postings) == 0` after filtering,
   so the term count in `GetStats` matches the TS oracle.
4. **Content hash type.** TS stores `Bun.hash` output as a hex string;
   Go port preserves the string representation from the indexer
   (`fsutil.HashString`) unchanged so the `contentHashes` map stays
   byte-identical across fixture parity.

## Non-goals

- **No per-node incremental updates.** The unit of incremental work is
  one whole document. We do not splice in a single changed heading.
- **No transaction log / undo.** Once `AddDocument` completes, there
  is no way to roll back to the previous state short of re-running
  `Load`.
- **No concurrent writes.** Multiple goroutines calling `AddDocument`
  are serialized by the write lock; there is no attempt at
  lock-free insertion.
- **No stale-posting compaction.** Because `RemoveDocument` fully
  rewrites each term's posting slice, there is no separate GC pass.
- **No re-extraction of glossary entries on add.** New acronyms in
  curated entries are picked up only on the next full `Load`. This is
  a parity requirement, not a bug — see the feature spec for the
  rationale and the Phase D follow-up item.
- **No file watcher.** `NeedsReindex` is the hook; the watcher itself
  lives outside `internal/store`. Phase C will evaluate adding a
  `cmd/treenav-mcp watch` subcommand.
