# Debug CLI

## Summary

The debug CLI is a zero-dependency inspection tool for the indexer. It
runs the same indexing pipeline the MCP server runs at startup, then
dumps a human-readable summary to stdout so a developer can verify that
a corpus is being tokenized, tree-walked, and faceted the way they
expect *before* wiring it into Claude Desktop. It is not an MCP
component — nothing about it speaks JSON-RPC — but it is a user-facing
surface of the binary, which is why it's in the MCP group's scope.

In the TypeScript version this is a separate entry point:
`bun run src/cli-index.ts [--root PATH] [--tree DOC_ID] [--search QUERY]`.
Because Go ships a single binary, that becomes a subcommand of the main
binary instead: `treenav-mcp index [--root PATH] [--tree DOC_ID] [--search QUERY]`.
Subcommand routing uses the stdlib `flag` package (see the spec for the
rationale). No `cobra`, no external CLI frameworks.

The subcommand is deliberately boring: indexing + a pretty-printer, no
REPL, no editing, no writing. It is a diagnostic tool, and its output
format can change between versions without a compatibility story.

## Go package (`cmd/treenav-mcp`)

Lives in the same `cmd/treenav-mcp` package as the stdio and HTTP
entry points. One file: `cmd/treenav-mcp/index_cmd.go`.

Exports (within `package main`):

- `runIndexCLI(args []string) int` — the subcommand entry point.
  Returns a process exit code. Called from `main()` when `os.Args[1] == "index"`.
- `indexCmdFlags` — unexported `*flag.FlagSet` constructed on each
  invocation (one per subcommand is idiomatic Go).
- Formatter helpers for the pretty-printed output.

## Public API (Go signatures)

```go
package main

import (
    "context"
    "flag"
    "io"
)

// runIndexCLI runs the "treenav-mcp index" subcommand. It parses the
// subcommand-specific flags from args (which does NOT include the
// leading "index" verb), runs the shared indexing pipeline, and
// writes a human-readable report to stdout. Logs go to stderr. The
// returned int is the process exit code.
//
// Flags:
//   --root PATH      root directory to index (overrides DOCS_ROOT)
//   --tree DOC_ID    after indexing, print the heading tree of DOC_ID
//   --search QUERY   after indexing, run QUERY through the BM25 engine
//   --code PATH      optional code root (overrides CODE_ROOT)
//   --limit N        max rows to print (default 10)
//   --stdout WRITER  test-hook; unexported in production
func runIndexCLI(ctx context.Context, args []string, stdout, stderr io.Writer) int

// indexReport is the struct rendered to stdout. It exists so tests
// can compare structured output rather than scraping strings.
type indexReport struct {
    Root         string
    DocumentCount int
    TotalNodes    int
    TotalWords    int
    IndexedTerms  int
    Elapsed       string
    Sample        []sampleDoc
    Tree          *treeReport
    Search        *searchReport
}

type sampleDoc struct {
    DocID        string
    Title        string
    FilePath     string
    HeadingCount int
    WordCount    int
}

type treeReport struct {
    DocID string
    Nodes []treeRow
}

type treeRow struct {
    NodeID    string
    Level     int
    Title     string
    WordCount int
    Summary   string
}

type searchReport struct {
    Query string
    Rows  []searchRow
}

type searchRow struct {
    Score    float64
    DocID    string
    NodeTitle string
    Snippet  string
}

// writeReport renders an indexReport to the given writer in the
// same emoji-flavoured plain-text format the TS version uses.
func writeReport(w io.Writer, r indexReport) error
```

## Key behaviors

- **Top-level dispatch by verb.** `main()` inspects `os.Args[1]`:
  - `""` or unknown → stdio MCP server (default path).
  - `"serve"` → stdio MCP server (explicit form).
  - `"serve-http"` or `"--http"` → HTTP MCP server.
  - `"index"` → `runIndexCLI(ctx, os.Args[2:], os.Stdout, os.Stderr)`.
  - `"-h"` / `"--help"` / `"help"` → print top-level usage.
  - `"version"` → print the build-time version string.

