# Markdown Indexer

## Summary

The markdown indexer is the doc side of the treenav-mcp pipeline: it walks a
directory, opens each markdown file, splits frontmatter from body, parses
headings into a `TreeNode` hierarchy with line ranges, extracts facets (and
auto-infers `type` from the path), and returns an `IndexedDoc`. Both the
initial bulk index and the curator's incremental re-index path call the same
single-file entry point — there is exactly one code path that turns a `.md`
file into a tree, regardless of who triggers it. The Go port uses a
line-by-line regex parser as the primary implementation, mirroring the
authoritative TS fallback at `src/indexer.ts:221` and avoiding a CommonMark
dependency for v2.0.0.

## Go package

`internal/indexer` — scan a docs root, parse markdown files into
`IndexedDoc` values, and expose the per-file entry point used by the curator.

Exports:
- `IndexedDoc` (re-exported from `internal/types` for convenience)
- `IndexFile(ctx, path, root, collection) (IndexedDoc, error)`
- `IndexCollection(ctx, cfg CollectionConfig) ([]IndexedDoc, error)`
- `BuildTree(body, docID string) []TreeNode`
- `InferTypeFromPath(relPath string) string`
- `ExtractGlossaryEntries(text string) map[string][]string`

Internal helpers (lowercase, not exported):
- `extractReferences`, `extractContentFacets`, `improveGenericTitle`,
  `extractFirstSentence`, `normalizePath`.

## Public API (Go signatures)

```go
package indexer

import (
    "context"

    "github.com/treenav/treenav-mcp/internal/types"
)

// IndexFile parses a single markdown file into an IndexedDoc.
//
// This is the canonical per-file entry point. The initial bulk indexer
// calls it in parallel for every match under a collection root, and the
// curator's WriteWikiEntry calls it after writing a new file to re-index
// just that one file. It holds no state; callers may invoke it from any
// goroutine.
//
// path must be an absolute path inside root. root is the collection root
// (docs or wiki directory). collection is the collection name used to
// namespace the resulting doc_id.
func IndexFile(
    ctx context.Context,
    path, root, collection string,
) (types.IndexedDoc, error)

// IndexCollection walks a collection root, finds every file matching
// cfg.GlobPattern (default "**/*.md"), and invokes IndexFile on each
// one concurrently. Files that fail to index are logged and skipped;
// the returned slice contains only successful results.
func IndexCollection(
    ctx context.Context,
    cfg types.CollectionConfig,
) ([]types.IndexedDoc, error)

// BuildTree parses markdown body text into a flat slice of TreeNodes.
// The slice is in document order; children[] holds node_ids, and
// parent_id is "" for root nodes. line_start and line_end are 1-indexed
// line numbers into body, inclusive.
//
// When body contains no ATX headings, BuildTree returns a single
// synthetic root node ("(document root)") covering the full file.
func BuildTree(body, docID string) []types.TreeNode

// InferTypeFromPath examines the directory segments of a doc-relative
// path (not the filename) and returns a canonical type string such as
// "runbook", "guide", or "adr". Returns "" when no pattern matches.
//
// Used by IndexFile as a fallback when frontmatter has no "type" key,
// and by the curator's DraftWikiEntry to seed the frontmatter for new
// entries. Part of the stable API — both callers depend on the exact
// mapping.
func InferTypeFromPath(relPath string) string

// ExtractGlossaryEntries scans text for acronym definitions in three
// patterns ("ACRO (expansion)", "expansion (ACRO)", "ACRO — expansion")
// and returns a map suitable for merging into the BM25 store's glossary.
func ExtractGlossaryEntries(text string) map[string][]string
```

## Key behaviors

- **Frontmatter split is YAML-fence only.** A file is split into
  frontmatter and body iff it begins with `---\n`, contains a matching
  closing `---\n`, and parses as a YAML map. Anything else is indexed as
  pure body with empty frontmatter. Parsing itself is delegated to
  `internal/frontmatter`.
- **Heading parser is line-based regex.** The primary `BuildTree`
  implementation matches `^(#{1,6})\s+(.+)$` line by line. There is no
  CommonMark processor in the default build; this mirrors the TS
  `buildTreeRegex` fallback exactly, and keeps the port dependency-free.
- **Line ranges are 1-indexed and inclusive.** A node's `line_start` is
  the line of its heading; its `line_end` is the line *before* the next
  heading at the same or shallower level, or the last line of the file
  for the final node. `get_node_content` slices the raw file on these
  ranges.
- **Parent linkage walks the open stack.** When a heading at level `L`
  is emitted, its `parent_id` is the most recent earlier node with
  `level < L`. That parent's `children[]` gains the new node's id.
  Orphan headings (no shallower ancestor) have `parent_id == ""`.
- **Node IDs are deterministic.** `{collection}:{relPath-without-ext}:n{counter}`,
  where `counter` starts at 1 and increments per heading. Two runs over
  the same corpus produce byte-identical ids; no randomness, no hash
  salts, no timestamps.
- **Title fallback chain.** Frontmatter `title` wins; otherwise the
  first node with `level <= 1`; otherwise the filename with extension
  stripped. After selection, generic titles (`Introduction`, `Overview`,
  `Index`, `README`, `Home`, ...) are prefixed with the immediate parent
  directory name in title case, joined by an em dash.
