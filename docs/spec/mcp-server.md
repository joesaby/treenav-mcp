# Spec: MCP Server (stdio + HTTP)

**Feature doc:** [../features/mcp-server.md](../features/mcp-server.md)
**TS source:** `src/server.ts`, `src/server-http.ts`, `bin.ts`
**Go package:** `cmd/treenav-mcp`

## Scope

This spec governs the binary entry point: argv parsing, env var
parsing, the shared indexing pipeline, stdio transport wiring, HTTP
transport wiring, logging configuration, graceful shutdown, and MCP
protocol version pinning. It does NOT govern what the tools do once
registered — that is the domain of `docs/spec/mcp-tools.md`.

Phase B covers this spec with:

- A stdio round-trip test that spawns the binary as a subprocess,
  sends a `listTools` request over stdin, and asserts the reply on
  stdout is valid JSON-RPC with the expected tool count.
- An HTTP round-trip test that starts `serveHTTP` in-process, hits
  `POST /mcp`, asserts the streamable HTTP response framing, and
  hits `GET /health` to assert the stats payload.
- An env-parsing table test with one row per documented variable.
- A stdout-purity test that captures every byte on stdout during a
  stdio session and asserts every line is a valid JSON-RPC message.

## Types

```go
package main

import (
    "context"
    "io"
    "net/http"

    mcpserver "github.com/mark3labs/mcp-go/server"

    "github.com/treenav/treenav-mcp/internal/curator"
    "github.com/treenav/treenav-mcp/internal/store"
)

// EnvConfig is the fully-parsed environment. Produced by parseEnv(),
// consumed by every subcommand.
type EnvConfig struct {
    DocsRoot       string
    DocsGlob       string
    MaxDepth       int
    SummaryLength  int
    GlossaryPath   string

    CodeRoot       string
    CodeCollection string
    CodeWeight     float64
    CodeGlob       string

    Port int

    WikiWrite         bool
    WikiRoot          string
    WikiDupeThreshold float64
}

// parseEnv reads process env vars into an EnvConfig. Missing
// variables get the documented defaults. Parse errors on numeric
// vars fall through to the default with a warning logged to stderr.
func parseEnv() EnvConfig

// buildStore runs the shared indexing pipeline: indexer +
// optional code indexer + glossary load. Returns a fully populated
// *DocumentStore ready to hand to internal/mcp.RegisterTools.
func buildStore(ctx context.Context, env EnvConfig) (*store.DocumentStore, error)

// makeServer constructs a fresh MCPServer with tools registered.
// Called once for stdio, once per request for stateless HTTP.
func makeServer(st *store.DocumentStore, wiki *curator.Options) (*mcpserver.MCPServer, error)

// serveStdio blocks serving the MCP stdio transport until ctx is
// cancelled or the transport returns an error.
func serveStdio(ctx context.Context, env EnvConfig) error

// serveHTTP blocks serving the MCP streamable HTTP transport plus a
// /health probe until ctx is cancelled or the server returns.
func serveHTTP(ctx context.Context, env EnvConfig) error

// wireLogger installs a slog default handler that writes to
// os.Stderr only. MUST be called before any logging happens.
func wireLogger() *slog.Logger
```

## Functions

### parseEnv

**Signature:** `func parseEnv() EnvConfig`

**Preconditions:** none. Safe to call multiple times; idempotent.

**Behavior:**

1. Reads every env var in the table below via `os.Getenv`.
2. For numeric fields, parses with `strconv` and falls back to the
   documented default on parse error, logging a warning.
3. For `WIKI_WRITE`, treats only the literal string `"1"` as truthy.
   All other values (including `"true"`, `"yes"`) are false. This
   matches `src/server.ts:65` exactly.
4. Resolves `WIKI_ROOT` via `filepath.Clean` and an absolute path
   conversion, matching TS `resolve(process.env.WIKI_ROOT || docs_root)`.

| Env var | Type | Default | TS source line |
|---|---|---|---|
| `DOCS_ROOT` | string | `./docs` | `server.ts:33` |
| `DOCS_GLOB` | string | `**/*.md` | `indexer.ts` |
| `MAX_DEPTH` | int | `6` | `server.ts:35` |
| `SUMMARY_LENGTH` | int | `200` | `server.ts:36` |
| `GLOSSARY_PATH` | string | `$DOCS_ROOT/glossary.json` | `server.ts:93` |
| `CODE_ROOT` | string | `""` (disabled) | `server.ts:39` |
| `CODE_COLLECTION` | string | `code` | `server.ts:43` |
| `CODE_WEIGHT` | float64 | `1.0` | `server.ts:45` |
| `CODE_GLOB` | string | (all supported) | `server.ts:46` |
| `PORT` | int | `3100` | `server-http.ts:26` |
| `WIKI_WRITE` | bool | `false` | `server.ts:65` |
| `WIKI_ROOT` | string | `$DOCS_ROOT` | `server.ts:66` |
| `WIKI_DUPLICATE_THRESHOLD` | float64 | `0.35` | `server.ts:71` |

**Postconditions:** returned `EnvConfig` has every field set to either
the env-var value or the documented default.

