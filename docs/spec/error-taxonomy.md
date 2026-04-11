# Spec: Error taxonomy

**Feature doc:** [../features/error-taxonomy.md](../features/error-taxonomy.md)
**TS source:** `src/curator.ts` (CuratorError class), `src/indexer.ts`, `src/store.ts`, `src/server.ts`
**Go package:** cross-cutting (binding on every `internal/*` package that exports an error)

## Scope

This spec is the contract for how errors are declared, wrapped,
matched, and surfaced. It binds:

1. Every package that exports an error sentinel.
2. Every caller that matches an error with `errors.Is`.
3. The MCP layer that translates internal sentinels into JSON-RPC
   error codes.
4. The CI check that enforces "no new sentinels without a row in
   this spec" (implemented as a `go vet`-style linter pass in
   Phase B).

It does **not** govern how errors are formatted in log messages,
whether to include a stack trace, or how to present errors to
end users outside the MCP protocol.

## Rules

### R1. Every sentinel is a package-level `var`

```go
package safepath

import "errors"

var ErrPathEscape = errors.New("safepath: path escapes root via traversal")
```

- The name is `ErrXxx`, PascalCase, exported.
- The value is `errors.New` with a message of the form
  `"<pkgname>: <lowercase message>"`.
- The `var` is declared at package scope, not inside `init()`.
- No sentinel is constructed with `fmt.Errorf` at declaration
  (that produces a unique error on each evaluation, defeating
  identity comparison).

### R2. Wrapping uses `%w`

When a function wants to add context to a sentinel it owns or
re-raises a sentinel from another package:

```go
return fmt.Errorf("reading %s: %w", path, ErrFileRead)
```

or

```go
return fmt.Errorf("%w: %s", curator.ErrPathEscape, detail)
```

- Use `%w` exactly once per `fmt.Errorf` call.
- The wrapped error must be a sentinel or another wrapped
  sentinel, never a bare string.
- The context before `%w` is human-readable and lowercase, no
  trailing punctuation.

### R3. Matching uses `errors.Is`

Callers that care about a specific failure mode use `errors.Is`:

```go
if errors.Is(err, store.ErrDocNotFound) { ... }
```

- `errors.As` is used only when the error carries structured
  fields (which no Phase C error does).
- `switch err := err.(type)` is forbidden — it breaks wrapping
  chains and regresses to the pre-1.13 model.
- String comparison on `err.Error()` is forbidden in non-test
  code.

### R4. Error declaration lives at the top of the file

A package that exports sentinels declares them all in one block at
the top of a single file, by convention `errors.go`:

```go
// Package errors.go for internal/curator.
package curator

import "errors"

var (
    ErrPathEscape         = errors.New("curator: path escapes wiki root")
    ErrPathInvalid        = errors.New("curator: path is invalid")
    ErrExists             = errors.New("curator: file already exists")
    ErrFrontmatterInvalid = errors.New("curator: frontmatter is invalid")
    ErrDuplicate          = errors.New("curator: content duplicates existing document")
    ErrWriteFailed        = errors.New("curator: write to disk failed")
)
```

This keeps the sentinel surface reviewable in one place per
package.

### R5. Every sentinel has a row in this spec

Adding a new `ErrXxx` in any `internal/*` package is a two-step
commit: first update the table below, then add the code. A CI
check enforces that every exported `var Err*` in `internal/*` has
a matching row in this file. A mismatch fails the build.

### R6. Sentinels do not format arguments

A sentinel never embeds runtime data in its message. Data goes in
the wrapping `fmt.Errorf`. Bad:

```go
// BAD
return fmt.Errorf("safepath: path %q escapes root", p)
```

Good:

```go
// GOOD
return fmt.Errorf("%w: %q", ErrPathEscape, p)
```

The caller can still recover the path from the wrapped message
via `err.Error()` for logging, and `errors.Is(err, ErrPathEscape)`
still succeeds.

### R7. MCP mapping is exhaustive-by-default

`internal/mcp.translateError` takes an `error` and returns a
JSON-RPC error code and a human message. It must:

1. Match known sentinels via `errors.Is`, in priority order
   (most-specific first).
2. Fall through to `-32603 InternalError` for any unmatched
   error, after logging the full `%+v` to stderr so the developer
   can see what slipped through.
3. Never panic.

### R8. Logging happens at the transport boundary

Internal packages return errors; they do not log them. Only
`internal/mcp` and `cmd/treenav-mcp` write to stderr about errors.
This keeps tests quiet and gives one place to control verbosity.

### R9. Sentinels are stable API

Removing or renaming an existing sentinel is a breaking change to
the Go library API and a breaking change to the MCP error-code
contract. It requires an ADR and a `feat!:` commit. Adding a new
sentinel is a minor change (`feat:`).

## Types

The Go port does not define a custom error type. Sentinels are
plain `error` values:

```go
type error interface {
    Error() string
}
```

All sentinels satisfy this interface via `errors.New`. All
wrapped errors satisfy it via `fmt.Errorf("%w", ...)`, whose
implementation is the stdlib `*fmt.wrapError` (unexported detail).

## Functions

### `internal/mcp.translateError`

```go
// translateError converts an internal error into a JSON-RPC error
// code and a user-visible message. The returned code is one of
// the values documented in docs/features/error-taxonomy.md.
//
// Precondition: err != nil. translateError(nil) panics.
func translateError(err error) (code int, message string)
```