- **Type inference is facet-level.** When frontmatter has no `type`
  key, `InferTypeFromPath` runs on `relPath` and, if it matches,
  writes `facets["type"] = []string{inferredType}`. Explicit frontmatter
  always wins.
- **Content hashing uses the raw file bytes.** The hash covers the
  entire on-disk content, frontmatter included, so any edit invalidates
  the hash. `internal/store.AddDocument` uses it to skip re-indexing
  unchanged files.

## Dependencies

- **stdlib:**
  - `context` — cancellation through the walk
  - `os`, `io/fs`, `path/filepath` — reading and relative-path math
  - `regexp` — heading, link, and glossary patterns (all compiled once
    as package-level `*regexp.Regexp` values)
  - `strings`, `unicode` — title casing, path normalization
  - `sort` — deterministic facet output
- **third-party:**
  - `github.com/bmatcuk/doublestar/v4` — `**/*.md` glob semantics that
    match Bun's `Bun.Glob`
- **internal:**
  - `internal/types` — `TreeNode`, `DocMeta`, `IndexedDoc`,
    `CollectionConfig`
  - `internal/frontmatter` — YAML subset parser; returns
    `(map[string]any, body, error)`. This indexer never touches YAML
    directly.
  - `internal/fsutil` — `ReadFile`, `Stat`, `ContentHash` (xxhash
    wrapper), `WalkGlob`

## Relationship to TS source

- Maps to `src/indexer.ts` in its entirety, excluding the
  `Bun.markdown.render` fast path (lines ~115-218).
- Ports `buildTreeRegex` (`src/indexer.ts:221`) as the primary
  `BuildTree` implementation. Byte-exact parity with the TS fallback is
  the parity target; the `Bun.markdown` path is *not* ported, since it
  was always equivalent to the regex path on well-formed input and
  caused divergence on malformed input.
- Ports `indexFile` (`src/indexer.ts:583`), `indexCollection`
  (`src/indexer.ts:659`), `inferTypeFromPath` (`src/indexer.ts:390`),
  `improveGenericTitle` (`src/indexer.ts:422`), `extractReferences`
  (`src/indexer.ts:443`), `extractContentFacets` (`src/indexer.ts:488`),
  `extractFirstSentence` (`src/indexer.ts:70`), and
  `extractGlossaryEntries` (`src/indexer.ts:529`).
- `extractFrontmatter` (`src/indexer.ts:300`) is **not** ported here.
  The TS version is a regex-based minimal YAML parser; the Go port
  delegates to `internal/frontmatter`, which uses `gopkg.in/yaml.v3`
  for the full YAML subset the curator needs for round-trip.
- `indexAllCollections` and `indexDirectory` (deprecated) are collapsed
  into a single entry point: the caller builds a `[]CollectionConfig`
  and calls `IndexCollection` in a loop. Multi-collection fan-out lives
  in `cmd/treenav-mcp`, not in `internal/indexer`.
- Notable differences:
  - Parent lookup in `BuildTree` uses an open-section stack (slice of
    node indices) instead of scanning backwards through `state.nodes`
    on every heading. Same result, O(n) instead of O(n²) on deep docs.
  - The regex used for `acronymFirst`, `expansionFirst`, and
    `dashPattern` in `ExtractGlossaryEntries` is compiled once at
    package init. Go's `regexp` package does not support the
    `(?:...)` flag mismatches we saw in the TS patterns, but the
    patterns themselves are Perl-compatible enough that `regexp`'s
    RE2 engine accepts them verbatim.
  - `line_end` calculation: the TS code sets `prev.line_end = i` when
    it encounters the next heading at line `i` (0-indexed); the Go
    port computes `lineEnd = nextHeadingLine - 1` with the same
    1-indexed semantics. Parity tests verify the ranges match exactly.
  - Generic-title prefixing applies `strings.Title`-equivalent casing
    with full Unicode awareness via `golang.org/x/text/cases` *if*
    used; the default stdlib implementation is a small manual loop
    over `unicode.ToUpper` to avoid the extra dependency.

## Non-goals

- **No CommonMark fidelity.** Nested emphasis, reference-style links,
  setext headings (`====`/`----`), and HTML-in-markdown are not parsed.
  The TS implementation did not handle setext headings either, and no
  consumer relies on them. A `goldmark`-backed `BuildTree` is a
  separate, opt-in enhancement scheduled post-2.0.0.
- **No content transformation.** The indexer does not rewrite links,
  resolve includes, strip HTML comments, or normalize whitespace. The
  raw body is preserved for `get_node_content`.
- **No store mutation.** `IndexFile` returns an `IndexedDoc`; inserting
  it into the BM25 index is `internal/store.AddDocument`'s job. This
  separation is what lets the curator re-index a single file without
  touching store internals.
- **No code parsing.** Source files go through `internal/codeindex`,
  not this package. The two pipelines produce identical `IndexedDoc`
  shapes so downstream code doesn't care which produced them, but they
  share no parsing logic.
- **No file watching.** Incremental reindex is caller-driven: the
  curator calls `IndexFile` after a write; a future `--watch` mode
  would be a separate package layered on top.
- **No cross-file graph.** `extractReferences` emits doc-relative link
  targets as strings, but this package never resolves them against the
  rest of the collection. Graph building, if added, happens in a
  consumer.
