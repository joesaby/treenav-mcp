# Spec: fsutil

**Feature doc:** [../features/fsutil.md](../features/fsutil.md)
**TS source:** `src/indexer.ts` (lines 576-578 for hashing; lines 665-669 for glob; file read at 588), `src/curator.ts` (scattered reads)
**Go package:** `internal/fsutil`

## Scope

This spec pins the semantics of the file-read, glob, and hash
primitives that every other package in the port consumes. It is
**not** authoritative over what those primitives are used for —
indexing strategy lives in `spec/markdown-indexer.md` and
`spec/incremental-index.md`. This spec only fixes the shape of the
primitives and the libraries they are built on.

## Types

```go
package fsutil

// (No package-level types. The package exposes only functions.)
```

## Functions

### `ReadFile`

**Signature:**

```go
func ReadFile(path string) ([]byte, error)
```

**Preconditions:**

- `path` is an absolute or relative OS-native filesystem path.
- The caller has already routed the path through
  `internal/safepath.Resolve` if it originated from user input.
  `fsutil` does not re-validate.

**Behavior:**

1. Call `os.ReadFile(path)`.
2. On success, return the bytes and nil.
3. On failure, wrap the underlying error with
   `fmt.Errorf("fsutil.ReadFile %q: %w", path, err)` and return.

**Postconditions:**

- On success, the returned slice is the exact byte contents of
  the file at the moment of the read call.

**Errors:**

| Condition | Sentinel | Message shape |
|---|---|---|
| File does not exist | `fs.ErrNotExist` (from stdlib) | `"fsutil.ReadFile %q: %w"` |
| Permission denied | `fs.ErrPermission` | `"fsutil.ReadFile %q: %w"` |
| Other OS error | *(wrapped)* | `"fsutil.ReadFile %q: %w"` |

**Edge cases:**

- Empty file: returns `[]byte{}`, nil. Never returns `nil` slice
  on success.
- File larger than available memory: returns whatever `os.ReadFile`
  returns; we do not guard against this. The indexer's input is
  text files, not multi-GB binaries.

**Parity requirements:**

- For any file path that both `Bun.file(path).text()` and
  `fsutil.ReadFile(path)` succeed on, the UTF-8 decoding of the
  Go result must equal the TS result byte-for-byte.

**Test requirements (unit):**

- `TestReadFile_Existing` — write a temp file, read it back,
  assert byte equality.
- `TestReadFile_NotFound` — assert `errors.Is(err,
  fs.ErrNotExist)`.
- `TestReadFile_Empty` — empty file returns zero-length non-nil
  slice.

**Test requirements (e2e):** none. Exercised transitively by the
indexer corpus parity run.

### `Glob`

**Signature:**

```go
func Glob(ctx context.Context, root, pattern string) ([]string, error)
```

**Preconditions:**

- `root` is a non-empty absolute directory path. `fsutil` does
  not validate — callers pass a `safepath.Root.String()` or an
  already-resolved absolute path.
- `pattern` is a doublestar-compatible glob. Empty pattern
  behaves as though `pattern == "**/*"`, matching all files.
- `ctx` is non-nil; `context.Background()` is acceptable.

**Behavior:**

1. If `pattern == ""`, substitute `"**/*"`.
2. Let `fsys := os.DirFS(root)`.
3. Call
   `matches, err := doublestar.Glob(fsys, pattern,
   doublestar.WithNoFollow())` to disable directory-symlink
   following (prevents walk cycles).
4. On error, return `nil, fmt.Errorf("fsutil.Glob root=%q
   pattern=%q: %w", root, pattern, err)`.
5. Check `ctx.Err()` after the Glob call and between every file
   in the result loop. If non-nil, return the context error
   wrapped with the same format string.
