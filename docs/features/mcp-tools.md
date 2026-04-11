# MCP Tools

## Summary

The MCP tool layer is the entire user-visible surface of treenav-mcp. It
registers nine JSON-RPC tools on a `mcp-go` server: six read tools that
any client always sees, plus three curation write tools that only appear
when `WIKI_WRITE=1` is set. Each tool is a thin adapter that unmarshals the
JSON arguments into a Go struct, delegates to a pure function in
`internal/store`, `internal/codeindex`, or `internal/curator`, and then
either hands the result off to `internal/searchfmt` for human-readable
text rendering or serializes a JSON payload inside a fenced block. Nothing
here touches the filesystem or runs goroutines directly — the layer is a
schema-and-dispatch wrapper so the same tool implementations are reused by
both transports (stdio and streamable HTTP) in `cmd/treenav-mcp`.

Parity with the TS implementation is load-bearing: names, argument
schemas, return shapes, and the `WIKI_WRITE` gating behavior are all
fixed by ADR 0002's "no public surface change" non-goal. The Phase B
regression suite asserts `ListTools()` returns exactly 6 entries when
`WIKI_WRITE` is unset and exactly 9 when it is `"1"`.

## Go package (`internal/mcp`)

`internal/mcp` — tool registration and argument/result marshaling.

Exports:

- `RegisterTools(server *mcpgo.Server, deps Deps) error` — registers all
  read tools unconditionally, then conditionally registers the curation
  tools when `deps.Wiki != nil`.
- `Deps` — the handler dependency bundle (store, curator handle,
  formatter function, optional wiki config).
- One input struct per tool (e.g. `ListDocumentsArgs`, `SearchDocumentsArgs`,
  …). Each has JSON tags that mirror the TS Zod schema names exactly so a
  fixture captured from the TS server round-trips unchanged.
- One result struct per tool that emits an array field (to guarantee
  `[]` not `null` on empty — see the JSON gotcha in the spec).
- Sentinel error mapping: `toMCPError(err error) *mcpgo.ToolError` which
  maps `curator.ErrDuplicate`, `curator.ErrPathEscape`,
  `curator.ErrInvalidFrontmatter`, `store.ErrDocNotFound`, etc. onto
  JSON-RPC error codes.

The nine tools, in registration order:

1. `list_documents` — browse the catalog with optional tag / keyword filter
2. `search_documents` — BM25 keyword search with facet filters
3. `get_tree` — hierarchical outline for a single document
4. `get_node_content` — text of one or more specific nodes
5. `navigate_tree` — a node plus every descendant with full content
6. `find_symbol` — code-aware symbol search (gated on `CODE_ROOT`)
7. `find_similar` *(WIKI_WRITE only)* — BM25 dedupe check for a draft
8. `draft_wiki_entry` *(WIKI_WRITE only)* — scaffold a new entry
9. `write_wiki_entry` *(WIKI_WRITE only)* — validated write + reindex

Plus one resource, also registered unconditionally:

- `index-stats` at URI `md-tree://stats`, mime type `application/json`,
  body is `store.GetStats()` JSON-encoded.

## Public API (Go signatures)

```go
package mcp

import (
    "context"

    mcpgo "github.com/mark3labs/mcp-go/mcp"
    mcpserver "github.com/mark3labs/mcp-go/server"

    "github.com/treenav/treenav-mcp/internal/curator"
    "github.com/treenav/treenav-mcp/internal/searchfmt"
    "github.com/treenav/treenav-mcp/internal/store"
)

// Deps is the handler dependency bundle. The caller (cmd/treenav-mcp)
// constructs this after indexing and passes it to RegisterTools.
type Deps struct {
    Store     *store.DocumentStore
    Formatter searchfmt.FormatFunc // searchfmt.FormatSearchResults
    Wiki      *curator.Options     // nil ⇒ WIKI_WRITE tools are NOT registered
}

// RegisterTools registers all six read tools and the index-stats
// resource. If deps.Wiki != nil, it additionally registers the three
// curation tools. It is safe to call exactly once per server instance.
func RegisterTools(server *mcpserver.MCPServer, deps Deps) error

// ── Read-tool argument structs (JSON tags match TS Zod schema) ──────

type ListDocumentsArgs struct {
    Query  string `json:"query,omitempty"`
    Tag    string `json:"tag,omitempty"`
    Limit  int    `json:"limit,omitempty"`  // default 30, max 100
    Offset int    `json:"offset,omitempty"`
}

type SearchDocumentsArgs struct {
    Query   string              `json:"query"`
    DocID   string              `json:"doc_id,omitempty"`
    Filters map[string][]string `json:"filters,omitempty"`
    Limit   int                 `json:"limit,omitempty"` // default 15, max 50
}

type GetTreeArgs struct {
    DocID string `json:"doc_id"`
}

type GetNodeContentArgs struct {
    DocID   string   `json:"doc_id"`
    NodeIDs []string `json:"node_ids"` // 1..10 entries
}

type NavigateTreeArgs struct {
    DocID  string `json:"doc_id"`
    NodeID string `json:"node_id"`
}

type FindSymbolArgs struct {
    Query    string `json:"query"`
    Kind     string `json:"kind,omitempty"`     // class|interface|function|method|type|enum|variable
    Language string `json:"language,omitempty"` // e.g. typescript|python|go
    Limit    int    `json:"limit,omitempty"`    // default 15, max 50
}

// ── Curation-tool argument structs (gated on WIKI_WRITE=1) ──────────

type FindSimilarArgs struct {
    Content    string  `json:"content"`
    Limit      int     `json:"limit,omitempty"`      // default 5, max 20
    Threshold  float64 `json:"threshold,omitempty"`  // default 0.1
    Collection string  `json:"collection,omitempty"`
}

type DraftWikiEntryArgs struct {
    Topic         string `json:"topic"`
    RawContent    string `json:"raw_content"`
    SuggestedPath string `json:"suggested_path,omitempty"`
    SourceURL     string `json:"source_url,omitempty"`
}

type WriteWikiEntryArgs struct {
    Path           string         `json:"path"`
    Frontmatter    map[string]any `json:"frontmatter"`
    Content        string         `json:"content"`
    DryRun         bool           `json:"dry_run,omitempty"`
    AllowDuplicate bool           `json:"allow_duplicate,omitempty"`
    Overwrite      bool           `json:"overwrite,omitempty"`
}
```

