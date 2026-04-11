# Spec: Core data model

**Feature doc:** [../features/core-data-model.md](../features/core-data-model.md)
**TS source:** `src/types.ts`
**Go package:** `internal/types`

## Scope

This spec is authoritative for every Go struct that crosses a package
boundary inside `internal/` and for the JSON shapes that leave the
binary via the MCP stdio/HTTP transports or that are dumped as
fixtures. It fixes JSON field names, tag rules, nil-versus-empty
semantics, and the `DefaultRanking()` constant block. It does **not**
govern how those structs are populated, mutated, or compared for
equivalence — that's handled by the owning packages.

## Types

```go
package types

// TreeNode is a single node in a document's hierarchy. For markdown it
// is one heading and its prose up to the next sibling or ancestor
// heading. For source code it is one symbol (class, function,
// interface, etc.) extracted by a language parser.
type TreeNode struct {
    // NodeID is a doc-unique id derived from the parent document id
    // and the heading path. Stable across re-indexes as long as the
    // heading text is unchanged.
    NodeID string `json:"node_id"`

    // Title is the heading text (markdown) or the symbol name (code).
    Title string `json:"title"`

    // Level is 1-6 for markdown headings; code parsers use a synthetic
    // level where 1 = file root, 2 = top-level symbol, 3+ = nested.
    Level int `json:"level"`

    // ParentID is nil for nodes with no parent (top-level headings
    // and file-root code nodes). Pointer so it serializes as JSON
    // null, matching the TS shape "string | null".
    ParentID *string `json:"parent_id"`

    // Children holds the NodeIDs of direct descendants in document
    // order. Must be non-nil; empty is make([]string, 0).
    Children []string `json:"children"`

    // Content is the raw text under this heading before the next
    // heading at the same or lower level. For code nodes it is the
    // source text between the symbol's opening line and closing line.
    Content string `json:"content"`

    // Summary is the first SummaryLength characters of Content with
    // whitespace collapsed.
    Summary string `json:"summary"`

    // WordCount is the whitespace-separated word count of Content.
    WordCount int `json:"word_count"`

    // LineStart / LineEnd are 1-based line numbers into the source
    // file. LineEnd is inclusive.
    LineStart int `json:"line_start"`
    LineEnd   int `json:"line_end"`
}

type OutlineNode struct {
    NodeID    string   `json:"node_id"`
    Title     string   `json:"title"`
    Level     int      `json:"level"`
    Children  []string `json:"children"`   // never nil
    WordCount int      `json:"word_count"`
    Summary   string   `json:"summary"`
}

type TreeOutline struct {
    DocID string        `json:"doc_id"`
    Title string        `json:"title"`
    Nodes []OutlineNode `json:"nodes"` // never nil
}

type DocumentMeta struct {
    DocID        string              `json:"doc_id"`
    FilePath     string              `json:"file_path"`   // POSIX-slash relative path from the collection root
    Title        string              `json:"title"`
    Description  string              `json:"description"`
    WordCount    int                 `json:"word_count"`
    HeadingCount int                 `json:"heading_count"`
    MaxDepth     int                 `json:"max_depth"`
    LastModified string              `json:"last_modified"` // RFC3339 UTC
    Tags         []string            `json:"tags"`          // never nil
    ContentHash  string              `json:"content_hash"`  // xxhash64 as lowercase hex, no "0x"
    Collection   string              `json:"collection"`
    Facets       map[string][]string `json:"facets"`     // never nil; each value slice never nil
    References   []string            `json:"references"` // never nil
}

type IndexedDocument struct {
    Meta      DocumentMeta `json:"meta"`
    Tree      []TreeNode   `json:"tree"`       // never nil
    RootNodes []string     `json:"root_nodes"` // never nil
}

type Posting struct {
    DocID         string  `json:"doc_id"`
    NodeID        string  `json:"node_id"`
    Positions     []int   `json:"positions"` // never nil
    TermFrequency int     `json:"term_frequency"`
    Weight        float64 `json:"weight"`
}

type NodeStats struct {
    DocID       string `json:"doc_id"`
    NodeID      string `json:"node_id"`
    TotalTokens int    `json:"total_tokens"`
}

type FilterIndex map[string]map[string]map[string]struct{}

type FacetCounts map[string]map[string]int

type SearchResult struct {
    DocID          string              `json:"doc_id"`
    DocTitle       string              `json:"doc_title"`
    FilePath       string              `json:"file_path"`
    NodeID         string              `json:"node_id"`
    NodeTitle      string              `json:"node_title"`
    Level          int                 `json:"level"`
    Snippet        string              `json:"snippet"`
    Score          float64             `json:"score"`
    MatchPositions []int               `json:"match_positions"` // never nil
    MatchedTerms   []string            `json:"matched_terms"`   // never nil
    Collection     string              `json:"collection"`
    Facets         map[string][]string `json:"facets"`          // never nil
}

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

type CollectionConfig struct {
    Name        string  `json:"name"`
    Root        string  `json:"root"`
    Weight      float64 `json:"weight"`
    GlobPattern string  `json:"glob_pattern,omitempty"`
}

type IndexConfig struct {
    Collections     []CollectionConfig `json:"collections"`
    CodeCollections []CollectionConfig `json:"code_collections,omitempty"`
    SummaryLength   int                `json:"summary_length"`
    MaxDepth        int                `json:"max_depth"`
}
```

