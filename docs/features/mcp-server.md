# MCP Server (stdio + HTTP)

## Summary

`cmd/treenav-mcp` is the single-binary entry point. It parses environment
variables, builds an `IndexConfig`, runs the initial index, constructs a
`DocumentStore`, wires up the nine MCP tools via `internal/mcp`, and then
serves one of two transports:

- **stdio** (default) — one server instance per subprocess, reads
  JSON-RPC from stdin, writes responses to stdout, logs to stderr. This
  is what Claude Desktop and Claude Code launch via
  `command: /usr/local/bin/treenav-mcp`.
- **streamable HTTP** — binds to `:${PORT}` (default `3100`), exposes the
  MCP endpoint at `POST /mcp` and a health probe at `GET /health`. Used
  for Railway / Fly / Docker deployments where one server handles many
  clients.

Both transports share the same tool registration call, the same store
instance, and the same indexing step. The transport choice is a CLI
flag (`--http`) or the `serve http` subcommand, defaulting to stdio so
that Claude Desktop's zero-config launch path keeps working.

## Go package (`cmd/treenav-mcp`)

`cmd/treenav-mcp` — the binary. One `main.go`, plus subcommand
dispatchers.

Exports (main package, not imported by anything):

- `main()` — the entry point. Parses `os.Args`, dispatches to
  `serveStdio`, `serveHTTP`, or `runIndexCLI` (the debug subcommand
  documented in `docs/features/cli-debug.md`).
- `parseEnv() EnvConfig` — reads every env var documented in CLAUDE.md
  into a single struct. Shared by every subcommand.
- `buildStore(ctx context.Context, env EnvConfig) (*store.DocumentStore, error)`
  — runs `indexer.IndexAllCollections` + `store.Load` + optional glossary
  load. Shared between transports.
- `serveStdio(ctx context.Context, env EnvConfig) error`
- `serveHTTP(ctx context.Context, env EnvConfig) error`

## Public API (Go signatures)

```go
package main

import (
    "context"
    "net/http"

    mcpserver "github.com/mark3labs/mcp-go/server"

    "github.com/treenav/treenav-mcp/internal/curator"
    "github.com/treenav/treenav-mcp/internal/store"
)

// EnvConfig mirrors every documented env var from CLAUDE.md.
type EnvConfig struct {
    DocsRoot       string  // DOCS_ROOT, default "./docs"
    DocsGlob       string  // DOCS_GLOB, default "**/*.md"
    MaxDepth       int     // MAX_DEPTH, default 6
    SummaryLength  int     // SUMMARY_LENGTH, default 200
    GlossaryPath   string  // GLOSSARY_PATH, default $DOCS_ROOT/glossary.json
    CodeRoot       string  // CODE_ROOT, empty disables code indexing
    CodeCollection string  // CODE_COLLECTION, default "code"
    CodeWeight     float64 // CODE_WEIGHT, default 1.0
    CodeGlob       string  // CODE_GLOB, default all supported extensions
    Port           int     // PORT, default 3100 (HTTP only)

    // Wiki curation opt-in
    WikiWrite          bool    // WIKI_WRITE == "1"
    WikiRoot           string  // WIKI_ROOT, default $DOCS_ROOT
    WikiDupeThreshold  float64 // WIKI_DUPLICATE_THRESHOLD, default 0.35
}

func parseEnv() EnvConfig
func buildStore(ctx context.Context, env EnvConfig) (*store.DocumentStore, error)

// serveStdio reads JSON-RPC from stdin and writes to stdout. Logs go
// to stderr via slog. Blocks until the transport returns.
func serveStdio(ctx context.Context, env EnvConfig) error

// serveHTTP binds to :PORT and serves the MCP streamable HTTP transport
// at POST /mcp plus a GET /health probe. Blocks until the HTTP server
// returns or ctx is cancelled.
func serveHTTP(ctx context.Context, env EnvConfig) error

// makeServer builds a single MCPServer with tools registered. Shared
// by both transports.
func makeServer(st *store.DocumentStore, wiki *curator.Options) *mcpserver.MCPServer
```

## Key behaviors

- **Stdio uses stderr for logs, never stdout.** Logging to stdout
  corrupts the JSON-RPC framing. `log/slog` is configured with a
  handler that writes to `os.Stderr` and nothing else. This is
  enforced by a Phase B test that captures stdout during a
  `ListTools` round-trip and asserts it contains only valid JSON-RPC.

