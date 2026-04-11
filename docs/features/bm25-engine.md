# BM25 Engine

## Summary

The BM25 engine is the in-memory positional inverted index that powers every
search-facing tool in treenav-mcp. It tokenizes and stems document content,
builds a term-to-postings map with word positions and field weights, scores
nodes against queries with a Pagefind-flavoured BM25, applies co-occurrence
and collection-weight bonuses, and emits density-based snippets. Numerical
parity with the TS implementation (`src/store.ts`) is load-bearing: the
Phase B parity harness compares Go scores to a TS fixture dump at `1e-9`
tolerance on every query in the oracle corpus.

## Go package

`internal/store` — in-memory BM25 index, facet index, glossary, snippet
generator, and the `AddDocument` write path used by the curator.

Exports:

- `DocumentStore` struct (guarded by `sync.RWMutex`)
- `NewDocumentStore() *DocumentStore`
- `(*DocumentStore).Load(docs []types.IndexedDocument)`
- `(*DocumentStore).AddDocument(doc types.IndexedDocument)` — incremental upsert
- `(*DocumentStore).RemoveDocument(docID string)`
- `(*DocumentStore).SetRanking(params types.RankingParams)`
- `(*DocumentStore).SetCollectionWeights(weights map[string]float64)`
- `(*DocumentStore).LoadGlossary(entries map[string][]string)`
- `(*DocumentStore).SearchDocuments(query string, opts SearchOptions) []types.SearchResult`
- `(*DocumentStore).ListDocuments(opts ListOptions) ListResult`
- `(*DocumentStore).GetTree(docID string) (*types.TreeOutline, bool)`
- `(*DocumentStore).GetNodeContent(docID string, nodeIDs []string) (*NodeContent, bool)`
- `(*DocumentStore).GetSubtree(docID, nodeID string) (*NodeContent, bool)`
- `(*DocumentStore).GetFacets() types.FacetCounts`
- `(*DocumentStore).GetStats() StoreStats`
- `(*DocumentStore).GetGlossaryTerms() []string`
- `(*DocumentStore).ResolveRef(path string) (*RefResolution, bool)`
- `(*DocumentStore).GetDocMeta(docID string) (*types.DocumentMeta, bool)`
- `(*DocumentStore).NeedsReindex(filePath, newHash string) bool`
- `(*DocumentStore).HasDocument(docID string) bool`
- Package-level `Tokenize(text string) []string`
- Package-level `Stem(word string) string`

## Public API (Go signatures)

