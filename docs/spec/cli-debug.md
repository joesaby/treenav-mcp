# Spec: Debug CLI

**Feature doc:** [../features/cli-debug.md](../features/cli-debug.md)
**TS source:** `src/cli-index.ts`
**Go package:** `cmd/treenav-mcp`

## Scope

This spec governs the `treenav-mcp index` subcommand: top-level verb
dispatch, flag parsing, the three diagnostic modes (stats-only, tree
inspection, search), and output formatting. It also justifies the
choice of `flag` over `cobra`.

It does NOT govern indexing behavior — that is in
`docs/spec/markdown-indexer.md` and `docs/spec/code-indexer.md`. The
CLI is a thin wrapper around `buildStore` (defined in
`docs/spec/mcp-server.md`) and a set of pretty-printers.

Phase B covers this spec via:

- A table test per diagnostic mode with a tiny corpus in `testdata/cli/`.
- A top-level dispatch test that invokes the binary with each verb
  and asserts the correct entry point runs.
- A flag parsing test with valid, invalid, and unknown-flag inputs.

## Types

```go
package main

import (
    "context"
    "io"
)

type indexReport struct {
    Root          string
    DocumentCount int
    TotalNodes    int
    TotalWords    int
    IndexedTerms  int
    Elapsed       string // e.g. "1.2s"
    Sample        []sampleDoc
    Tree          *treeReport   // non-nil when --tree is set
    Search        *searchReport // non-nil when --search is set
}

type sampleDoc struct {
    DocID        string
    Title        string
    FilePath     string
    HeadingCount int
    WordCount    int
}

type treeReport struct {
    DocID    string
    Rows     []treeRow // empty when doc not found
    Missing  bool      // true when DocID did not resolve
    Hints    []string  // alternate doc IDs when Missing
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
    Score     float64
    DocID     string
    NodeTitle string
    Snippet   string
}

func runIndexCLI(ctx context.Context, args []string, stdout, stderr io.Writer) int
func writeReport(w io.Writer, r indexReport) error
```

## Functions

### main (verb dispatch)

**Signature:** `func main()`

**Preconditions:** called by the Go runtime. `os.Args` holds the
command line, `os.Stdin/Stdout/Stderr` are wired.

**Behavior:**

1. Install a `signal.NotifyContext(context.Background(),
   syscall.SIGINT, syscall.SIGTERM)` and defer the stop.
2. Inspect `os.Args[1]`:
   - `""` (no verb), `"serve"` → `serveStdio(ctx, parseEnv())`.
   - `"serve-http"`, `"--http"` → `serveHTTP(ctx, parseEnv())`.
   - `"index"` → `runIndexCLI(ctx, os.Args[2:], os.Stdout, os.Stderr)`.
   - `"version"` → print `Version` to stdout, exit 0.
   - `"help"`, `"-h"`, `"--help"` → print top-level usage, exit 0.
   - Anything else → print `unknown command: <verb>` to stderr plus
     top-level usage, exit 2.
3. The return value of each subcommand is used as the process exit
   code.

**Postconditions:** process exits with the subcommand's exit code.

**Errors:** the dispatcher itself never returns an error; it always
calls `os.Exit`.

**Edge cases:**

- `os.Args` is unusual (length 0, length 1) → both are treated as
  "no verb" and fall through to `serveStdio`. This preserves
  Claude Desktop's zero-config launch path.
- Signal during dispatch → ctx is cancelled, subcommands observe it
  and return a non-zero exit code.

**Parity requirements:** the default path (no verb) MUST run the
stdio server with no additional output on stdout; anything else
breaks Claude Desktop.

**Test requirements unit:** table test per verb, capturing the
expected entry-point invocation via an injected dispatcher.

**Test requirements e2e:** subprocess test invoking each verb and
asserting basic success / failure.

### runIndexCLI

**Signature:** `func runIndexCLI(ctx context.Context, args []string, stdout, stderr io.Writer) int`

**Preconditions:** `args` does NOT include the leading `"index"`
verb. `stdout` and `stderr` are writable.

**Behavior:**

