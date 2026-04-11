# Core data model

## Summary

Defines the Go structs that every other package in the port depends on:
the hierarchical document tree, per-document metadata, positional index
postings, search results, and ranking parameters. This package is a pure
leaf — no I/O, no logic, just type declarations and the tiny constructor
helpers needed to preserve JSON round-trip parity with the TypeScript
oracle. It is imported by `internal/fsutil`, `internal/frontmatter`,
`internal/store`, `internal/indexer`, `internal/codeindex`,
`internal/curator`, and `internal/mcp`.

## Go package

`internal/types` — shared data contracts for the indexer, store, curator
and MCP layers.

Exports:

- `TreeNode` — a single node in the document tree (one markdown heading
  or one code symbol).
- `TreeOutline`, `OutlineNode` — compact, content-free projection of a
  document's tree, designed for the `get_tree` MCP tool response.
- `DocumentMeta` — per-document metadata: path, title, facets,
  `content_hash`, collection name, tags, references.
- `IndexedDocument` — a `DocumentMeta` plus its flat `[]TreeNode` and the
  `node_id`s that are roots.
- `Posting`, `NodeStats` — the positional inverted index primitives.
- `FilterIndex`, `FacetCounts` — faceted filter structures (
  `map[string]map[string]map[string]struct{}` and
  `map[string]map[string]int`).
- `SearchResult` — one ranked hit returned by the BM25 engine.
- `RankingParams`, `DefaultRanking()` — BM25 + weighting knobs,
  mirroring `DEFAULT_RANKING` in `src/types.ts:195`.
- `CollectionConfig`, `IndexConfig`, `SingleRootConfig` — top-level
  configuration structs and the `docs_root` → single-collection helper.

## Public API (Go signatures)

```go
package types

// TreeNode is a single node in a document's hierarchy.
//
// For markdown it corresponds to one heading and its prose up to the
// next sibling or ancestor heading. For source code it corresponds to
// one symbol (class, function, interface, etc.) extracted by a
// language parser.
type TreeNode struct {
    NodeID    string   `json:"node_id"`
    Title     string   `json:"title"`
    Level     int      `json:"level"`     // heading level 1-6; symbols use a synthetic level
    ParentID  *string  `json:"parent_id"` // nil for roots
    Children  []string `json:"children"`
    Content   string   `json:"content"`
    Summary   string   `json:"summary"`
    WordCount int      `json:"word_count"`
    LineStart int      `json:"line_start"`
    LineEnd   int      `json:"line_end"`
}

// OutlineNode is the slimmed-down projection carried inside TreeOutline.
type OutlineNode struct {
    NodeID    string   `json:"node_id"`
    Title     string   `json:"title"`
    Level     int      `json:"level"`
    Children  []string `json:"children"`
    WordCount int      `json:"word_count"`
    Summary   string   `json:"summary"`
}

// TreeOutline is the content-free outline returned by the get_tree MCP
// tool so agents can reason over structure without paying for body text.
type TreeOutline struct {
    DocID string        `json:"doc_id"`
    Title string        `json:"title"`
    Nodes []OutlineNode `json:"nodes"`
}

// DocumentMeta is the per-document metadata persisted alongside a tree.
type DocumentMeta struct {
    DocID        string              `json:"doc_id"`
    FilePath     string              `json:"file_path"`
    Title        string              `json:"title"`
    Description  string              `json:"description"`
    WordCount    int                 `json:"word_count"`
    HeadingCount int                 `json:"heading_count"`
    MaxDepth     int                 `json:"max_depth"`
    LastModified string              `json:"last_modified"` // RFC3339
    Tags         []string            `json:"tags"`
    ContentHash  string              `json:"content_hash"`
    Collection   string              `json:"collection"`
    Facets       map[string][]string `json:"facets"`
    References   []string            `json:"references"`
}

// IndexedDocument bundles a DocumentMeta with its flat tree and the
// top-level node ids (equivalent of TS IndexedDocument).
type IndexedDocument struct {
    Meta      DocumentMeta `json:"meta"`
    Tree      []TreeNode   `json:"tree"`
    RootNodes []string     `json:"root_nodes"`
}

// Posting is one entry in the positional inverted index.
type Posting struct {
    DocID          string  `json:"doc_id"`
    NodeID         string  `json:"node_id"`
    Positions      []int   `json:"positions"`
    TermFrequency  int     `json:"term_frequency"`
    Weight         float64 `json:"weight"`
}

// NodeStats holds the per-node token counts required by BM25 length
// normalization.
type NodeStats struct {
    DocID       string `json:"doc_id"`
    NodeID      string `json:"node_id"`
    TotalTokens int    `json:"total_tokens"`
}

// FilterIndex is the faceted filter map: facet key → value → doc_id set.
type FilterIndex map[string]map[string]map[string]struct{}

// FacetCounts is facet key → value → document count.
type FacetCounts map[string]map[string]int

// SearchResult is one BM25-ranked hit returned by the store.
type SearchResult struct {
    DocID          string              `json:"doc_id"`
    DocTitle       string              `json:"doc_title"`
    FilePath       string              `json:"file_path"`
    NodeID         string              `json:"node_id"`
    NodeTitle      string              `json:"node_title"`
    Level          int                 `json:"level"`
    Snippet        string              `json:"snippet"`
    Score          float64             `json:"score"`
    MatchPositions []int               `json:"match_positions"`
    MatchedTerms   []string            `json:"matched_terms"`
    Collection     string              `json:"collection"`
    Facets         map[string][]string `json:"facets"`
}

// RankingParams are the BM25 and weighting knobs exposed by the store.
type RankingParams struct {
    BM25K1             float64 `json:"bm25_k1"`
    BM25B              float64 `json:"bm25_b"`
    TitleWeight        float64 `json:"title_weight"`
    CodeWeight         float64 `json:"code_weight"`
    DescriptionWeight  float64 `json:"description_weight"`
    TermProximityBonus float64 `json:"term_proximity_bonus"`
    FullCoverageBonus  float64 `json:"full_coverage_bonus"`
    PrefixPenalty      float64 `json:"prefix_penalty"`
}

// DefaultRanking returns the production defaults, matching
// DEFAULT_RANKING in src/types.ts:195.
func DefaultRanking() RankingParams

// CollectionConfig is a single named corpus with its own root and
// BM25 weight multiplier.
type CollectionConfig struct {
    Name        string `json:"name"`
    Root        string `json:"root"`
    Weight      float64 `json:"weight"`
    GlobPattern string `json:"glob_pattern,omitempty"`
}

// IndexConfig is the top-level configuration (collections, code
// collections, summary length, max depth).
type IndexConfig struct {
    Collections     []CollectionConfig `json:"collections"`
    CodeCollections []CollectionConfig `json:"code_collections,omitempty"`
    SummaryLength   int                `json:"summary_length"`
    MaxDepth        int                `json:"max_depth"`
}

// SingleRootConfig is the convenience helper used by the common case of
// a single DOCS_ROOT. Mirrors src/types.ts:232 singleRootConfig().
func SingleRootConfig(docsRoot, collectionName string) IndexConfig
```

