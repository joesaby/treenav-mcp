# Safepath

## Summary

Enforces the filesystem security boundary: "is this user-supplied path
actually inside the root I said it is?" Every component that touches
disk — the indexer, the curator write path, the debug CLI — routes
its user-supplied paths through `safepath.Resolve` before opening a
file or walking a directory. This package is deliberately small,
deliberately paranoid, and deliberately the single reviewable place
where path containment lives.

## Go package

`internal/safepath` — path containment and normalization for any input
that will be joined with a trusted root.

Exports:

- `Root` — an opaque handle to a trusted root directory plus its
  lexically-resolved absolute form. Constructed once per collection
  / wiki root.
- `Resolved` — the successful result of a containment check: the
  absolute path inside the root and the POSIX-slash relative path
  that can safely be used as a lookup key.
- `NewRoot` — validate a trusted root and return a `Root`.
- `Resolve` — given a `Root` and a user-supplied relative path,
  return a `Resolved` or a sentinel error describing why it was
  rejected.
- `ErrPathEscape`, `ErrAbsolutePath`, `ErrNullByte`, `ErrEmptyPath`,
  `ErrPathTooLong`, `ErrRootItself`, `ErrOutsideRoot`,
  `ErrNotUTF8` — sentinel errors that callers match with
  `errors.Is`.

## Public API (Go signatures)

```go
package safepath

import (
    "errors"
)

// Root is a validated trusted directory. Construct once per
// collection root (or wiki root) and reuse for every Resolve call.
// Zero value is unusable — use NewRoot.
type Root struct {
    // unexported; holds the lexically-cleaned absolute path.
}

// Resolved is the successful output of Resolve: both the absolute
// on-disk path and the canonical POSIX-slash relative form suitable
// for use as a map key or a DocumentMeta.FilePath.
type Resolved struct {
    Absolute string // filepath.Clean'd absolute path, OS-native separators
    Relative string // POSIX slashes, no leading "./"
}

// NewRoot validates that root is non-empty, absolute (after
// filepath.Abs), and exists as a directory. Returns a Root handle
// or an error.
func NewRoot(root string) (Root, error)

// String returns the absolute path of the root for logging. Never
// use this for containment checks.
func (r Root) String() string

// Resolve takes a user-supplied path (intended to be relative to r)
// and returns the Resolved form if and only if the path stays
// inside r under every known attack vector. See
// docs/spec/safepath.md for the full adversarial list.
func Resolve(r Root, userPath string) (Resolved, error)

// Sentinel errors — callers match with errors.Is.
var (
    ErrEmptyPath    = errors.New("safepath: empty path")
    ErrNotUTF8      = errors.New("safepath: path is not valid UTF-8")
    ErrNullByte     = errors.New("safepath: path contains null byte")
    ErrPathTooLong  = errors.New("safepath: path exceeds maximum length")
    ErrAbsolutePath = errors.New("safepath: path must be relative")
    ErrPathEscape   = errors.New("safepath: path escapes root via traversal")
    ErrOutsideRoot  = errors.New("safepath: resolved path is outside root")
    ErrRootItself   = errors.New("safepath: path resolves to the root itself")
)
```

## Key behaviors

- `NewRoot` rejects a non-existent path, a file (non-directory),
  and an empty or relative input. It calls `filepath.Abs` once,
  stores the result, and never re-reads the filesystem for that
  Root again.
- `Resolve` is defense-in-depth: every input is checked against the
  adversarial list before any `filepath.Join` call, and the joined
  result is re-validated with a prefix check against the root.
- The returned `Resolved.Relative` is always lowercase-normalized
  for the path separator — forward slashes on every OS — so that
  downstream consumers like `DocumentMeta.FilePath` are portable
  between Linux, macOS and Windows.
- Symlink escape is detected by calling `filepath.EvalSymlinks`
  after the lexical check and re-running the prefix test on the
  real path. A symlink target outside the root is rejected with
  `ErrPathEscape`.
- Unicode paths are NFC-normalized before comparison so that NFD
  attacks (e.g., an NFD-encoded `..` cannot slip past an NFC-only
  check) are rejected or canonicalized.
- The package has zero goroutines, zero global state beyond the
  sentinel error variables, and is safe for concurrent use by any
  number of callers.

## Dependencies

- **stdlib:** `errors`, `fmt`, `os`, `path/filepath`, `strings`,
  `unicode/utf8`.
- **third-party:** `golang.org/x/text/unicode/norm` — for NFC
  normalization of the input path before lexical checks.
- **internal:** none. This package must not import any other
  `internal/*` package, to keep the security boundary free of
  circular review scope.

## Relationship to TS source

- Replaces the `validateRelativePath` function at
  `src/curator.ts:434-465`. That function is inlined into the
  curator today; the port pulls it out so it can be fuzzed in
  isolation and reused by the indexer and debug CLI.
- Extends the TS version with checks the TS version does not
  perform: null-byte rejection, UTF-8 validation, length limits,
  NFC normalization, symlink evaluation. The TS implementation
  relies on Node's `path.resolve` for most of its guarantees, which
  is adequate on POSIX but does not cover the extended list in
  `spec/safepath.md`.
- The TS version's error messages are free-form strings; the Go
  version returns sentinel errors wrapped with `fmt.Errorf("%w:
  %s", ErrXxx, detail)` so tests can assert on the sentinel with
  `errors.Is`.

## Non-goals

- This package does not open or read files. It only decides
  whether a path is safe to hand to `os.Open`.
- It does not perform ACL or permission checks. "Is the user
  allowed to read this" is an OS-level concern handled at the
  point of use.
- It does not attempt to detect TOCTOU races. Callers that need
  a stronger guarantee must open the file via
  `os.OpenFile(Resolved.Absolute, O_NOFOLLOW, ...)` themselves.
- It does not cache resolutions. Every call re-validates; the
  cost is a handful of `strings` operations plus at most one
  `EvalSymlinks`.
- It does not expose a path-joining API beyond `Resolve`. Callers
  must not build paths "safely" with `filepath.Join` on their
  own; they route every input through this package.