- **Flag parsing uses stdlib `flag`.** A fresh `flag.NewFlagSet` is
  created per subcommand. Unknown flags produce a usage line and
  exit(2) via `flag.ExitOnError`. No `cobra`, no `urfave/cli`. The
  justification is in the spec — we have four subcommands total and
  no need for bash completion, nested commands, or plugin registries.

- **Indexing pipeline is shared with the server.** `runIndexCLI` calls
  the same `buildStore(ctx, env)` helper that `serveStdio` uses, so
  there is exactly one place that runs the indexer and loads the
  glossary. A bug in indexing gets caught by the CLI first because
  the CLI prints the document count.

- **Output format** is the emoji-flavoured plain-text the TS version
  uses. Parity is cosmetic, not byte-exact — the Go version is
  allowed to differ in incidental whitespace as long as the
  structured `indexReport` matches.

- **Three diagnostic modes**, mirroring the TS flags:
  - No flags → print overall stats + sample of the first 10 docs.
  - `--tree DOC_ID` → after stats, walk the heading tree of `DOC_ID`
    and print it indented. Unknown doc_id prints the first 20
    available IDs as a hint.
  - `--search QUERY` → after stats, run `store.SearchDocuments` with
    the default ranking and print the top 10 results with snippets.
  - `--tree` and `--search` may be combined; stats come first, then
    tree, then search.

- **Exits non-zero on indexing failure.** If `indexer.IndexAllCollections`
  returns an error, the CLI prints `error: <msg>` to stderr and exits
  with status 1. If a `--tree` or `--search` action produces no
  rows, that is not an error; it is printed as an empty-result
  message and the process exits 0.

- **No side effects on disk.** The CLI never writes. The curator write
  path and any future mutation commands are separate verbs; `index`
  is purely read-only.

## Dependencies

- **stdlib:**
  - `flag` — subcommand flag parsing.
  - `context` — cancellation from `main`.
  - `fmt` — pretty-printed output.
  - `io` — writer abstraction for testability.
  - `os` — `os.Args`, `os.Stdout`, `os.Stderr`, exit codes.
  - `time` — the elapsed-time measurement.
- **third-party:** none. (No cobra, no viper.)
- **internal:**
  - `internal/indexer` — `IndexAllCollections` for the shared
    indexing pipeline.
  - `internal/store` — `DocumentStore.Load`, `ListDocuments`,
    `GetTree`, `SearchDocuments`, `GetStats`.
  - `internal/types` — `IndexConfig`, `SearchResult`, `OutlineNode`,
    `DocumentMeta`.

## Relationship to TS source

Direct port of `src/cli-index.ts` (102 lines). The TS `getArg` helper
at line 19 is replaced with `flag.String`. The three
`if (treeDocId)` / `if (query)` blocks become discrete helper
functions (`printTree`, `printSearch`) that take an `indexReport`
and write to the output writer. The `Bun.argv.slice(2)` pattern is
replaced by `flag.NewFlagSet` parsing.

The binary entrypoint `bin.ts` — which is two lines that shell out to
`src/server.ts` — goes away entirely. `go build` produces
`cmd/treenav-mcp` directly.

## Non-goals

- **No REPL.** The TS version is not interactive and neither is the
  Go port.
- **No JSON output mode.** The CLI's output is for humans. Programmatic
  consumers should use the MCP tools instead — that is what they exist
  for.
- **No watch mode.** One shot, one report, exit. `--watch` is future
  work behind a separate ADR if it ever happens.
- **No index dumping.** A full dump of the inverted index is a fixture
  operation, not a debug operation. It lives in `scripts/dump-fixtures.ts`
  (TS side) for Phase B parity harnesses, not here.
- **No subcommand framework.** Adding `cobra` would pull in its
  transitive deps (~15 packages) to replace ~40 lines of `flag` code.
  Rejected.