**Errors:** none returned. Parse failures log a `slog.Warn` and fall
through to the default.

**Edge cases:**

- Empty string for `DOCS_ROOT` falls back to the default. Matches TS
  `process.env.DOCS_ROOT || "./docs"`.
- `WIKI_WRITE=1 WIKI_ROOT=""` uses `DOCS_ROOT` as the wiki root.
- `CODE_ROOT` being an empty string disables code indexing entirely;
  `makeServer` never touches `CODE_COLLECTION` / `CODE_WEIGHT` in that
  case.

**Parity requirements:** variable names, defaults, and the
`WIKI_WRITE == "1"` truthy rule must match TS byte-for-byte.

**Test requirements unit:** table test with one row per variable
covering set / unset / malformed cases.

**Test requirements e2e:** spawn the binary with an env set and
assert `GetStats()` reflects the parsed config.

### buildStore

**Signature:** `func buildStore(ctx context.Context, env EnvConfig) (*store.DocumentStore, error)`

**Preconditions:** `env` is populated by `parseEnv`. `env.DocsRoot`
points at a readable directory. `ctx` is cancellable.

**Behavior:**

1. Construct an `internal/types.IndexConfig` from env (`singleRootConfig`
   equivalent), including optional `CodeCollections`.
2. Call `indexer.IndexAllCollections(ctx, config)` — this handles both
   markdown and code collections.
3. Construct a fresh `store.DocumentStore` via `store.NewDocumentStore()`.
4. Call `store.Load(docs)`.
5. If `env.GlossaryPath` exists, read and JSON-decode it, then call
   `store.LoadGlossary(entries)`. Log a warning on read/parse failure
   but do not return an error (matches `src/server.ts:94-102`).
6. Log a ready line to stderr with document count, node count, and
   elapsed time.
7. Return the store.

**Postconditions:** the returned store is fully indexed and ready for
read tools. Write tools still need a `curator.Options`.

**Errors:**

- `fmt.Errorf("index failed: %w", err)` if `IndexAllCollections` fails.
- Filesystem errors on `env.DocsRoot` bubble up as wrapped errors.
- Glossary load errors are NEVER returned; they become warnings.

**Edge cases:**

- `env.DocsRoot` does not exist → hard error.
- `env.DocsRoot` is empty of markdown files → not an error; store is
  empty but functional.
- `env.GlossaryPath` points at a non-JSON file → warning, continue.

**Parity requirements:** load order must match `src/server.ts:85-103`
exactly: index first, then glossary. Reversing the order changes
auto-glossary extraction semantics.

**Test requirements unit:** n/a (covered by integration tests).

**Test requirements e2e:** run against `testdata/corpus/` and assert
the resulting stats match the TS oracle.

### makeServer

**Signature:** `func makeServer(st *store.DocumentStore, wiki *curator.Options) (*mcpserver.MCPServer, error)`

**Preconditions:** `st` is non-nil. `wiki` is nil iff curation tools
should not be registered.

**Behavior:**

1. `server := mcpserver.NewMCPServer("treenav-mcp", Version, ...)`
   where `Version` is the build-time version string.
2. Call `mcp.RegisterTools(server, mcp.Deps{Store: st, Formatter: searchfmt.FormatSearchResults, Wiki: wiki})`.
3. Return `server`.

**Postconditions:** the returned server has exactly 6 tools + 1
resource registered when `wiki == nil`, or exactly 9 tools + 1
resource when `wiki != nil`.

**Errors:**

- Whatever `RegisterTools` returns. In practice should be nil.