6. Iterate `matches`; for each entry:
   1. Convert to an absolute path with `filepath.Join(root,
      filepath.FromSlash(m))`.
   2. Call `os.Stat` to reject directory matches and to filter
      out entries that have vanished between the glob walk and
      the stat.
   3. Skip entries where `Stat` returns `os.ErrNotExist`
      (race with deletion) or where `info.IsDir()` is true.
   4. Append the absolute path to a result slice.
7. Sort the result slice lexicographically (`sort.Strings`).
8. If the slice is nil after the loop, replace it with
   `make([]string, 0)` before returning.
9. Return the slice, nil.

**Postconditions:**

- The returned slice contains only files (not directories), each
  an absolute path rooted at `root`.
- The slice is lexicographically sorted.
- The slice is non-nil even when empty.
- If `ctx` was canceled mid-walk, the returned error wraps
  `ctx.Err()`.

**Errors:**

| Condition | Sentinel | Message shape |
|---|---|---|
| Invalid pattern | *(doublestar-specific)* | `"fsutil.Glob root=%q pattern=%q: %w"` |
| Root does not exist | `fs.ErrNotExist` | `"fsutil.Glob root=%q pattern=%q: %w"` |
| `ctx` canceled | `context.Canceled` | `"fsutil.Glob root=%q pattern=%q: %w"` |
| Permission error on a child dir | *(logged, continues)* | (no returned error) |

**Edge cases:**

- `root` points at a file: doublestar returns an error; wrapped
  and returned.
- `pattern` contains `..`: rejected by doublestar as not
  matching anything; returned slice is empty. **fsutil does
  not sanitize patterns** — if the caller wants safety, use
  `safepath.Resolve` on each returned path before opening it.
- Zero matches: returns empty non-nil slice, nil error.
- File symlink pointing inside root: followed, returned.
- File symlink pointing outside root: followed by doublestar and
  returned; the absolute path in the result still names the
  in-root location. Callers that want to reject this must run
  `safepath.Resolve` on each path.
- Directory symlink: `WithNoFollow` skips it.
- Case sensitivity: inherited from the filesystem. `*.md`
  matches `Foo.md` on macOS/Windows but not on Linux.

**Parity requirements:**

- Given the same root and the same pattern, Go `Glob` and TS
  `Bun.Glob(pattern).scan({cwd: root, absolute: true})` must
  return the same set of paths. Ordering parity is enforced by
  the sort step; TS output is sorted in the fixture dumper
  before comparison.

**Test requirements (unit):**

- `TestGlob_MatchesAllMarkdown` — build a fixture tree with
  `a.md`, `dir/b.md`, `dir/sub/c.md`, `dir/notes.txt`, call
  `Glob(ctx, root, "**/*.md")`, assert exactly
  `[a.md, dir/b.md, dir/sub/c.md]`.
- `TestGlob_EmptyPatternDefaults` — assert `""` behaves as
  `**/*`.
- `TestGlob_ReturnsEmptyNotNil` — glob an empty dir, assert
  `len == 0` and `slice != nil`.
- `TestGlob_ContextCancel` — create a large tree, call with a
  context canceled after the first yield, assert
  `errors.Is(err, context.Canceled)`.
- `TestGlob_DirectorySymlinkNotFollowed` — create a symlink
  from `root/loop` back to `root`, glob, assert it does not
  recurse infinitely.
- `TestGlob_DeterministicOrder` — call twice, assert identical
  ordered output.
- `TestGlob_ExcludesDirectories` — pattern `**` matches
  everything; Glob filters out directory entries.

**Test requirements (e2e):**

- Indexer end-to-end: `DOCS_ROOT` containing a mix of files and
  directories indexes the expected files and no more.

### `Hash`

**Signature:**

```go
func Hash(b []byte) string
```

**Preconditions:**

- `b` is non-nil. `nil` is accepted and treated as an empty byte
  slice.

**Behavior:**

1. Compute `sum := xxhash.Sum64(b)` from
   `github.com/cespare/xxhash/v2`.
