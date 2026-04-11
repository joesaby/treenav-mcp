# Glossary Expansion

## Summary

Glossary expansion is the bidirectional query rewriter that lets searches
for `"CLI"` also match `"command line interface"` and vice versa. It is
seeded from an optional `glossary.json` file in the docs root and
augmented automatically from acronym definitions found in document
content (patterns like `"CLI (Command Line Interface)"`). The expansion
is applied after the query is tokenized and stemmed, so the expanded
terms go through the same normalization as the indexed postings and can
be looked up directly without a second stemming pass.

## Go package

`internal/store` — the glossary lives on `DocumentStore` alongside the
inverted index. It is loaded via `LoadGlossary`, populated by
`buildAutoGlossary` during `Load`, and consumed by `expandQueryTerms`
inside `SearchDocuments`.

Exports:

- `(*DocumentStore).LoadGlossary(entries map[string][]string)`
- `(*DocumentStore).GetGlossaryTerms() []string`
- File loader helper (used by `cmd/treenav-mcp`):
  - `LoadGlossaryFile(path string) (map[string][]string, error)`

## Public API (Go signatures)

```go
package store

// LoadGlossary replaces the current glossary with the supplied entries.
// Keys and expansions are lowercased; both directions (key→expansions
// and expansion→key) are inserted. Safe for concurrent callers.
// Matches src/store.ts:166-186.
func (s *DocumentStore) LoadGlossary(entries map[string][]string)

// GetGlossaryTerms returns the union of every key currently in the
// glossary (both acronyms and expansions). Used by the curator to flag
// glossary hits in raw source content. Order is lexicographic ascending
// for deterministic output. Matches src/store.ts:904-906.
func (s *DocumentStore) GetGlossaryTerms() []string

// LoadGlossaryFile reads a JSON file with shape map[string][]string,
// validates keys/values, and returns the parsed map. File absence is a
// non-error (returns an empty map, nil). Used by cmd/treenav-mcp.
func LoadGlossaryFile(path string) (map[string][]string, error)
```

## Key behaviors

- The on-disk format is a single JSON object: `{"CLI": ["command line
  interface"], "K8s": ["kubernetes"]}`. Keys and expansion strings are
  free-form UTF-8; they are case-folded to lowercase on load.
- `LoadGlossary` is bidirectional: for every `key → [exp1, exp2]` pair
  it also inserts `exp1 → [key]` and `exp2 → [key]`. If the reverse
  mapping already has entries, the new key is appended without dedupe
  churn (see `src/store.ts:175-181`).
- Auto-glossary extraction runs during `Load` via
  `indexer.ExtractGlossaryEntries`. It scans node content, document
  titles, and descriptions for three regex patterns (acronym-first,
  expansion-first, em-dash), then merges entries into the glossary
  **without overwriting** explicitly loaded entries. See
  `src/store.ts:225-286` and `src/indexer.ts:529-568`.
- Query expansion happens in `expandQueryTerms`: every stemmed query
  token is looked up; each matching expansion is itself tokenized and
  stemmed (since expansions are multi-word phrases), filtered to tokens
  of length >=2, and unioned with the original query. See
  `src/store.ts:192-209`.
- Expansions are added to a `set` (Go: `map[string]struct{}`) so
  duplicates collapse; the returned slice is iterated deterministically
  (the BM25 engine sorts it into the result accumulator per spec).
- An empty glossary is a no-op fast path: `expandQueryTerms` returns the
  input slice unchanged when `len(glossary) == 0`.
- The loader tolerates a missing file: if `GLOSSARY_PATH` is unset or
  the default `$DOCS_ROOT/glossary.json` does not exist, no error is
  raised. The store continues with only the auto-extracted entries.
- `GetGlossaryTerms` returns a lexicographically sorted slice. It
  is used by `internal/curator.DraftWikiEntry` to scan raw content for
  glossary hits, so the output must be deterministic to avoid flaky
  ordering in the draft response.

## Dependencies

- **stdlib:**
  - `encoding/json` — parses `glossary.json`.
  - `os` — reads the file. `errors.Is(err, os.ErrNotExist)` for the
    missing-file fast path.
  - `sort` — deterministic ordering of `GetGlossaryTerms`.
  - `strings` — `strings.ToLower` for case folding.
- **third-party:** none.
- **internal:**
  - `internal/indexer` — `ExtractGlossaryEntries` for the auto-glossary
    pass. Lives in the indexer package because the same regexes are used
    there to emit structured frontmatter hints.
  - `internal/types` — shared types only.

## Relationship to TS source

- `LoadGlossary` → `src/store.ts:166-186`.
- `expandQueryTerms` (unexported) → `src/store.ts:192-209`.
- `buildAutoGlossary` (unexported) → `src/store.ts:225-286`.
- `GetGlossaryTerms` → `src/store.ts:904-906`.
- `extractGlossaryEntries` → `src/indexer.ts:529-568` (stays in
  `internal/indexer`, not duplicated).

### Notable differences

1. **Deterministic ordering.** TS `Object.entries` preserves insertion
   order; Go map iteration is randomized. The Go port iterates loaded
   JSON by a sorted key slice so that auto-glossary merges are
   reproducible.
2. **Separate file loader.** The TS version reads the glossary via the
   main `server.ts`. The Go port extracts a standalone
   `LoadGlossaryFile` helper so that the CLI (`cmd/treenav-mcp`), the
   HTTP variant, and the tests all share one loader.
3. **Case folding uses `strings.ToLower`.** This is ASCII-compatible
   with the TS `.toLowerCase()` call for the glossary entries in the
   oracle corpus. Non-ASCII cases are explicitly out of scope for
   Phase A (tracked in `docs/spec/glossary-expansion.md`).

## Non-goals

- Directional-only expansion. Every entry goes both ways; there is no
  "one-way" flag.
- Weighting expansions. Expanded terms score at the same BM25 weight as
  direct query terms.
- Synonym chaining. Expansion is one hop: looking up `"TLS"` finds
  `"transport layer security"` but the expansion's own expansions are
  not recursively resolved.
- Runtime editing of the glossary. There is no "add glossary entry"
  MCP tool. Re-running `Load` is the supported path for refreshing
  glossary entries.
- Stop-word handling. Short expansion tokens (length < 2) are filtered
  by the same rule as indexing; there is no additional stop-word list.
