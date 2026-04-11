# Spec: Safepath

**Feature doc:** [../features/safepath.md](../features/safepath.md)
**TS source:** `src/curator.ts` (function `validateRelativePath` at lines 434-465)
**Go package:** `internal/safepath`

## Scope

This spec is the authoritative contract for `internal/safepath`. It
defines what is accepted, what is rejected, how errors are reported,
and the complete adversarial-input list that the Phase B fuzz suite
must cover. Any code inside the Go port that takes a user-supplied
path and joins it with a trusted root **must** route through this
package. If a reviewer ever sees `filepath.Join(trustedRoot,
userInput)` in any non-test code outside this package, the review
fails.

## Types

```go
// Root is a validated trusted directory handle. The zero value is
// unusable.
type Root struct {
    // abs is the filepath.Clean'd, filepath.Abs'd path of the
    // trusted root. Stored once at NewRoot time; never mutated.
    abs string

    // absWithSep is abs + string(os.PathSeparator), precomputed so
    // the prefix check in Resolve is one string op.
    absWithSep string
}

// Resolved is the output of a successful Resolve call.
type Resolved struct {
    // Absolute is the OS-native, filepath.Clean'd absolute path of
    // the target. Safe to pass to os.Open, os.Stat, etc.
    Absolute string

    // Relative is the POSIX-slash, leading-slash-free, parent-dir-
    // free relative path from the Root. Stable across OSes; safe to
    // use as a map key or DocumentMeta.FilePath.
    Relative string
}
```

## Functions

### `NewRoot`

**Signature:**

```go
func NewRoot(root string) (Root, error)
```

**Preconditions:**

- `root` is a non-empty string.

**Behavior:**

1. If `root == ""`, return `Root{}, fmt.Errorf("%w", ErrEmptyPath)`.
2. Run `filepath.Abs(root)`. On error, return
   `Root{}, fmt.Errorf("safepath.NewRoot: %w", err)`.
3. `filepath.Clean` the absolute form (`Abs` already cleans on
   most platforms; apply it unconditionally for defense in depth).
4. Call `os.Stat` on the cleaned path. If it fails, wrap and
   return the error. If the returned `FileInfo.IsDir()` is false,
   return `fmt.Errorf("safepath.NewRoot: %s: not a directory",
   cleaned)`.
5. Construct the `Root` with `abs = cleaned` and
   `absWithSep = cleaned + string(os.PathSeparator)`.
6. Return the `Root`, nil error.

**Postconditions:**

- The returned `Root` has a non-empty absolute path that exists and
  is a directory at construction time. (It may cease to be so
  later — callers that care must handle `os.ErrNotExist` at the
  point of use.)

**Errors:**

| Condition | Sentinel | Message shape |
|---|---|---|
| Empty input | `ErrEmptyPath` | `"safepath: empty path"` |
| `filepath.Abs` fails | *(wrapped)* | `"safepath.NewRoot: %w"` |
| Stat fails | *(wrapped)* | `"safepath.NewRoot: %w"` |
| Not a directory | *(no sentinel)* | `"safepath.NewRoot: <path>: not a directory"` |

**Edge cases:**

- A symlink `root` pointing to a directory is accepted; it is
  `EvalSymlinks`-resolved lazily by `Resolve`, not here.
- A trailing separator (`/tmp/foo/`) is acceptable — `filepath.Clean`
  strips it.
- On Windows, a UNC path (`\\server\share\dir`) is accepted.

**Parity requirements:**

- The TS curator does not construct a Root type — it takes a raw
  `wikiRoot` string every call. The Go version centralizes the
  validation here once.

**Test requirements (unit):**

- `TestNewRoot_AcceptsExistingDir` — pass a temp dir, assert
  success and `String()` equality after `filepath.Abs`.
- `TestNewRoot_RejectsEmptyString` — asserts `errors.Is(err,
  ErrEmptyPath)`.
- `TestNewRoot_RejectsNonExistent` — asserts `errors.Is(err,
  fs.ErrNotExist)`.
- `TestNewRoot_RejectsFile` — create a regular file, pass it,
  assert "not a directory" error.
- `TestNewRoot_AcceptsSymlinkedDir` — make a symlink to a dir,
  `NewRoot` it, assert success.

**Test requirements (e2e):** none. Consumed only inside the binary.

### `Resolve`

**Signature:**

```go
func Resolve(r Root, userPath string) (Resolved, error)
```

**Preconditions:**

- `r` must have been returned by a successful `NewRoot` call. The
  zero value of `Root` is not a legal input; Resolve with a zero
  Root returns `ErrEmptyPath`.

**Behavior:**