## Key behaviors

- Every exported struct has stable JSON tags matching the TS field
  names byte-for-byte so fixtures from the Bun oracle can be compared
  to Go output by `reflect.DeepEqual` after `json.Unmarshal`.
- Slice-valued fields (`Children`, `Tags`, `Positions`, `MatchPositions`,
  `MatchedTerms`, `References`, `RootNodes`) always serialize as `[]`
  when empty, never `null`. Callers must construct them with
  `make([]T, 0)` — see the Invariants section of the spec.
- Map-valued fields (`Facets`, `FilterIndex`, `FacetCounts`) serialize
  as `{}` when empty (Go's default) — consistent with TS.
- `ParentID` is `*string` so that a nil parent round-trips as `null`
  in JSON, matching TS's `string | null` on `TreeNode.parent_id`.
- `DefaultRanking()` returns a value (not a pointer) so callers can
  freely copy-and-mutate without racing a shared singleton.
- `FilterIndex` uses `map[string]struct{}` as the set type instead of
  `map[string]bool` for memory cost and to make membership-only intent
  explicit.

## Dependencies

- **stdlib:** none at the type-declaration level. Consumers import
  `encoding/json` when serializing.
- **third-party:** none.
- **internal:** none (this package is the dependency root).

## Relationship to TS source

- Whole file `src/types.ts` is the source of truth for this package.
- `TreeNode` maps to `src/types.ts:21-32`; `parent_id: string | null`
  becomes `*string` in Go.
- `TreeOutline.nodes` is an inline struct literal in TS
  (`src/types.ts:35-46`); Go promotes it to the named `OutlineNode`.
- `FilterIndex` is `Map<string, Map<string, Set<string>>>` in TS
  (`src/types.ts:128`); Go uses the nested-map-of-sets shape above.
- `DEFAULT_RANKING` (`src/types.ts:195-204`) is a `var` in TS; Go
  exposes it via `DefaultRanking()` to avoid data races on the constant
  block and to keep the package free of exported mutable state.
- `singleRootConfig` (`src/types.ts:232-248`) becomes `SingleRootConfig`
  with explicit parameters (no default argument).

## Non-goals

- This package does not construct, mutate, or validate any of its
  types — that belongs to the owners (`indexer`, `store`, `curator`).
- It does not expose wire-format helpers (no `MarshalJSON` overrides).
- It does not import any other `internal/` package. If a circular
  dependency ever tempts us, the answer is always "move the struct
  here".
- It does not carry business constants beyond `DefaultRanking()`.
- It does not redefine `Frontmatter` — that struct is owned by
  `internal/frontmatter` because its parser semantics are not simple
  data declarations.
