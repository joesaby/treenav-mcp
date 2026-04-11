# Curator (Wiki Write Path)

## Summary

The curator is treenav-mcp's first and only mutation path: three deterministic
functions that let an MCP-calling agent dedupe, scaffold, and write new
markdown entries under a confined wiki root, then trigger an incremental
re-index so the new file is immediately searchable. It is opt-in, gated by
`WIKI_WRITE=1` at process start, and performs **zero LLM calls** — every
output is a pure function of the current `DocumentStore` state. The calling
agent (Claude Desktop, Claude Code, etc.) is the librarian that authors the
markdown body using its own model; treenav is the library infrastructure that
validates path containment, frontmatter shape, and duplicate risk, and that
guarantees the resulting file is atomically folded back into the index.

The Go port preserves the TS curator's public surface and error codes
verbatim. The one architectural change is that path containment — previously
a private helper inside `src/curator.ts` — is extracted into
`internal/safepath` so the security boundary can be reviewed, fuzzed, and
reused by any future write path. See ADR 0001 for the feature motivation and
ADR 0002 for the port rationale.

## Go package

`internal/curator` — stateless write-path helpers for the curation toolset
(`find_similar`, `draft_wiki_entry`, `write_wiki_entry`). Maps to
`src/curator.ts` (639 lines) one-for-one.

Exports:

- `Options` — runtime configuration carried from env-var parsing.
- `FindSimilarResult`, `SimilarityMatch` — dedupe-check outputs.
- `WikiDraft`, `WikiBacklink` — scaffold outputs from `DraftWikiEntry`.
- `WriteWikiInput`, `WriteWikiResult` — args and result of the only tool
  that touches disk.
- `FindSimilar`, `DraftWikiEntry`, `WriteWikiEntry` — the three entry points.
- Sentinel errors: `ErrPathEscape`, `ErrPathInvalid`, `ErrExists`,
  `ErrFrontmatterInvalid`, `ErrDuplicate`, `ErrWriteFailed`.

Internal helpers (lowercase, not exported):

- `serializeMarkdown`, `formatYAMLScalar`, `validateFrontmatter`
- `tokenizeForQuery` (deliberately distinct from `internal/store.tokenize`)
- `aggregateFacetsFromMatches`, `synthesizePathFromTopic`, `topicToSlug`,
  `topicToTitle`, `escapeRegex`.

## Public API (Go signatures)