1. **Early reject** — raw input checks, no allocation:
   1. `userPath == ""` → `ErrEmptyPath`.
   2. `r.abs == ""` → `ErrEmptyPath` (zero Root).
   3. `len(userPath) > 4096` → `ErrPathTooLong`. The constant is
      `MaxPathLength = 4096`.
   4. `!utf8.ValidString(userPath)` → `ErrNotUTF8`.
   5. `strings.ContainsRune(userPath, 0x00)` → `ErrNullByte`.
2. **Unicode normalize** — replace `userPath` with
   `norm.NFC.String(userPath)`. This defeats NFD attacks where
   a decomposed `..` sequence can pass a lexical check but
   recompose to a traversal sequence inside the filesystem.
3. **Absolute-path reject** —
   1. If `filepath.IsAbs(userPath)` → `ErrAbsolutePath`.
   2. If on any OS the input starts with `/` → `ErrAbsolutePath`
      (this is redundant with `IsAbs` on POSIX but catches POSIX
      paths supplied to a Windows binary).
   3. If the input matches `^[A-Za-z]:[\\/]` (Windows drive
      letter) → `ErrAbsolutePath`.
   4. If the input starts with `\\` (UNC) → `ErrAbsolutePath`.
4. **Backslash normalization (POSIX only)** — on `runtime.GOOS
   != "windows"`, reject inputs containing `\` with
   `ErrPathEscape`. On Windows, `filepath.Clean` handles them
   natively.
5. **Lexical clean** — compute
   `cleaned := filepath.Clean(filepath.FromSlash(userPath))`. If
   `cleaned == "." `→ `ErrRootItself`.
6. **`..` mid-path reject** — iterate
   `strings.Split(cleaned, string(os.PathSeparator))`. If any
   element equals `".."`, return `ErrPathEscape`. Note that this
   is a belt-and-suspenders check; step 8 would catch the same
   case via the prefix test, but we reject earlier so the error
   message is precise.
7. **Join** — compute
   `joined := filepath.Join(r.abs, cleaned)` followed by another
   `filepath.Clean`.
8. **Prefix containment** — require
   `joined == r.abs || strings.HasPrefix(joined, r.absWithSep)`.
   If neither, return `ErrOutsideRoot`.
9. **Root-itself reject** — if `joined == r.abs`, return
   `ErrRootItself`. The root is never a legal target for
   Resolve; callers that need the root should already have it.
10. **Symlink evaluation** — call
    `real, err := filepath.EvalSymlinks(joined)`.
    - If `os.IsNotExist(err)`, proceed with `real = joined`
      (the caller may be about to create the file; containment
      is still enforceable lexically).
    - If any other error, return it wrapped:
      `fmt.Errorf("safepath.Resolve: eval symlinks: %w", err)`.
    - If no error, re-run the prefix containment check on
      `real`. If `real` is outside `r.abs`, return
      `ErrPathEscape`.
11. **Build `Relative`** — strip `r.abs + sep` from `joined`
    (not `real`, so that creating new files works), then call
    `filepath.ToSlash` to force POSIX separators.
12. Return `Resolved{Absolute: joined, Relative: relative}`, nil.

**Postconditions:**

- `Resolved.Absolute` is an OS-native absolute path inside `r.abs`.
- `Resolved.Relative` contains only `[a-zA-Z0-9._/-]`-safe
  characters plus any UTF-8 that survived NFC normalization; it
  never starts with `/`, never contains `..`, and never contains
  backslashes.

**Errors:**

| Condition | Sentinel | Message shape |
|---|---|---|
| Empty `userPath` or zero `Root` | `ErrEmptyPath` | `"safepath: empty path"` |
| `len > 4096` | `ErrPathTooLong` | `"safepath: path exceeds maximum length: 4123"` |
| Invalid UTF-8 | `ErrNotUTF8` | `"safepath: path is not valid UTF-8"` |
| Contains NUL | `ErrNullByte` | `"safepath: path contains null byte"` |
| POSIX absolute, Windows drive letter, or UNC | `ErrAbsolutePath` | `"safepath: path must be relative: %q"` |
| Backslash on POSIX | `ErrPathEscape` | `"safepath: backslash separator on POSIX: %q"` |
| `..` segment | `ErrPathEscape` | `"safepath: path contains parent-directory segment: %q"` |
| Joined result escapes root | `ErrOutsideRoot` | `"safepath: %q escapes root %q"` |
| Resolves to root itself | `ErrRootItself` | `"safepath: path resolves to root: %q"` |
| Symlink target escapes root | `ErrPathEscape` | `"safepath: symlink target escapes root: %q → %q"` |
| `EvalSymlinks` returns unexpected error | *(wrapped)* | `"safepath.Resolve: eval symlinks: %w"` |

**Edge cases:**

- `userPath == "."` after cleaning → rejected with `ErrRootItself`.
- `userPath == "./foo"` — cleans to `"foo"`, accepted.
- `userPath == "foo/"` — cleans to `"foo"`, accepted.
- `userPath == "foo//bar"` — cleans to `"foo/bar"`, accepted.
- `userPath == "foo/./bar"` — cleans to `"foo/bar"`, accepted.
- `userPath == "foo/../bar"` — `..` is present mid-path; rejected
  with `ErrPathEscape` at step 6, even though step 7's join would
  also result in a path inside the root.
- `userPath` ending in `\x00foo` — rejected at step 1 with
  `ErrNullByte` before anything else runs.
- `userPath` that is a valid relative path to a file that does
  not yet exist — accepted (step 10 handles `os.IsNotExist`
  gracefully). This is the curator "write new wiki entry" flow.

**Parity requirements:**

- The Go version is strictly stricter than the TS
  `validateRelativePath` at `src/curator.ts:434-465`: every path
  that TS accepts, Go must also accept, except the handful of
  cases the TS version erroneously lets through (null bytes,
  non-UTF8, symlink escapes, NFD-decomposed traversal,
  overlong). For those, Go returns an error and the TS fixture
  is marked "bug in TS oracle, fixed in Go port" so the parity
  runner skips them.
- Fixture file:
  `testdata/fixtures/safepath/accepted_paths.json` —
  `{"input": "foo/bar.md", "absolute": "<platform-specific>",
  "relative": "foo/bar.md"}` entries.
- Fixture file:
  `testdata/fixtures/safepath/rejected_paths.json` — adversarial
  list below, each with expected sentinel.

### Adversarial input list

Every entry is a required Phase B fuzz test case. Column "Verdict"
is the sentinel error the spec mandates.

| # | Input | Verdict | Notes |
|---|---|---|---|
| 1 | `"../secret.md"` | `ErrPathEscape` | classic `..` traversal at the front |
| 2 | `"foo/../../bar.md"` | `ErrPathEscape` | `..` mid-path escaping two levels |
| 3 | `"foo/./bar.md"` | accepted | `.` segments are safe |
| 4 | `"./foo.md"` | accepted | leading `./` cleans to `foo.md` |
| 5 | `"/etc/passwd"` | `ErrAbsolutePath` | POSIX absolute |
| 6 | `"/tmp/foo.md"` | `ErrAbsolutePath` | POSIX absolute even inside /tmp |
| 7 | `"C:\\foo\\bar.md"` | `ErrAbsolutePath` | Windows drive letter |
| 8 | `"c:/foo.md"` | `ErrAbsolutePath` | lowercase drive letter |
| 9 | `"\\\\server\\share\\f.md"` | `ErrAbsolutePath` | Windows UNC |
| 10 | `"foo\\..\\bar.md"` (on POSIX) | `ErrPathEscape` | backslash separators not allowed on POSIX |
| 11 | `"foo/\x00.md"` | `ErrNullByte` | null-byte injection |
| 12 | `"\x00"` | `ErrNullByte` | pure null |
| 13 | `""` | `ErrEmptyPath` | empty string |
| 14 | `"."` | `ErrRootItself` | cleans to `.`, resolves to root |
| 15 | `strings.Repeat("a", 4097)` | `ErrPathTooLong` | overlong, 4097 bytes |
| 16 | `"foo/" + strings.Repeat("a", 4097) + ".md"` | `ErrPathTooLong` | overlong with directory |
| 17 | `"foo.md\xff"` | `ErrNotUTF8` | invalid UTF-8 tail byte |
| 18 | `"foo/\xc3\x28.md"` | `ErrNotUTF8` | invalid UTF-8 sequence mid-path |
| 19 | `"fo\u0301o.md"` (NFD `ó`) | accepted, `Relative` is NFC `"fóo.md"` | NFC normalization applied |
| 20 | NFD-decomposed `..` (`"\u002e\u002e/secret.md"`) | `ErrPathEscape` | NFC normalizes then step 6 catches it |
| 21 | symlink inside root pointing to `/etc/passwd` | `ErrPathEscape` | caught at step 10 |
| 22 | symlink inside root pointing to a sibling root | `ErrPathEscape` | caught at step 10 |
| 23 | symlink inside root pointing inside the same root | accepted | legitimate internal link |
| 24 | `"foo/bar.md"` where `foo` does not exist | accepted | creating new files is allowed |
| 25 | `"//foo.md"` | `ErrAbsolutePath` | POSIX double-slash absolute |
| 26 | `"..\\..\\..\\windows\\system32"` | `ErrPathEscape` on Windows; `ErrPathEscape` on POSIX (via backslash rule) | platform-differentiated |
| 27 | `"foo/bar/.."` | `ErrPathEscape` | trailing `..` mid-path |
| 28 | `"foo/bar/."` | accepted, cleans to `"foo/bar"` | trailing `.` is safe |
| 29 | `"\u202e../passwd"` (RTL override) | `ErrPathEscape` | NFC normalizes, `..` caught |
| 30 | `"foo/CON.md"` on Windows | accepted by `safepath`; Windows filesystem rejects at open time | safepath does not encode reserved names — document limitation |

**Test requirements (unit):**

- One `t.Run` per row above, driven from the fixture JSON so the
  row index matches between TS and Go oracles.
- `TestResolve_AcceptedSampleRelative` — build a small corpus,
  call `Resolve` with relative paths that exist, assert the
  returned `Resolved.Relative` is byte-identical across Linux,
  macOS, and Windows CI runners.
- `TestResolve_RejectsZeroRoot` — default-constructed `Root{}`
  with any input returns `ErrEmptyPath`.
- `TestResolve_SymlinkInsideRoot` — make a symlink inside the
  root pointing to another file inside the root, assert accepted.
- `TestResolve_SymlinkOutsideRoot` — make a symlink inside the
  root pointing to `/etc/hosts` (or a temp file outside root),
  assert `errors.Is(err, ErrPathEscape)`.
- `TestResolve_CreatesNewFile` — call with a non-existent
  `new.md`, assert accepted and `Absolute` is the expected join.

**Test requirements (e2e):**

- Curator end-to-end: `tools/call write_wiki_entry` with each
  adversarial row must fail with a structured MCP error whose
  `message` contains the sentinel text from the error table.
- Indexer end-to-end: `DOCS_ROOT` containing a symlink to an
  outside directory must be walked without traversing the
  symlink. Covered by `tests/e2e/indexer_symlink_test.go`.

### `MaxPathLength`

**Signature:**

```go
const MaxPathLength = 4096
```

**Notes:**

- Matches the Linux `PATH_MAX` convention. Windows has a higher
  limit (`\\?\` prefix up to 32767) but we adopt the conservative
  value for fixture parity.
- Exposed as a constant so tests can construct boundary inputs
  without duplicating the literal.

## Invariants

1. **No legal input produces a `Resolved` whose `Absolute` lies
   outside `Root.abs`.** This is the core safety property.
   Phase B includes a quickcheck-style property test that
   generates 10,000 random strings and asserts this.
2. **`Resolved.Relative` is a POSIX-slash, root-relative path.**
   Never starts with `/`, never contains `..`, never contains
   backslashes, never contains `\x00`.
3. **Error determinism.** For a given input and a given root,
   `Resolve` returns the same sentinel on every call. No
   time-based or PID-based randomness enters the path check.
4. **No writes.** `Resolve` never creates, modifies, or deletes
   a file or directory. It may read filesystem metadata via
   `EvalSymlinks`, nothing else.
5. **Platform independence of `Relative`.** A corpus indexed on
   Linux and a corpus indexed on Windows produce byte-identical
   `DocumentMeta.FilePath` values for the same tree, because
   `Resolved.Relative` always uses `/`.

## Concurrency

- `Root` is immutable after `NewRoot`.
- `Resolve` is a pure function over a `Root` value and a string —
  safe to call from any number of goroutines simultaneously.
- No package-level state other than sentinel `error` variables,
  which are read-only.
- The package must pass `go test -race ./internal/safepath/...`
  under a stress test that launches 64 goroutines each calling
  `Resolve` with randomized inputs for 100 ms.

## Fixture data

`testdata/fixtures/safepath/*.json` — emitted by
`scripts/dump-fixtures.ts`:

- `accepted_paths.json` — array of `{input, expected_absolute,
  expected_relative, platform_notes}` for paths both TS and Go
  must accept. Platform-dependent fields (absolute paths on
  Windows vs POSIX) are omitted from the JSON and re-derived in
  the test by joining against a temp root.
- `rejected_paths.json` — array of `{input, expected_error}`
  where `expected_error` is a string matching a sentinel name
  (`"ErrPathEscape"`, `"ErrAbsolutePath"`, etc.).
- `nfc_paths.json` — array of `{input_nfd, expected_nfc}` for
  the Unicode normalization cases.
- `symlink_scenarios.json` — describes how the Phase B test
  harness should construct temp filesystems with symlinks (list
  of `{name, target, expected_verdict}` entries).

The TS oracle is authoritative for rows 1-10 and 13-16 (paths
the current code actually rejects). For rows 11, 12, 17, 18, 19,
20, 29, and 30, the Go port is stricter than TS; those rows are
marked `oracle: go-only` in the fixture file and Phase B's
parity runner skips the TS comparison.