## Key behaviors

- **9-tool exact registration.** `RegisterTools` registers the six read
  tools in the fixed order above, then the `index-stats` resource, then
  the three curation tools if and only if `deps.Wiki != nil`. The exact
  count is asserted by a Phase B regression test that calls `ListTools`
  twice — once with `WIKI_WRITE` unset, once with `WIKI_WRITE=1`.

- **Argument schemas mirror the TS Zod schemas** exactly. Field names,
  types, required/optional flags, default values, min/max constraints,
  and the `find_symbol` `kind` enum are lifted from `src/tools.ts` with
  file:line citations in the spec.

- **Dispatch is a single call** per tool. The handler body is: unmarshal
  args → call into `internal/store` or `internal/curator` → format result
  → return. No business logic lives in `internal/mcp`.

- **Read-tool output shape is `{ content: [{type: "text", text: ...}] }`**
  where `text` is Markdown formatted by either `internal/searchfmt` (for
  `search_documents` and `find_symbol`) or by inline helpers for
  `list_documents`, `get_tree`, `get_node_content`, `navigate_tree`.

- **Curation-tool output shape is a fenced JSON block**. `find_similar`,
  `draft_wiki_entry`, and `write_wiki_entry` all return the internal
  result struct JSON-encoded with 2-space indent inside a
  ```` ```json ```` code fence — matches `src/tools.ts:365-367` verbatim.

- **Error responses** always use `isError: true` and a text payload of
  `"Error: <code>: <message>"` where `<code>` is the sentinel-mapped
  JSON-RPC code from the error taxonomy. See
  `docs/features/error-taxonomy.md`.

- **`find_symbol` always registers** regardless of whether `CODE_ROOT`
  is set. When no code collection is loaded it returns a
  "No symbols found" message pointing at `CODE_ROOT`. This matches
  `src/tools.ts:305-313`.

## Dependencies

- **third-party:**
  - `github.com/mark3labs/mcp-go` — MCP protocol SDK. Provides
    `mcpserver.MCPServer`, tool registration helpers, `ToolError`, and
    both stdio and streamable HTTP transports. This is the direct
    replacement for `@modelcontextprotocol/sdk`.
- **stdlib:**
  - `context` — passed through every tool handler.
  - `encoding/json` — for the `jsonBlock` helper and tool result
    encoding. Known gotcha: nil slices must be `make([]T, 0)` — see
    spec Invariants section.
  - `fmt` — error message formatting.
- **internal:**
  - `internal/store` — every read tool delegates here.
  - `internal/curator` — every curation tool delegates here.
  - `internal/searchfmt` — result rendering for `search_documents` and
    `find_symbol`.
  - `internal/types` — shared `SearchResult`, `TreeNode`,
    `DocumentMeta`, etc.

## Relationship to TS source

Direct port of `src/tools.ts` (530 lines). Function boundaries match
1:1: every TS `server.tool(…)` call becomes one Go handler function.
Helper functions `jsonBlock` (line 365) and `errorResult` (line 369)
become `jsonBlock` and `toMCPError` in `internal/mcp`. The
`registerCurationTools` split (line 385) is preserved. The resource
registration at `src/tools.ts:342-353` becomes a `server.AddResource`
call on the mcp-go server.

## Non-goals

- **No new tools.** The 9-tool surface is fixed by ADR 0002 as a
  non-goal. Adding or removing a tool requires a separate ADR.
- **No argument schema changes.** Field renames, default changes, or
  enum extensions are out of scope for the port.
- **No business logic.** `internal/mcp` is a dispatch layer. Any bug
  whose fix lives inside a handler body is actually a bug in
  `internal/store` or `internal/curator` and should be fixed there.
- **No concurrency policy.** Handler goroutines are spawned by
  `mcp-go`'s transport, and the store's `sync.RWMutex` handles
  read/write interleaving. See `docs/features/concurrency-model.md`.
- **No telemetry.** No metrics, no tracing. Logs go through
  `log/slog` to stderr and only at `Error` / `Info` levels.