```go
package curator

import (
    "context"
    "errors"
    "time"

    "github.com/treenav/treenav-mcp/internal/store"
    "github.com/treenav/treenav-mcp/internal/types"
)

// Options is the runtime config for the curation toolset. Built once at
// process startup from WIKI_WRITE / WIKI_ROOT / WIKI_DUPLICATE_THRESHOLD
// and passed by value into every curator call.
type Options struct {
    Root               string  // absolute, already-validated wiki root
    CollectionName     string  // defaults to "docs" if empty
    DuplicateThreshold float64 // 0..1; defaults to 0.35 if zero
}

// SimilarityMatch is one dedupe hit reported by FindSimilar.
type SimilarityMatch struct {
    NodeID  string  `json:"node_id"`
    DocID   string  `json:"doc_id"`
    Path    string  `json:"path"`
    Title   string  `json:"title"`
    Score   float64 `json:"score"`
    Overlap float64 `json:"overlap"`
    Snippet string  `json:"snippet"`
}

// FindSimilarResult is the top-N dedupe report for a body of text.
type FindSimilarResult struct {
    Matches        []SimilarityMatch `json:"matches"`
    TokensAnalyzed int               `json:"tokens_analyzed"`
    SuggestMerge   bool              `json:"suggest_merge"`
}

// WikiBacklink is a candidate cross-link surfaced by DraftWikiEntry.
type WikiBacklink struct {
    NodeID string  `json:"node_id"`
    DocID  string  `json:"doc_id"`
    Title  string  `json:"title"`
    Score  float64 `json:"score"`
    Reason string  `json:"reason"` // "bm25" | "shared_tag" | "shared_category"
}

// WikiDraftFrontmatter is the structured scaffold emitted by DraftWikiEntry.
type WikiDraftFrontmatter struct {
    Title       string   `json:"title"`
    Description string   `json:"description,omitempty"`
    Type        string   `json:"type,omitempty"`
    Category    string   `json:"category,omitempty"`
    Tags        []string `json:"tags"`
    SourceURL   string   `json:"source_url,omitempty"`
    CapturedAt  string   `json:"captured_at"`
}

// DuplicateWarning is the inline duplicate notice attached to drafts and
// non-overwrite writes.
type DuplicateWarning struct {
    DocID   string  `json:"doc_id"`
    Overlap float64 `json:"overlap"`
}

// WikiDraft is the scaffold DraftWikiEntry returns. No files are written.
type WikiDraft struct {
    SuggestedPath    string               `json:"suggested_path"`
    Frontmatter      WikiDraftFrontmatter `json:"frontmatter"`
    Backlinks        []WikiBacklink       `json:"backlinks"`
    GlossaryHits     []string             `json:"glossary_hits"`
    DuplicateWarning *DuplicateWarning    `json:"duplicate_warning,omitempty"`
}

// WriteWikiInput is the validated input to the only tool that touches disk.
type WriteWikiInput struct {
    Path           string                 `json:"path"`
    Frontmatter    map[string]any         `json:"frontmatter"`
    Content        string                 `json:"content"`
    DryRun         bool                   `json:"dry_run,omitempty"`
    AllowDuplicate bool                   `json:"allow_duplicate,omitempty"`
    Overwrite      bool                   `json:"overwrite,omitempty"`
}

// WriteWikiValidation mirrors the validation subfield from the TS surface.
type WriteWikiValidation struct {
    FrontmatterOK   bool `json:"frontmatter_ok"`
    ReservedKeysOK  bool `json:"reserved_keys_ok"`
    PathOK          bool `json:"path_ok"`
}

// WriteWikiResult is the successful (or dry-run) outcome of WriteWikiEntry.
type WriteWikiResult struct {
    Written          bool                `json:"written"`
    Path             string              `json:"path"`
    AbsolutePath     string              `json:"absolute_path"`
    DocID            string              `json:"doc_id,omitempty"`
    RootNodeID       string              `json:"root_node_id,omitempty"`
    Bytes            int                 `json:"bytes"`
    ReindexMillis    int64               `json:"reindex_ms"`
    DuplicateWarning *DuplicateWarning   `json:"duplicate_warning,omitempty"`
    Validation       WriteWikiValidation `json:"validation"`
}

// Sentinel errors. Part of the stable API — e2e tests use errors.Is.
var (
    ErrPathEscape         = errors.New("curator: path escapes wiki root")
    ErrPathInvalid        = errors.New("curator: invalid path")
    ErrExists             = errors.New("curator: file already exists")
    ErrFrontmatterInvalid = errors.New("curator: invalid frontmatter")
    ErrDuplicate          = errors.New("curator: content duplicate")
    ErrWriteFailed        = errors.New("curator: write failed")
)

// FindSimilarOptions is the optional argument pack for FindSimilar.
type FindSimilarOptions struct {
    Limit              int     // default 5
    Threshold          float64 // minimum score; default 0.1
    Collection         string  // empty = all collections
    DuplicateThreshold float64 // override Options.DuplicateThreshold for this call
}

// FindSimilar runs arbitrary text through the BM25 engine and reports the
// top-N overlapping nodes. Pure read; safe under the store's read lock.
func FindSimilar(
    s *store.DocumentStore,
    content string,
    opts FindSimilarOptions,
) FindSimilarResult

// DraftInput is the argument pack for DraftWikiEntry.
type DraftInput struct {
    Topic         string
    RawContent    string
    SuggestedPath string
    SourceURL     string
}

// DraftWikiEntry produces a structural scaffold for a new entry. No disk
// writes. Returns ErrPathInvalid / ErrPathEscape if SuggestedPath is set
// and rejected by safepath.
func DraftWikiEntry(
    s *store.DocumentStore,
    wiki Options,
    input DraftInput,
) (WikiDraft, error)

// WriteWikiEntry validates the input, optionally writes the file, then
// calls internal/indexer.IndexFile and store.AddDocument to fold the new
// file into the in-memory index. Returns typed sentinel errors on every
// rejection so callers can branch with errors.Is.
//
// ctx is threaded to indexer.IndexFile so a stuck stat/read can be
// cancelled by the MCP request lifecycle.
func WriteWikiEntry(
    ctx context.Context,
    s *store.DocumentStore,
    wiki Options,
    input WriteWikiInput,
) (WriteWikiResult, error)

// Time source override hook (package-private in spec). Tests swap it to
// pin CapturedAt. In production it is time.Now().UTC().
var nowFunc = func() time.Time { return time.Now().UTC() }
```

## Key behaviors

- **FindSimilar is pure.** Given the same store state and input, it is a
  deterministic function. The `overlap` metric is
  `min(1, matched_terms / unique_query_tokens)` — an approximate Jaccard
  lower bound documented in detail in the spec. The caller-visible
  `SuggestMerge` flag flips on when any returned match crosses the
  duplicate threshold.
- **DraftWikiEntry never writes.** Its only side effects are the
  monotonic clock read in `nowFunc()` and any allocation the store makes
  internally; it produces a scaffold the agent can render into the
  frontmatter + body of a subsequent `WriteWikiEntry` call.
- **WriteWikiEntry runs a fixed 7-step validation pipeline.** The order
  (path → extension → existence → frontmatter → duplicate → dry-run →
  write+reindex) is a stable contract because the first failing check
  determines which sentinel error surfaces, and e2e tests branch on
  `errors.Is`.
- **Path containment is delegated to `internal/safepath`.** The curator
  never re-implements path traversal checks; it calls
  `safepath.Validate(path, wikiRoot)` and maps the sentinel return to
  `ErrPathEscape` or `ErrPathInvalid`. See
  [spec/safepath.md](../spec/safepath.md).