- **One store, two transports, zero duplication.** Both
  `serveStdio` and `serveHTTP` call `buildStore` and `makeServer` the
  same way. The only difference is the transport object passed to
  `mcpserver.NewStdioServer` vs the streamable HTTP handler mounted on
  a `net/http.ServeMux`.

- **HTTP transport uses `mcp-go`'s streamable HTTP server.** The
  endpoint is `POST /mcp`; a `GET /health` probe returns
  `store.GetStats()` JSON-encoded. In the TS version this is done by
  `WebStandardStreamableHTTPServerTransport` via `Bun.serve`; in Go it
  is `mcpserver.NewStreamableHTTPServer` mounted at `/mcp` on a
  `http.ServeMux` alongside the health endpoint.

- **Env parsing is shared.** `parseEnv` runs before any subcommand and
  produces a fully-populated `EnvConfig`. This means the stdio and HTTP
  transports read exactly the same variables in the same order, and
  the debug CLI gets the same config for `DOCS_ROOT`-style flags.

- **WIKI_WRITE gating is observable.** Setting `WIKI_WRITE=1` makes
  `parseEnv` populate `env.WikiRoot` and `env.WikiDupeThreshold`;
  `makeServer` then builds a non-nil `curator.Options` and passes it to
  `internal/mcp.RegisterTools`. The registration code registers exactly
  9 tools when `Wiki != nil` and exactly 6 when `Wiki == nil`. This is
  a hard invariant, not a best-effort target.

- **Context-aware shutdown.** `main` installs a `signal.NotifyContext`
  on SIGINT/SIGTERM and passes the resulting context down into
  `serveHTTP` (which uses `http.Server.Shutdown`) and `serveStdio`
  (which closes the transport when the context is cancelled).

- **MCP protocol version pinning.** The `mcp-go` dependency version is
  pinned in `go.mod`. CI runs a capability-diff check that compares the
  `initialize` response against a fixture captured from the TS server;
  any drift fails the build. See the spec for the exact procedure.

## Dependencies

- **third-party:**
  - `github.com/mark3labs/mcp-go` — `mcpserver.MCPServer`,
    `mcpserver.NewStdioServer`, `mcpserver.NewStreamableHTTPServer`,
    `mcpgo.Tool*` types.
- **stdlib:**
  - `context` — cancellation and request-scoped values.
  - `flag` — top-level CLI arg parsing (`--http`, subcommand routing).
  - `log/slog` — structured logging to stderr.
  - `net/http` — the HTTP server and `ServeMux` the streamable MCP
    endpoint is mounted on.
  - `os`, `os/signal` — env var reads, shutdown signal handling.
  - `strconv` — env var parsing.
- **internal:**
  - `internal/mcp` — tool registration.
  - `internal/store` — the in-memory BM25 engine.
  - `internal/indexer` — markdown indexing at startup.
  - `internal/codeindex` — code indexing at startup (optional).
  - `internal/curator` — `Options` struct for the WIKI_WRITE path.

## Relationship to TS source

- `src/server.ts` (120 lines) → `cmd/treenav-mcp/stdio.go`.
  `main()` body maps 1:1 with `serveStdio`; the indexing + glossary
  load block at `src/server.ts:85-103` becomes `buildStore`.
- `src/server-http.ts` (112 lines) → `cmd/treenav-mcp/http.go`.
  The `Bun.serve` handler block at lines 70-105 becomes a
  `http.ServeMux` with two handlers; the per-request server
  construction pattern at lines 87-100 is kept (stateless) by having
  `makeServer` return a fresh `MCPServer` for every incoming request
  when `env.HTTPStateless` is true. For the first cut we ship a
  single shared server instance (matches TS read-mostly semantics).
- `bin.ts` (2 lines) → trivially replaced by `cmd/treenav-mcp/main.go`
  and `go build`.

## Non-goals

- **No WebSocket transport.** `mcp-go` supports it, but the TS version
  ships only stdio and streamable HTTP. Adding WebSocket is a future
  ADR.
- **No TLS termination.** Deployments that need TLS put the binary
  behind a reverse proxy (nginx, Fly proxy, Caddy). Justified because
  every serious deployment already has one.
- **No live-reload / file watching at this phase.** The TS version
  doesn't do it either. Incremental reindex is limited to the
  curator's `write_wiki_entry` path.
- **No multi-store sharding.** One store, one index, one process.
  Horizontal scaling is out of scope for v2.0.0.
- **No auth.** HTTP transport is unauthenticated. Users who need
  auth put it in front via a reverse proxy. Stdio is inherently
  auth-bounded by the subprocess launching it.
