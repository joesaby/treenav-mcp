# Error taxonomy

## Summary

A catalog of every sentinel error exported by every `internal/*`
package in the Go port, the rule for how new sentinels get added,
and the mapping from Go sentinels to the JSON-RPC error codes that
surface through the MCP transport. This doc is consulted when:

- A new package needs an error that callers might want to match.
- A tool handler needs to translate an internal error into an MCP
  error response.
- A test asserts that a specific condition produced a specific
  named failure.
- A user reports "I got error code -32004, what does that mean?"
  and we need to trace it back to the originating function.

The Go port follows one consistent pattern: every package exports
its error *values* as `var ErrXxx = errors.New("<pkg>: <msg>")`,
wraps them with `fmt.Errorf("...: %w", err)` when adding context,
and expects callers to match with `errors.Is`. No custom error
types with switch-on-type branches. No error strings concatenated
with `"+"`. No `panic` for recoverable failures.

## Go package

N/A — the sentinels live in their owning packages. This doc is the
index, not the implementation.

Packages that export sentinel errors in Phase C:

- `internal/safepath`
- `internal/curator`
- `internal/store`
- `internal/indexer`
- `internal/frontmatter`
- `internal/mcp`
- `internal/codeindex` *(lightweight — most parser errors are wrapped
  in `internal/indexer` or reported to stderr and skipped)*

## Public API (Go signatures) — N/A

See each owning package's feature doc for the exported signatures.
The tables in this doc enumerate only the sentinel `var`s and the
condition that produces each one.

## Key behaviors

### The pattern, in one paragraph

Every error that a caller might reasonably want to branch on is a
package-level `var` of type `error`, named `ErrXxx`, constructed
with `errors.New("<pkg>: <lowercase message>")`. Callers match it
with `errors.Is(err, pkg.ErrXxx)`. Internal code that wants to add
context wraps it with `fmt.Errorf("context: %w", err)` so the
`errors.Is` chain still finds the original sentinel. No error type
assertions. No custom struct errors unless a caller genuinely needs
structured fields (and none do in Phase C).

### The sentinel inventory

#### `internal/safepath`