2. Format as `fmt.Sprintf("%016x", sum)` — lowercase, 16
   characters, leading zeros preserved.
3. Return the string.

**Postconditions:**

- Return value is always 16 ASCII hex characters.
- `Hash(b)` is deterministic for a given byte slice.

**Errors:** none.

**Edge cases:**

- Empty input: returns the xxhash of an empty string,
  `"ef46db3751d8e999"`. The return is never empty.

**Parity requirements:**

- Go `Hash` returns the same value as any other xxhash64
  implementation with the same input. It does **not** match
  `Bun.hash()`, which uses wyhash. The migration does not
  preserve on-disk hash compatibility with the TS version; see
  the feature doc for rationale. The spec does not require
  cross-runtime hash parity — it requires within-runtime
  determinism only.

**Test requirements (unit):**

- `TestHash_EmptyBytes` — assert 16-char lowercase hex.
- `TestHash_KnownValue` — assert
  `Hash([]byte("hello"))` equals the documented xxhash64 of
  `"hello"` (`"26c7827d889f6da3"`).
- `TestHash_StableAcrossCalls` — call 1,000 times with the
  same input, assert every return value equal.
- `TestHash_Length` — assert returned string length is exactly
  16 for random inputs of varying size.

**Test requirements (e2e):** none — exercised transitively by
`spec/incremental-index.md`.

### `HashString`

**Signature:**

```go
func HashString(s string) string
```

**Preconditions:** none.

**Behavior:**

1. Compute `xxhash.Sum64String(s)` (avoids a copy versus
   `Hash([]byte(s))`).
2. Format with `fmt.Sprintf("%016x", sum)`.
3. Return.

**Postconditions:** same as `Hash`.

**Errors:** none.

**Edge cases:** empty string returns the same constant as
`Hash([]byte{})`.

**Parity requirements:** identical output to `Hash([]byte(s))`
for any `s`.

**Test requirements (unit):**

- `TestHashString_MatchesHashBytes` — for a table of 20 strings,
  assert `HashString(s) == Hash([]byte(s))`.

**Test requirements (e2e):** none.

## Invariants

1. `Glob` never returns a nil slice on success.
2. `Hash` and `HashString` return strings of exactly 16
   characters, every character in `[0-9a-f]`.
3. No function in this package writes, creates, or deletes
   anything on disk. This is enforced by code review — the only
   allowed `os` calls are `ReadFile`, `Stat`, and the walk
   machinery inside `doublestar.Glob`.
4. Every error returned wraps the underlying cause with
   `%w` so callers can use `errors.Is` / `errors.As` to reach
   the sentinel.

## Concurrency

- All four functions are pure (modulo filesystem I/O in `ReadFile`
  and `Glob`).
- Safe to call from any number of goroutines simultaneously. The
  indexer runs `ReadFile` concurrently over batches of files and
  the package is expected to scale linearly with core count.
- `go test -race ./internal/fsutil/...` must be green under a
  stress test that fans out 64 concurrent `ReadFile` calls on a
  shared set of fixture files.

## Fixture data

`testdata/fixtures/fsutil/*.json`:

- `glob_cases.json` — array of
  `{root_layout, pattern, expected_files_relative}` entries
  where `root_layout` describes a temp directory structure the
  test should materialize. The Go test suite uses this to build
  the fs at test time and compares against the expected set.
- `hash_known_values.json` — array of
  `{input, expected_hex}` pairs. Not dumped from TS (TS uses a
  different hash); populated by a small Go generator run once
  and committed.
- `readfile_cases.json` — array of
  `{file_contents, expected_bytes_base64}` for sanity-checking
  UTF-8 content with BOMs, CRLF line endings, and trailing
  newlines.

Note: because `Hash` is not cross-runtime compatible with TS,
`hash_known_values.json` is Go-canonical. The Phase B fixture
dumper emits the same file from `internal/fsutil` after it is
implemented, and CI asserts the committed file matches the dump.