1. Build a `flag.NewFlagSet("index", flag.ContinueOnError)` with:
   - `--root string` (default: `DOCS_ROOT` env var or `./docs`)
   - `--tree string` (optional doc ID)
   - `--search string` (optional query)
   - `--code string` (optional CODE_ROOT override)
   - `--limit int` (default 10)
2. Parse `args`. Parse error → write usage to stderr, return 2.
3. Build an `EnvConfig` via `parseEnv()` and override `DocsRoot`,
   `CodeRoot` from the flags when set.
4. Record `start := time.Now()`.
5. Call `buildStore(ctx, env)`. Error → write `error: <msg>` to
   stderr, return 1.
6. Call `store.GetStats()` and populate `report.DocumentCount`,
   `TotalNodes`, `TotalWords`, `IndexedTerms`, `Elapsed`.
7. Populate `report.Sample` with the first 10 entries from
   `store.ListDocuments({Limit: 10})` — but only when both `--tree`
   and `--search` are empty. When either is set, the sample section
   is skipped and `report.Sample` stays nil.
8. If `--tree` is set, call `store.GetTree(docID)`:
   - On success, populate `report.Tree.Rows` with every outline
     node's `(NodeID, Level, Title, WordCount, Summary)`.
   - On missing, set `report.Tree.Missing = true` and populate
     `report.Tree.Hints` from `store.ListDocuments({Limit: 20})`.
9. If `--search` is set, call `store.SearchDocuments(query,
   SearchOptions{Limit: flag.limit})` and populate
   `report.Search.Rows`.
10. Call `writeReport(stdout, report)`.
11. Return 0.

**Postconditions:** stdout contains the formatted report; stderr
contains only warnings (if any); the process returns 0 on success.

**Errors:**

- Flag parse error → return 2 (convention).
- `buildStore` error → return 1, error written to stderr.
- Any write error on stdout → return 1.

**Edge cases:**

- Corpus is empty → stats show zero, sample is empty list, no error.
- `--tree DOC_ID` with unknown ID → stats are still printed; the
  tree section shows a missing message and lists alternates.
- `--search ""` after `--search` is parsed as flag value of empty
  string → no search run, no search section in report.
- `--search "query"` with zero results → search section prints
  `  No results found.`
- Both `--tree` and `--search` set → stats + tree + search printed
  in that order. Sample section is skipped.
- `--limit 0` → clamped to 1 (guard against divide-by-zero later).

**Parity requirements:**

- The emoji-decorated text format (`📁`, `📊`, `🌳`, `🔍`, `📋`) from
  `src/cli-index.ts` is preserved. Cosmetic whitespace may differ;
  the underlying report struct must match.
- Exit code semantics match: 0 success, 1 runtime error, 2 usage error.

**Test requirements unit:**

- Parse test for each flag combination.
- Stats-only mode against a two-document corpus.
- `--tree` mode with a known doc.
- `--tree` mode with a missing doc → hints populated.
- `--search` mode with hits and with no hits.
- Both `--tree` and `--search` combined.

**Test requirements e2e:**

- Subprocess test: `treenav-mcp index --root testdata/corpus` exits
  0 with stats output.
- Subprocess test: `treenav-mcp index --tree nonexistent` exits 0
  with the missing-doc hint section.
- Subprocess test: `treenav-mcp index --search "needle"` exits 0
  with search results.

### writeReport

**Signature:** `func writeReport(w io.Writer, r indexReport) error`

**Preconditions:** `r.Root` and the stats fields are populated.
Optional sections are nil-checked before rendering.

**Behavior:**

1. Write `\n📁 Indexing: <r.Root>\n\n` (or ASCII-equivalent on
   Windows, see edge cases).
2. Write `\n📊 Index Stats:\n` followed by four indented lines:
   `Documents: <N>`, `Total nodes: <N>`, `Total words: <N with
   thousands separator>`, `Indexed terms: <N with thousands separator>`.
3. If `r.Tree != nil`:
   - Write `\n🌳 Tree for: <r.Tree.DocID>\n\n`.
   - If `r.Tree.Missing == true`: write `  Document not found.
     Available doc_ids:` followed by an indented list of hints.
   - Else: write one line per `treeRow` using
     `<indent>[<nodeID>] #×level <title> (<wordCount>w)` plus an
     optional summary line.