| Sentinel | Condition |
|---|---|
| `ErrEmptyPath` | The input path string was empty. |
| `ErrNotUTF8` | The input path is not valid UTF-8. |
| `ErrNullByte` | The input path contains a `\x00` byte. |
| `ErrPathTooLong` | The input path exceeds the byte length cap. |
| `ErrAbsolutePath` | The input path was absolute (leading `/` or `C:\`). |
| `ErrPathEscape` | After cleaning, the path resolves outside the trusted root via `..` traversal. |
| `ErrOutsideRoot` | After `filepath.EvalSymlinks`, the real path escapes the root. |
| `ErrRootItself` | The input path resolves to exactly the root (no child segment). |

See `docs/spec/safepath.md` for the full adversarial list that
drives each of these.

#### `internal/frontmatter`

| Sentinel | Condition |
|---|---|
| `ErrYAMLParse` | The `---`-delimited block contained malformed YAML. |
| `ErrReservedKey` | A curator-supplied frontmatter block used a reserved key (`title`, `description`, `layout`, `permalink`, `slug`, `draft`, `date`, `source_url`, `source_title`, `captured_at`, `curator`) as a user-defined facet. |
| `ErrFrontmatterShape` | The frontmatter root was not a YAML mapping (e.g., a top-level sequence was provided). |

#### `internal/indexer`

| Sentinel | Condition |
|---|---|
| `ErrInvalidMarkdown` | A markdown file could not be parsed even after the regex fallback. |
| `ErrFrontmatterParse` | A wrapped `internal/frontmatter` error during document indexing (wraps the underlying sentinel with `%w`). |
| `ErrFileRead` | The file could not be opened or read — wraps the underlying `*os.PathError`. |

#### `internal/store`

| Sentinel | Condition |
|---|---|
| `ErrDocNotFound` | `GetTree`, `GetNodeContent`, `NavigateTree`, or `GetDocMeta` was called with an unknown `doc_id`. |
| `ErrNodeNotFound` | `GetNodeContent` or `NavigateTree` was called with an unknown `node_id` within a known document. |
| `ErrInvalidQuery` | `Search` received a query that tokenized to zero non-stopword terms. |
| `ErrGlossaryShape` | `LoadGlossary` received JSON that did not parse to `map[string][]string`. |

#### `internal/curator`

Replaces the TS `CuratorError` class at `src/curator.ts:116-130`,
which uses a string-valued `code` field. The Go port expands each
code into a sentinel:

| Sentinel | TS code | Condition |
|---|---|---|
| `ErrPathEscape` | `PATH_ESCAPE` | Input path escapes the wiki root. Wraps `safepath.ErrPathEscape`. |
| `ErrPathInvalid` | `PATH_INVALID` | Input path failed any non-escape validation (not `.md`, absolute, empty). Wraps `safepath.ErrAbsolutePath` or similar. |
| `ErrExists` | `EXISTS` | File already exists at the target path and `overwrite=false`. |
| `ErrFrontmatterInvalid` | `FRONTMATTER_INVALID` | Frontmatter failed shape / key / value validation. |
| `ErrDuplicate` | `DUPLICATE` | Content overlaps more than the configured threshold with an existing doc and `allow_duplicate=false`. |
| `ErrWriteFailed` | `WRITE_FAILED` | The disk write or re-index step failed. Wraps the underlying IO error. |

Note: the TS class also carries a free-form `message`. The Go port
preserves the human message through `fmt.Errorf("%w: %s", ErrXxx,
detail)` so logs and RPC responses still show the specific reason.

#### `internal/mcp`

| Sentinel | Condition |
|---|---|
| `ErrToolUnknown` | The transport asked to invoke a tool name that is not registered. |
| `ErrInvalidArgs` | Tool arguments failed shape validation (schema check or required-field check). |
| `ErrToolDisabled` | A curation tool was invoked while `WIKI_WRITE` is unset. |

### Wrapping discipline

- **Adding context:** always use `fmt.Errorf("doing X: %w", err)`.
  The `%w` verb (stdlib `fmt`) is the only way to preserve the
  sentinel chain for `errors.Is`.
- **Collapsing context:** never. If three layers add three
  `fmt.Errorf` wrappers, the final error shows all three lines when
  printed, and `errors.Is` still finds the sentinel at the root.
- **Logging vs. returning:** log at the MCP layer, return at every
  other layer. Internal packages must not write to stderr from
  inside the happy path; the server decides what the user sees.

### MCP JSON-RPC error-code mapping

When `internal/mcp` catches an error from a tool handler, it maps
the sentinel to a JSON-RPC error code and returns a standard MCP
error response. This is the stable user-visible API.

| Error | JSON-RPC code | MCP error name | Notes |
|---|---|---|---|
| `ErrToolUnknown` | `-32601` | `MethodNotFound` | Standard JSON-RPC method-not-found. |
| `ErrInvalidArgs` | `-32602` | `InvalidParams` | Shape or required-field failure. |
| `ErrToolDisabled` | `-32601` | `MethodNotFound` | Matches TS behavior: disabled tools are invisible, not "forbidden". |
| `curator.ErrPathEscape` | `-32000` | `PathEscape` | Custom server error; path containment breach. |
| `curator.ErrPathInvalid` | `-32001` | `PathInvalid` | Custom server error; non-escape path failure. |
| `curator.ErrExists` | `-32002` | `FileExists` | Pass `overwrite=true` to override. |
| `curator.ErrFrontmatterInvalid` | `-32003` | `FrontmatterInvalid` | Frontmatter shape or key failure. |
| `curator.ErrDuplicate` | `-32004` | `Duplicate` | Pass `allow_duplicate=true` to override. |
| `curator.ErrWriteFailed` | `-32005` | `WriteFailed` | Wraps the underlying IO error in the message. |
| `store.ErrDocNotFound` | `-32010` | `DocNotFound` | Unknown doc_id. |
| `store.ErrNodeNotFound` | `-32011` | `NodeNotFound` | Unknown node_id. |
| `store.ErrInvalidQuery` | `-32012` | `InvalidQuery` | Empty or stopword-only query. |
| *unmatched* | `-32603` | `InternalError` | Any error that does not match a known sentinel. Logged with the full `%+v` chain to stderr. |

The custom codes in `-32000..-32099` are in the JSON-RPC
server-defined range. They are stable — **changing one is a
breaking change to the user-facing MCP contract and requires an
ADR and a `feat!:` commit**.

## Dependencies

- **stdlib only:** `errors`, `fmt`. Every package uses these; no
  error-handling third-party library is pulled in.

## Relationship to TS source

- Replaces the `CuratorError` class at `src/curator.ts:116-130`
  with six sentinel `var`s in `internal/curator`. The TS `code`
  string becomes the sentinel name; the TS `message` becomes the
  wrapped detail.
- Replaces ad-hoc `throw new Error("...")` calls scattered across
  `src/indexer.ts`, `src/store.ts`, and `src/server.ts` with named
  sentinels. Each ad-hoc throw is reviewed and categorized into
  one of the existing sentinels or gets a new one added to this
  doc first.
- The TS MCP SDK returns errors as string-valued
  `isError: true` payloads inside the tool result. The Go `mcp-go`
  equivalent uses structured JSON-RPC error objects. The code map
  above is the translation layer.

## Non-goals

- **Error stack traces.** Go's `errors.Is` chain gives enough
  context for debugging; `github.com/pkg/errors`-style stack
  capture is not worth the allocation cost or the dependency.
- **Custom struct error types.** If a caller genuinely needs a
  structured error (e.g., "which field failed validation"), it can
  be added later as an opaque type that implements `Unwrap` so
  `errors.Is` still works. None of the Phase C callers need this.
- **Error aggregation across packages.** If multiple errors happen
  in one logical operation (e.g., the indexer fails on three files
  out of 200), the caller decides whether to join them with
  `errors.Join`. The library does not pre-aggregate.
- **Internationalized error messages.** Messages are English-only,
  lowercase, no trailing punctuation. The canonical form is the
  sentinel name; the message is debugging text.
- **Retry annotations.** No sentinel is marked "retryable" or
  "permanent" at the type level. Callers that need retry semantics
  decide per site. (In practice, the only retryable condition in
  Phase C is `ErrWriteFailed` on a transient filesystem error, and
  the curator does not retry; it reports and lets the user re-run.)