```go
package store

import (
    "sync"

    "github.com/treenav/treenav-mcp/internal/types"
)

// DocumentStore is the in-memory BM25 index and facet store.
// All exported methods are safe for concurrent use. Read methods acquire
// an RLock; write methods (Load, AddDocument, RemoveDocument, SetRanking,
// SetCollectionWeights, LoadGlossary) acquire the full Lock.
type DocumentStore struct {
    mu sync.RWMutex
    // unexported fields: docs, index, nodeStats, filters, contentHashes,
    // collectionWeights, ranking, glossary, refMap, totalNodes, avgNodeLength
}

type SearchOptions struct {
    Limit      int                 `json:"limit,omitempty"`
    DocID      string              `json:"doc_id,omitempty"`
    Collection string              `json:"collection,omitempty"`
    Filters    map[string][]string `json:"filters,omitempty"`
}

type ListOptions struct {
    Tag        string              `json:"tag,omitempty"`
    Query      string              `json:"query,omitempty"`
    Collection string              `json:"collection,omitempty"`
    Filters    map[string][]string `json:"filters,omitempty"`
    Limit      int                 `json:"limit,omitempty"`
    Offset     int                 `json:"offset,omitempty"`
}

type ListResult struct {
    Total       int                  `json:"total"`
    Documents   []types.DocumentMeta `json:"documents"`
    FacetCounts types.FacetCounts    `json:"facet_counts"`
}

type NodeContent struct {
    DocID string             `json:"doc_id"`
    Nodes []types.TreeNode   `json:"nodes"`
}

type RefResolution struct {
    DocID  string `json:"doc_id"`
    NodeID string `json:"node_id,omitempty"`
}

type StoreStats struct {
    DocumentCount int      `json:"document_count"`
    TotalNodes    int      `json:"total_nodes"`
    TotalWords    int      `json:"total_words"`
    IndexedTerms  int      `json:"indexed_terms"`
    AvgNodeLength int      `json:"avg_node_length"`
    FacetKeys     []string `json:"facet_keys"`
    Collections   []string `json:"collections"`
}

func NewDocumentStore() *DocumentStore

func (s *DocumentStore) Load(docs []types.IndexedDocument)
func (s *DocumentStore) AddDocument(doc types.IndexedDocument)
func (s *DocumentStore) RemoveDocument(docID string)

func (s *DocumentStore) SetRanking(params types.RankingParams)
func (s *DocumentStore) SetCollectionWeights(weights map[string]float64)
func (s *DocumentStore) LoadGlossary(entries map[string][]string)

func (s *DocumentStore) SearchDocuments(query string, opts SearchOptions) []types.SearchResult
func (s *DocumentStore) ListDocuments(opts ListOptions) ListResult

func (s *DocumentStore) GetTree(docID string) (*types.TreeOutline, bool)
func (s *DocumentStore) GetNodeContent(docID string, nodeIDs []string) (*NodeContent, bool)
func (s *DocumentStore) GetSubtree(docID, nodeID string) (*NodeContent, bool)

func (s *DocumentStore) GetFacets() types.FacetCounts
func (s *DocumentStore) GetStats() StoreStats
func (s *DocumentStore) GetGlossaryTerms() []string
func (s *DocumentStore) ResolveRef(path string) (*RefResolution, bool)
func (s *DocumentStore) GetDocMeta(docID string) (*types.DocumentMeta, bool)
func (s *DocumentStore) NeedsReindex(filePath, newHash string) bool
func (s *DocumentStore) HasDocument(docID string) bool

// Tokenize lowercases, replaces every rune that is not [a-z0-9_\-./] with a
// space, splits on whitespace, and drops tokens shorter than 2 bytes.
// Matches src/store.ts:942-948.
func Tokenize(text string) []string

// Stem applies the TS store's Porter-style suffix stripping. Matches
// src/store.ts:966-983 exactly, including the -ing length guard.
func Stem(word string) string
```

## Key behaviors

- `Tokenize` and `Stem` are byte-identical to the TS helpers. The Phase B
  parity test runs the fixture corpus through both and asserts
  `Tokenize(input) == tokenize_ts(input)` for every string, same for stems.
- `SearchDocuments` returns results sorted by `(score desc, doc_id asc,
  node_id asc)`. The TS code relies on `Array.sort` stability; Go uses
  `sort.SliceStable` with an explicit tiebreak so rankings are reproducible
  across platforms and across map-iteration reorderings.
- BM25 formula matches `src/store.ts:478-498` exactly:
  `score = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * nodeLen/avgLen)) * posting.weight`
  where `idf = log((N - n + 0.5) / (n + 0.5) + 1)`.
- Field weights are applied at index time by tracking `maxWeight` per
  term-per-node: title tokens get `title_weight`, description-echo tokens
  in the first node get `description_weight`, code-fence tokens get
  `code_weight`, everything else gets `1.0`. See `src/store.ts:376-387`.
- Prefix matching fires for query terms of length >=3; prefix hits are
  scored at `prefix_penalty * bm25` (default 0.5). See `src/store.ts:623-658`.
- Co-occurrence bonuses: `(matchCount - 1) * term_proximity_bonus` plus a
  flat `full_coverage_bonus` when every unique query term matched the node.
  See `src/store.ts:661-671`.
- Collection weights multiply the final score after bonuses. See
  `src/store.ts:674-679`.
- Snippets come from a sliding-window density scan (`windowWords =
  max(10, floor(maxLen/6))`) that picks the window with the most match
  positions. Ellipses are prepended/appended only when the window is not
  at the document edges. See `src/store.ts:990-1043`.