4. If `r.Search != nil`:
   - Write `\n🔍 Search: "<query>"\n\n`.
   - If `len(r.Search.Rows) == 0`: write `  No results found.`.
   - Else: for each row, write `  <score> │ [<docID>] <nodeTitle>`
     followed by `       <snippet slice 0..100>`.
5. If both `r.Tree` and `r.Search` are nil: write a `📋 Sample
   documents (first 10):\n\n` block listing each `sampleDoc`, then
   the two usage hints at the bottom.

**Postconditions:** all writes completed, or the first write error
is returned.

**Errors:**

- Any `io.Writer.Write` failure is returned wrapped with
  `fmt.Errorf("write report: %w", err)`.

**Edge cases:**

- Non-UTF8 writer (rare) → emojis still serialize as bytes; writer
  decides whether to error. No defensive fallback.
- Numbers >= 1000 → thousands-separator formatting uses
  `humanize.Comma`-equivalent built from stdlib (a tiny helper, not
  a new dependency).

**Parity requirements:** the structure matches
`src/cli-index.ts:38-98`; exact byte parity is NOT required, only
structural parity.

**Test requirements unit:**

- Every branch of the if-ladder above exercised once, asserting
  the written bytes contain the expected substring.
- Writer-error propagation via a `failingWriter` stub.

## Invariants

1. **Subcommand routing uses stdlib `flag`.** No `cobra`, no
   `urfave/cli`, no `kingpin`. The `justification` note below
   explains why.
2. **Zero external subcommand deps.** Phase A is the last chance to
   introduce them; the decision here is to not. Revisiting requires
   a new ADR.
3. **Default verb stays stdio.** Bare `treenav-mcp` with no
   arguments runs the stdio MCP server. This is required for
   Claude Desktop zero-config launches.
4. **Exit codes.** 0 success, 1 runtime error, 2 usage / flag parse
   error. Matches Unix convention and the TS script's `process.exit`
   usage.
5. **No writes to disk.** The `index` subcommand is purely
   diagnostic. Any write operation is a new verb behind a new ADR.

## Concurrency

- `runIndexCLI` is single-threaded relative to the caller. It calls
  `buildStore` which may internally fan out to a worker pool during
  indexing (see `docs/spec/concurrency-model.md`), but returns only
  after indexing completes.
- No goroutines are spawned by the CLI itself.
- Context cancellation from `main` (SIGINT/SIGTERM) propagates into
  `buildStore`; the CLI returns promptly on ctx cancel with exit
  code 130.

## Fixture data

Located in `testdata/cli/`:

- `corpus/` — minimal two-document markdown corpus used by every CLI
  test.
- `stats.golden` — expected stdout for `treenav-mcp index --root
  testdata/cli/corpus`.
- `tree-known.golden` — expected stdout for `--tree <known-id>`.
- `tree-missing.golden` — expected stdout for `--tree nonexistent`;
  includes the hints section.
- `search-hits.golden` — expected stdout for `--search needle`.
- `search-empty.golden` — expected stdout for `--search xyzzy`.
- `combined.golden` — `--tree` and `--search` together.

Golden files use substring-contains comparisons, not byte-exact
matches, because the exact whitespace and timing are not load-bearing.

## Justification: `flag` over `cobra`

The CLI has four subcommands (`serve`, `serve-http`, `index`,
`version`) plus a handful of flags per subcommand. The total flag
surface is ~10 flags. `cobra` would pull in `spf13/pflag`,
`spf13/viper` (transitively, via some consumers), and ~15 packages
into `go.sum` to replace ~40 lines of `flag` boilerplate. The binary
is a Claude Desktop subprocess whose cold start is already being
optimized for (one of the primary motivations for the Go port — see
ADR 0002). Adding 15 packages of init code to shave 40 lines of
dispatch is the wrong trade. `flag` is boring, stdlib-only, and
sufficient.

If a future need introduces nested subcommands (e.g. `treenav-mcp
curator list`, `treenav-mcp curator lock`), we revisit this choice
in its own ADR. Until then, the choice is `flag`.