- **YAML serialization is a byte-exact round-trip contract with
  `internal/indexer`.** `serializeMarkdown` must emit bytes that the
  indexer's simple frontmatter parser can read back losslessly; Phase B
  runs a property test that asserts
  `parseFrontmatter(serializeMarkdown(fm)) == fm` over every fixture.
- **Incremental re-index happens inside the store write lock.** After a
  successful write, `WriteWikiEntry` calls `store.AddDocument`, which
  takes the `sync.RWMutex` write lock, removes any prior postings for
  the (now-overwritten) doc, and re-inserts the new postings. Concurrent
  readers (queries, `get_tree`, etc.) continue safely.
- **`dry_run=true` returns the exact byte count that would be written.**
  Serialization runs before the dry-run short-circuit so callers can
  see the on-disk size they're about to commit to, without any disk
  state change.
- **Overwrite skips the duplicate check.** The TS code documents (and
  tests verify) that an overwrite would naturally find itself as a
  near-perfect duplicate; the Go port preserves the skip.
- **The curator tokenizer is not the store tokenizer.** `tokenizeForQuery`
  is a deliberately simpler regex-based splitter tuned to match the
  BM25 engine's term distribution closely enough for dedupe purposes.
  See the spec's "Divergence from store tokenizer" note.
- **Reserved frontmatter keys flow through unchanged.** The curator
  itself does not enforce the reserved-key policy beyond basic shape
  validation; the indexer filters reserved keys out of the facet index
  at re-index time. The curator's reserved set
  (`source_url`, `source_title`, `captured_at`, `curator`) joins the
  indexer's reserved set — see
  [spec/markdown-indexer.md](../spec/markdown-indexer.md).

## Dependencies

- **stdlib:** `context`, `errors`, `fmt`, `os`, `path/filepath`, `regexp`,
  `sort`, `strings`, `time`, `unicode`.
- **third-party:** none directly. The YAML emitted by the curator is a
  narrow subset handled by hand; the YAML *parser* in
  `internal/frontmatter` is the counterparty in the round-trip
  contract and lives behind its own spec.
- **internal:**
  - `internal/safepath` — single source of truth for path containment.
  - `internal/store` — `SearchDocuments`, `AddDocument`, `GetDocMeta`,
    `GetGlossaryTerms`.
  - `internal/indexer` — `IndexFile`, `InferTypeFromPath`.
  - `internal/frontmatter` — reserved-key registry for validation and
    round-trip assertions.
  - `internal/types` — `IndexedDoc`, `DocumentMeta`, `SearchResult`.

## Relationship to TS source

- Maps one-for-one to `src/curator.ts` (639 lines).
- Public surface and error codes are preserved verbatim — the Go
  sentinel errors correspond to the TS `CuratorError.code` string
  values `PATH_ESCAPE`, `PATH_INVALID`, `EXISTS`, `FRONTMATTER_INVALID`,
  `DUPLICATE`, `WRITE_FAILED`.
- Path validation logic is *removed* from the Go curator and replaced
  by `internal/safepath.Validate`. The TS helper `validateRelativePath`
  at `src/curator.ts:434-465` becomes the adversarial test oracle for
  `internal/safepath` instead of being ported into the curator.
- YAML serialization at `src/curator.ts:526-558` is ported byte-for-byte;
  the quoting rules in `formatYamlScalar` (`src/curator.ts:551-558`)
  become a table in the spec.
- Tokenization at `src/curator.ts:626-635` is preserved as a distinct
  helper and *not* merged with `internal/store.tokenize`. The
  divergence is intentional; see the spec.
- The separate re-index timer (`reindex_ms`) is preserved; Go uses
  `time.Since(start).Milliseconds()` with the same monotonic start.

## Non-goals

- Does **not** perform LLM calls. The "zero LLM calls in treenav" invariant
  from ADR 0001 is preserved; the curator is a deterministic function of
  the current index state plus the agent's input.
- Does **not** bypass `internal/safepath`. Any call to `os.Open` or
  `os.WriteFile` on an input-derived path without a prior
  `safepath.Validate` is a bug in the curator.
- Does **not** register its own MCP tools. Tool registration lives in
  `internal/mcp`, which reads `WIKI_WRITE` at startup and conditionally
  binds the curator functions to the three MCP tool names. See
  [spec/mcp-tools.md](../spec/mcp-tools.md).
- Does **not** commit to version control, touch git, or run
  subprocesses. "Git as undo" is a user convention documented in the
  README, not a curator responsibility.
- Does **not** support `merge_entries`, `delete_wiki_entry`, or
  `update_glossary`. Those are post-MVP tools in the original spec and
  are out of scope for the port.
- Does **not** provide its own locking. Concurrency safety is
  inherited from `internal/store`'s `sync.RWMutex`; the curator itself
  holds no mutable state. See
  [spec/concurrency-model.md](../spec/concurrency-model.md).
- Does **not** validate reserved frontmatter keys against the ADR's
  policy beyond basic shape checks (object, no newlines, array-of-scalar
  only). The indexer is the canonical reserved-key filter.