**Parity requirements:** server `name` is `treenav-mcp`, `version`
is `2.0.0` for the Go port (matches ADR 0002's `v2.0.0` target).

**Test requirements unit:** assert tool count in both wiki states.

**Test requirements e2e:** drive the server via mcp-go's in-memory
transport and assert `listTools` returns the expected count.

### serveStdio

**Signature:** `func serveStdio(ctx context.Context, env EnvConfig) error`

**Preconditions:** `ctx` honors cancellation. `os.Stdin` and
`os.Stdout` are the JSON-RPC channel.

**Behavior:**

1. Call `wireLogger()` to pin slog to stderr.
2. Call `buildStore(ctx, env)` — error is returned.
3. Build `wiki *curator.Options` from env when `env.WikiWrite` is true.
4. Call `makeServer(store, wiki)`.
5. Instantiate `mcpserver.NewStdioServer(server)`.
6. Start the server in a goroutine; wait on `ctx.Done()` or the
   server's error channel; cleanly close on either.
7. Log `"treenav-mcp MCP server running on stdio"` to stderr.
8. Block until the goroutine returns.

**Postconditions:** stdin/stdout is closed cleanly; the store's
indices are released when the process exits.

**Errors:**

- Index / glossary errors from `buildStore` propagate.
- `mcpserver.StdioServer` transport errors propagate.

**Edge cases:**

- `ctx` already cancelled at entry → return `ctx.Err()` immediately.
- Client disconnect (EOF on stdin) → return nil, not an error.
- Signal interrupt → `ctx.Done()` fires via
  `signal.NotifyContext` in `main`; server shuts down cleanly.

**Parity requirements:** stdout produces only JSON-RPC framing. This
is a hard invariant enforced by a Phase B stdout-purity test.

**Test requirements unit:** n/a.

**Test requirements e2e:** subprocess test spawning the binary,
sending a `listTools` request, asserting valid JSON-RPC reply, then
asserting stdout contains nothing else.

### serveHTTP

**Signature:** `func serveHTTP(ctx context.Context, env EnvConfig) error`

**Preconditions:** `ctx` honors cancellation. `env.Port` is a valid
port number.

**Behavior:**

1. Call `wireLogger()`.
2. Call `buildStore(ctx, env)`.
3. Build `wiki *curator.Options` from env.
4. Construct a `http.ServeMux`:
   - `GET /health` → writes `json.Marshal(store.GetStats())`.
   - `POST /mcp` → forwards to the streamable HTTP handler. Each
     request gets a fresh `mcpserver.MCPServer` via `makeServer`
     (stateless, matches TS `server-http.ts:87-100`).
5. Construct `http.Server{Addr: ":" + env.Port, Handler: mux, ...}`.
6. Start `ListenAndServe` in a goroutine.
7. On `ctx.Done()`, call `server.Shutdown(shutdownCtx)` with a
   5-second grace period.
8. Log `"MCP HTTP server running on http://localhost:<PORT>/mcp"` and
   `"Health check: http://localhost:<PORT>/health"` to stderr.

**Postconditions:** the HTTP server has released its listening port;
in-flight requests have completed or been cancelled.

**Errors:**

- `buildStore` errors propagate.
- `ListenAndServe` errors propagate except `http.ErrServerClosed`.
- Shutdown grace-period timeout logs a warning but does not error.

**Edge cases:**

- Port already in use → error on startup.
- Requests to unknown paths → `404 Not Found`, matches TS.
- `WIKI_WRITE=1` over HTTP: registration works identically; auth is
  the deployer's problem.

**Parity requirements:** endpoint paths (`/mcp`, `/health`), mime
types, response shapes.

**Test requirements unit:** n/a.

**Test requirements e2e:** in-process server, real HTTP client,
round-trip a `listTools` and a `/health` hit.

## Invariants

1. **Stdout is pure JSON-RPC on stdio.** No print statements, no
   fmt.Println, no slog.Info writing to stdout. Enforced by a test
   that captures `os.Stdout`, runs a stdio session, and asserts
   every line parses as JSON-RPC.
2. **Logs go to stderr, always.** `wireLogger()` installs a
   `slog.NewTextHandler(os.Stderr, ...)` and sets it as default. It
   panics if called more than once per process.
3. **`WIKI_WRITE=1` → exactly 9 tools, else exactly 6.** Asserted by
   a regression test that calls `listTools` in both states and
   compares against fixtures.
4. **Transport-neutral env parsing.** `serveStdio` and `serveHTTP`
   both call `parseEnv()` — there is no "HTTP-only" or "stdio-only"
   env var except `PORT`, which `serveStdio` silently ignores.
5. **MCP protocol version pinning.** `go.mod` pins `mcp-go` to a
   specific minor version. CI runs a capability-diff step that hits
   `/mcp` with an `initialize` request and compares the response
   (`protocolVersion`, `capabilities.tools.listChanged`, etc.) to a
   checked-in fixture at `testdata/mcp/capabilities.json`. Any drift
   fails CI with an explicit message pointing the operator at the
   fixture regeneration script. This is how we detect mcp-go
   accidentally bumping the reported protocol version out from under
   us.
6. **Graceful shutdown.** SIGINT/SIGTERM cancels the root context;
   both transports observe cancellation and shut down within 5s.

## Concurrency

- `serveStdio` is effectively single-threaded for requests because
  the stdio transport serializes them, but `mcp-go` still dispatches
  handler goroutines, so the store's `sync.RWMutex` is exercised.
- `serveHTTP` is fully concurrent. `net/http` spawns one goroutine
  per request; each goroutine acquires `store.mu.RLock()` via the
  handler, or `store.mu.Lock()` via the curator write path.
- `buildStore` is single-threaded; the indexer may internally use a
  worker pool (see `docs/features/concurrency-model.md`), but
  `buildStore` returns only after indexing is complete.
- Phase B runs the full e2e suite under `go test -race`, with
  particular focus on curator writes interleaved with read-tool
  queries.

## Fixture data

Located in `testdata/server/`:

- `env/*.json` — env var table cases, one row per var, with expected
  `EnvConfig` output.
- `stdio/list-tools.json` — request/response for a read-only stdio
  session.
- `stdio/list-tools-wiki.json` — same with `WIKI_WRITE=1`.
- `http/health.json` — expected `/health` payload on the test corpus.
- `http/mcp-list-tools.json` — expected `/mcp` response for
  `listTools`.
- `capabilities.json` — the pinned `initialize` response used by the
  protocol-version-drift check.
- `stdout-purity.txt` — captured stdout during a stdio session; every
  line must parse as JSON-RPC.