- Glossary expansion fires after query tokenization/stemming and adds
  forward (acronym → expansion) and reverse (expansion → acronym) mappings
  before the index lookup. See `src/store.ts:192-209`.
- `AddDocument` is an upsert: it removes any existing postings, node
  stats, and facet memberships for the doc, then reindexes and recomputes
  `totalNodes` / `avgNodeLength` eagerly. See
  `src/store.ts:101-116`, `290-317`, `460-470`.

## Dependencies

- **stdlib:**
  - `math` — `math.Log` for the IDF component.
  - `sort` — `sort.SliceStable` for deterministic result ordering, and the
    same for list/facet iteration.
  - `strings` — tokenization helpers, basename extraction in `ResolveRef`.
  - `sync` — `sync.RWMutex` guards the whole store (see `docs/features/concurrency-model.md`).
  - `unicode` — `unicode.ToLower` for case folding during tokenization.
  - `regexp` — slug computation in `ResolveRef` and the auto-glossary
    regexes (delegated to `internal/indexer.ExtractGlossaryEntries`).
- **third-party:** none. The engine is pure stdlib. There is no mature
  drop-in Go port of the TS ad-hoc stemmer, so we reimplement it directly
  rather than pulling in `github.com/kljensen/snowball` — snowball's Porter2
  would drift from the TS suffix rules.
- **internal:**
  - `internal/types` — shared `IndexedDocument`, `TreeNode`, `Posting`,
    `NodeStats`, `RankingParams`, `SearchResult`, `DocumentMeta`,
    `FacetCounts`, `FilterIndex`.
  - `internal/indexer` — `ExtractGlossaryEntries` for the auto-glossary
    pass fed from node content during `Load`.

## Relationship to TS source

- Maps to `src/store.ts:29-938` in full.
- Public `Tokenize`/`Stem` map to `src/store.ts:942-948` and
  `src/store.ts:966-983`. They are exported in Go (not private) so other
  packages (`internal/curator`) and fixture-parity tests can call them
  without duplicating the logic.
- `extractCodeTokens` (`src/store.ts:950-959`) becomes an unexported helper
  `extractCodeTokens` inside `internal/store`.
- `buildDensitySnippet` (`src/store.ts:990-1043`) becomes an unexported
  helper `buildDensitySnippet`.

### Notable differences

1. **Mutex-guarded.** The TS code is single-threaded. The Go code wraps
   the whole store in `sync.RWMutex`. Every read takes `RLock`, every
   write takes `Lock`. This is verified by `go test -race`.
2. **Deterministic iteration.** Go map iteration order is randomized, so
   anywhere the TS code iterated `Map` values in insertion order (facet
   builds, posting scans, result accumulation), the Go code iterates over
   a snapshot sorted by `(key asc)` or feeds results into a deterministic
   sort. See the "Iteration determinism" rule in the spec.
3. **Floating-point summation order.** BM25 scores are summed per node;
   the summation order is fixed by sorting the matched-term list before
   summing so that floating-point rounding matches the TS `for…of` walk.
4. **`nil` vs `[]`.** Fields like `SearchResult.MatchedTerms` and
   `SearchResult.MatchPositions` must serialize as empty arrays, not
   `null`. Constructors use `make([]T, 0)` for any slice that may be empty.
5. **Exported tokenizer.** The TS functions are file-private. The Go
   package exports them so `internal/curator.tokenizeForQuery` can reuse
   them rather than duplicating the regex.

## Non-goals

- No semantic/embedding search.
- No vector storage, no approximate nearest neighbour index.
- No disk-backed index. The store is rebuilt from scratch on every process
  start; Phase B fixture parity is the acceptance gate, not persistence.
- No LLM calls at index or retrieval time (ADR 0002 invariant).
- No index chunking for lazy loading. The full inverted index lives in
  memory for the lifetime of the process.
- Query syntax beyond whitespace-separated tokens (no boolean operators,
  no field qualifiers, no quoted phrases). Phrase search is handled
  implicitly via the co-occurrence bonus, not an operator.
- Pagefind-style multisite on-disk index. Collection weights live in
  memory only.
