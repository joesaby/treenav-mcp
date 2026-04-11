# fsutil

## Summary

A tiny, deliberately boring wrapper around the handful of filesystem
operations the port needs: read a whole file into bytes, walk a
directory with a glob pattern, and hash bytes deterministically. It
exists so every other package has one import path for these
operations and so the swap from Bun primitives (`Bun.file`,
`Bun.Glob`, `Bun.hash`) to Go libraries is localized to one place.

## Go package

`internal/fsutil` — file IO, glob discovery, and content hashing.

Exports:

- `ReadFile` — slurp a whole file into memory.
- `Glob` — expand a doublestar pattern against a root and return
  the matched files as absolute paths.
- `Hash` — deterministic 64-bit content hash as a 16-char lowercase
  hex string, used for incremental re-indexing.
- `HashString` — string variant that avoids an extra allocation in
  the hot path.

## Public API (Go signatures)

```go
package fsutil

import (
    "context"
)

// ReadFile reads an entire file into a byte slice. A thin wrapper
// around os.ReadFile that exists so the indexer does not hard-code
// an os import and so we can swap to io/fs-based reads in tests.
func ReadFile(path string) ([]byte, error)

// Glob expands a doublestar pattern against a filesystem root and
// returns the matched files as absolute paths, sorted
// lexicographically. The pattern follows the syntax of
// github.com/bmatcuk/doublestar/v4 — crucially, "**" matches zero
// or more directory levels, which is the convention treenav relies
// on for patterns like "**/*.md".
//
// Glob walks the filesystem directly; it does not use Go's io/fs
// abstraction because the indexer needs live on-disk paths.
//
// The ctx is honored between files — cancellation stops the walk
// at the next directory boundary.
func Glob(ctx context.Context, root, pattern string) ([]string, error)

// Hash returns the lowercase hex of the 64-bit xxhash of b. The
// returned string is always 16 characters long. The hash is used
// for content-addressed incremental re-indexing (Pagefind-style).
func Hash(b []byte) string

// HashString is a zero-copy variant of Hash for callers that have
// the content as a string already.
func HashString(s string) string
```

## Key behaviors

- `ReadFile` returns the raw bytes of the file with no
  interpretation. Callers that want UTF-8 validation do it
  themselves (e.g., `internal/frontmatter` checks before parsing).
- `Glob` returns an empty slice (`make([]string, 0)`), not `nil`,
  when no files match. This keeps JSON round-trip parity trivial
  for any caller that marshals the result into a debug endpoint.
- `Glob` sorts its output lexicographically by absolute path. The
  indexer depends on deterministic iteration order to produce
  stable `doc_id` sequences across runs.
- `Glob` silently skips files for which `os.Stat` returns a
  permission error. A permission error on a directory *during
  the walk* is logged and the subtree is skipped. No error is
  returned for these.
- `Glob` follows symlinks to files but not to directories, to
  avoid traversal cycles. (Directory symlink behavior is the
  doublestar library default — callers who need cycle detection
  should use `internal/safepath` before opening each result.)
- `Hash` uses `github.com/cespare/xxhash/v2` with no seed. Output
  format is `strconv.FormatUint(sum, 16)` left-padded to 16
  hex digits with leading zeros (equivalent to
  `fmt.Sprintf("%016x", sum)`).
- `Hash` and `HashString` are pure functions; safe for concurrent
  use.

## Dependencies

- **stdlib:** `context`, `os`, `io/fs`, `path/filepath`, `sort`,
  `strings`, `strconv`.
- **third-party:**
  - `github.com/bmatcuk/doublestar/v4` — glob engine with `**`
    support. The default `filepath.Glob` does not support `**`,
    which is why we depend on a third-party library.
  - `github.com/cespare/xxhash/v2` — content hashing.
- **internal:** none. This package does not import `safepath`;
  callers are responsible for applying safepath checks before
  opening any file path returned by `Glob`.

## Relationship to TS source

- `ReadFile` replaces `Bun.file(path).text()` usage scattered
  through `src/indexer.ts:588` and `src/curator.ts`. The TS code
  reads as UTF-8 strings; the Go version returns bytes and lets
  the caller decode. The difference is invisible to callers
  because the first thing every caller does is treat the content
  as a string.
- `Glob` replaces the `Bun.Glob(pattern).scan({ cwd: root,
  absolute: true })` usage at `src/indexer.ts:665-669`. Bun's
  glob implements `**/*.md` natively; `doublestar/v4` is the
  closest Go analog and supports the identical syntax.
- `Hash` replaces `Bun.hash(content).toString(16)` at
  `src/indexer.ts:576-578`. Bun uses wyhash internally; Go uses
  xxhash64. **The two hashes are different**: an on-disk index
  produced by one runtime cannot be compared directly with an
  index produced by the other. This is acceptable because
  treenav re-indexes on every startup — the hash is only used
  as a within-run equality check for incremental
  `AddDocument` decisions. Document this in the migration notes
  and in the `Hash` godoc.

## Non-goals

- This package does not stream file contents. Every markdown
  file or code file treenav indexes fits comfortably in memory;
  a streaming API would complicate every caller for no real
  benefit.
- It does not expose a `WriteFile`. The curator write path does
  its own `os.WriteFile` inside `internal/curator` so the write
  is adjacent to the fsync/rename logic and visible to readers
  auditing the write boundary.
- It does not cache file contents or hashes. The store holds
  one hash per indexed document; any caching beyond that is
  premature.
- It does not expose the underlying `xxhash.Digest` type or
  streaming hash API. If a future caller needs to hash a large
  stream chunk-by-chunk, add a `NewHasher()` returning
  `hash.Hash64` at that point, not before.
- It does not cross-platform-normalize glob patterns. The
  pattern passed in is handed directly to doublestar, which
  expects forward slashes everywhere. Callers on Windows must
  use `/` in their patterns (the default `"**/*.md"` works
  unchanged).