## Functions

### `DefaultRanking`

**Signature:**

```go
func DefaultRanking() RankingParams
```

**Preconditions:** none.

**Behavior:**

1. Return a fresh `RankingParams` value with the following fields
   set, matching `DEFAULT_RANKING` in `src/types.ts:195-204` exactly:

    | Field | Value |
    |---|---|
    | `BM25K1` | `1.2` |
    | `BM25B` | `0.75` |
    | `TitleWeight` | `3.0` |
    | `CodeWeight` | `1.5` |
    | `DescriptionWeight` | `2.0` |
    | `TermProximityBonus` | `2.0` |
    | `FullCoverageBonus` | `5.0` |
    | `PrefixPenalty` | `0.5` |

**Postconditions:**

- Each call returns a value, not a pointer; callers can mutate their
  copy without affecting other callers.

**Errors:** none.

**Edge cases:** none.

**Parity requirements:**

- `json.Marshal(types.DefaultRanking())` must produce the same byte
  sequence as `JSON.stringify(DEFAULT_RANKING)` modulo field order. A
  fixture-driven test compares canonicalized JSON.

**Test requirements (unit):**

- `TestDefaultRanking_MatchesTSFixture` — load
  `testdata/fixtures/types/default_ranking.json`, unmarshal into
  `RankingParams`, compare with `reflect.DeepEqual` to
  `DefaultRanking()`.
- `TestDefaultRanking_ReturnsValueNotSharedPointer` — call twice,
  mutate one copy's `BM25K1`, assert the other copy is unchanged.

**Test requirements (e2e):** none — this type does not cross the MCP
boundary directly.

### `SingleRootConfig`

**Signature:**

```go
func SingleRootConfig(docsRoot, collectionName string) IndexConfig
```

**Preconditions:**

- `docsRoot` is a filesystem path. This function does not validate or
  resolve it; callers are responsible for normalization.
- `collectionName` is a non-empty string. Empty is tolerated (matches
  TS behavior: TS uses `"docs"` as the default via a parameter default,
  Go callers must pass the default explicitly).

**Behavior:**

1. Return an `IndexConfig` with exactly one entry in `Collections`:

    | Field | Value |
    |---|---|
    | `Name` | `collectionName` |
    | `Root` | `docsRoot` |
    | `Weight` | `1.0` |
    | `GlobPattern` | `"**/*.md"` |

2. Set `SummaryLength` to `200`.
3. Set `MaxDepth` to `6`.
4. Leave `CodeCollections` nil (JSON omits it because of `omitempty`).

**Postconditions:**

- `len(cfg.Collections) == 1`.
- `cfg.CodeCollections == nil`.

**Errors:** none.

**Edge cases:**

- `collectionName == ""`: returned unchanged; validation is the
  caller's job.

**Parity requirements:**

- Must produce an `IndexConfig` that marshals to the same JSON
  structure as TS `singleRootConfig(docsRoot, collectionName)` at
  `src/types.ts:232`. Fixture:
  `testdata/fixtures/types/single_root_config.json`.

**Test requirements (unit):**

- `TestSingleRootConfig_DefaultName` — call with
  `("./docs", "docs")`; assert every field.
- `TestSingleRootConfig_CustomName` — call with `("./wiki", "wiki")`;
  assert `Collections[0].Name == "wiki"`.
- `TestSingleRootConfig_OmitsCodeCollections` — marshal to JSON,
  assert the output byte slice does not contain
  `"code_collections"`.