Implementation rule: one `errors.Is` per row in the mapping table,
in the order shown, stopping at the first match. The default
branch returns `-32603`.

## Invariants

1. **I1 — Identity preservation.** For every sentinel `ErrXxx` and
   every wrapping chain `err`, `errors.Is(err, ErrXxx)` returns
   `true` iff `ErrXxx` appears in `err`'s `Unwrap` chain.
2. **I2 — No duplicate names.** No two packages export an `Err*`
   with the same unqualified name. `safepath.ErrPathEscape` and
   `curator.ErrPathEscape` are different symbols that may wrap
   each other; neither is imported under the bare name `ErrPathEscape`.
3. **I3 — Catalog completeness.** Every `var Err*` exported from
   `internal/*` has a row in
   `docs/features/error-taxonomy.md`.
4. **I4 — Code-map exhaustiveness.** Every sentinel that can reach
   the MCP transport layer has a row in the JSON-RPC error-code
   mapping table.
5. **I5 — No panic on error.** Every function that returns
   `error` does so by returning the value; panics are reserved
   for programmer errors (nil pointer, assertion failure) and do
   not use the sentinel taxonomy at all.

## Concurrency

Sentinels are package-level `var`s of interface type. They are
read-only after init; no goroutine writes to them; no lock is
needed. They are safe to compare with `errors.Is` from any number
of concurrent goroutines.

Wrapping with `fmt.Errorf` allocates a new `*fmt.wrapError`; the
stdlib guarantees the allocation is race-free.

## Fixture data

N/A — error behavior is not fixture-driven. The error taxonomy
is verified by a unit test in each package (`errors_test.go`)
that:

1. Imports each `ErrXxx`.
2. Wraps it once with `fmt.Errorf("ctx: %w", ErrXxx)`.
3. Asserts `errors.Is(wrapped, ErrXxx) == true`.
4. Asserts the unwrapped message starts with the package prefix.

The MCP mapping is verified by
`internal/mcp/translate_error_test.go`, which iterates the table
above and asserts each sentinel produces the expected code.

## Complete sentinel table (normative)

This table is the canonical list. CI fails if any exported
`Err*` in `internal/*` is not here.

| Package | Sentinel | Message | JSON-RPC code |
|---|---|---|---|
| `internal/safepath` | `ErrEmptyPath` | `safepath: empty path` | wrapped by curator |
| `internal/safepath` | `ErrNotUTF8` | `safepath: path is not valid UTF-8` | wrapped by curator |
| `internal/safepath` | `ErrNullByte` | `safepath: path contains null byte` | wrapped by curator |
| `internal/safepath` | `ErrPathTooLong` | `safepath: path exceeds maximum length` | wrapped by curator |
| `internal/safepath` | `ErrAbsolutePath` | `safepath: path must be relative` | wrapped by curator |
| `internal/safepath` | `ErrPathEscape` | `safepath: path escapes root via traversal` | wrapped by curator |
| `internal/safepath` | `ErrOutsideRoot` | `safepath: resolved path is outside root` | wrapped by curator |
| `internal/safepath` | `ErrRootItself` | `safepath: path resolves to the root itself` | wrapped by curator |
| `internal/frontmatter` | `ErrYAMLParse` | `frontmatter: yaml parse failed` | wrapped by curator / indexer |
| `internal/frontmatter` | `ErrReservedKey` | `frontmatter: reserved key used as facet` | `-32003` |
| `internal/frontmatter` | `ErrFrontmatterShape` | `frontmatter: root is not a mapping` | `-32003` |
| `internal/indexer` | `ErrInvalidMarkdown` | `indexer: markdown parse failed` | `-32603` |
| `internal/indexer` | `ErrFrontmatterParse` | `indexer: frontmatter parse failed` | `-32003` |
| `internal/indexer` | `ErrFileRead` | `indexer: file read failed` | `-32603` |
| `internal/store` | `ErrDocNotFound` | `store: document not found` | `-32010` |
| `internal/store` | `ErrNodeNotFound` | `store: node not found` | `-32011` |
| `internal/store` | `ErrInvalidQuery` | `store: query has no indexable terms` | `-32012` |
| `internal/store` | `ErrGlossaryShape` | `store: glossary json has wrong shape` | `-32603` |
| `internal/curator` | `ErrPathEscape` | `curator: path escapes wiki root` | `-32000` |
| `internal/curator` | `ErrPathInvalid` | `curator: path is invalid` | `-32001` |
| `internal/curator` | `ErrExists` | `curator: file already exists` | `-32002` |
| `internal/curator` | `ErrFrontmatterInvalid` | `curator: frontmatter is invalid` | `-32003` |
| `internal/curator` | `ErrDuplicate` | `curator: content duplicates existing document` | `-32004` |
| `internal/curator` | `ErrWriteFailed` | `curator: write to disk failed` | `-32005` |
| `internal/mcp` | `ErrToolUnknown` | `mcp: tool not registered` | `-32601` |
| `internal/mcp` | `ErrInvalidArgs` | `mcp: invalid tool arguments` | `-32602` |
| `internal/mcp` | `ErrToolDisabled` | `mcp: tool disabled by configuration` | `-32601` |