**Test requirements (e2e):** none.

## Invariants

1. **Non-nil slices for non-optional fields.** Every slice field
   listed in the `Types` section with the `never nil` comment must be
   initialized with `make([]T, 0)` at construction time. The Go
   `encoding/json` package serializes `nil` as `null`; the TS oracle
   serializes `[]` for an empty array. Any drift here breaks
   fixture parity and the MCP tool response shape.

    Affected fields:
    `TreeNode.Children`, `TreeOutline.Nodes`, `OutlineNode.Children`,
    `DocumentMeta.Tags`, `DocumentMeta.Facets` (and every value slice
    inside it), `DocumentMeta.References`, `IndexedDocument.Tree`,
    `IndexedDocument.RootNodes`, `Posting.Positions`,
    `SearchResult.MatchPositions`, `SearchResult.MatchedTerms`,
    `SearchResult.Facets`.

2. **Non-nil maps for non-optional fields.** `DocumentMeta.Facets`
   and `SearchResult.Facets` must be initialized with
   `make(map[string][]string)` even when a document has zero facets.
   `FilterIndex` and `FacetCounts` are always initialized by their
   owning package (`internal/store`).

3. **`omitempty` rules.**
   - `CollectionConfig.GlobPattern` carries `omitempty` — the empty
     glob is a valid sentinel meaning "use the default", and TS
     `JSON.stringify` elides `undefined`.
   - `IndexConfig.CodeCollections` carries `omitempty` — TS omits it
     when unset.
   - No other field carries `omitempty`. In particular, zero-valued
     `int` and empty `string` fields are emitted explicitly to match
     TS.

4. **`ParentID` nil semantics.** A nil `*string` marshals as JSON
   `null`. A non-nil pointer to an empty string marshals as `""`.
   Producers use nil for true roots; empty string is not a legal value
   and must never appear.

5. **`DocumentMeta.LastModified` format.** Always RFC3339 in UTC
   (e.g., `2026-04-11T12:34:56Z`), matching `Date.toISOString()` on
   the TS side. The owning `indexer` package uses
   `time.Format(time.RFC3339)` on UTC time, not `.RFC3339Nano`.

6. **`DocumentMeta.ContentHash` format.** 16-character lowercase hex
   representation of the xxhash64 of the raw file bytes. No `0x`
   prefix. See `spec/fsutil.md` for hash derivation.

7. **`DocumentMeta.FilePath` normalization.** Always POSIX slashes,
   never backslashes, even on Windows. Cross-platform fixture parity
   depends on this.

8. **`Posting.TermFrequency` equals `len(Positions)`.** The field is
   duplicated for lookup efficiency; any producer that desyncs them
   violates the BM25 contract.

## Concurrency

- Instances of every type in this package are immutable once
  constructed and handed to another package. Concurrent readers do not
  need locks.
- Mutation belongs to the owning package. For example, `internal/store`
  holds `DocumentMeta` values inside an `sync.RWMutex`-protected
  structure; callers of `store.Search` receive copies or deep-cloned
  `SearchResult` values so the returned data is safe to serialize
  without holding the lock.
- `DefaultRanking()` and `SingleRootConfig()` are pure functions and
  trivially safe to call from any goroutine.

## Fixture data

`testdata/fixtures/types/` — dumped by `scripts/dump-fixtures.ts` from
the TS implementation.

- `default_ranking.json` — `JSON.stringify(DEFAULT_RANKING)`.
- `single_root_config.json` — `JSON.stringify(singleRootConfig("./docs", "docs"))`.
- `tree_node_sample.json` — a representative `TreeNode` with all
  fields populated including `parent_id: null` and empty
  `children: []`, to lock the null-vs-empty-array convention.
- `document_meta_sample.json` — a representative `DocumentMeta`
  including `facets` with multiple keys, `tags`, `references`, and
  an RFC3339 `last_modified`.
- `search_result_sample.json` — a `SearchResult` including empty
  `match_positions` and `matched_terms` arrays (not `null`), to
  assert the `make([]T, 0)` convention.
- `empty_indexed_document.json` — an `IndexedDocument` whose tree is
  empty to pin the `[]` serialization of `Tree` and `RootNodes`.

Every fixture in this directory is regenerated whenever `src/types.ts`
changes. The Phase B test suite loads each file, round-trips it
through the Go `internal/types` package, and asserts byte-identical
JSON after canonicalization.
