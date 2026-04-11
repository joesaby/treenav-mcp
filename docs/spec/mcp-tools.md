# Spec: MCP Tools

**Feature doc:** [../features/mcp-tools.md](../features/mcp-tools.md)
**TS source:** `src/tools.ts`
**Go package:** `internal/mcp`

## Scope

This spec is authoritative for the nine MCP tool names, argument
schemas, return shapes, registration order, `WIKI_WRITE` gating, and
error-to-MCP mapping. It does **not** govern what the store actually
returns — that is the job of `docs/spec/bm25-engine.md`, `docs/spec/markdown-indexer.md`,
and `docs/spec/curator.md`. The MCP tools here are a dispatch layer that
marshals JSON, delegates to those packages, and converts sentinel errors
into JSON-RPC error responses.

The Phase B test suite drives this spec via:

- A tool-registration test that asserts exact counts (6 read / 9 total)
  for both `WIKI_WRITE` states.
- Per-tool argument validation tests that reject malformed JSON and
  out-of-range integers with JSON-RPC error code `-32602`.
- Golden-file output tests that compare rendered MCP responses to
  fixtures captured from the TS oracle.
- A sentinel-mapping test that forces each curator error via stub
  injection and asserts the resulting error code + message template.

## Types

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

// Deps bundles everything a tool handler needs. Constructed by
// cmd/treenav-mcp and passed by value.
type Deps struct {
    Store     *store.DocumentStore
    Formatter searchfmt.FormatFunc
    Wiki      *curator.Options // nil ⇒ curation tools are NOT registered
}

func RegisterTools(server *mcpserver.MCPServer, deps Deps) error

// ── Argument structs (one per tool) ─────────────────────────────────

type ListDocumentsArgs struct {
    Query  string `json:"query,omitempty"`
    Tag    string `json:"tag,omitempty"`
    Limit  int    `json:"limit,omitempty"`
    Offset int    `json:"offset,omitempty"`
}

type SearchDocumentsArgs struct {
    Query   string              `json:"query"`
    DocID   string              `json:"doc_id,omitempty"`
    Filters map[string][]string `json:"filters,omitempty"`
    Limit   int                 `json:"limit,omitempty"`
}

type GetTreeArgs struct {
    DocID string `json:"doc_id"`
}

type GetNodeContentArgs struct {
    DocID   string   `json:"doc_id"`
    NodeIDs []string `json:"node_ids"`
}

type NavigateTreeArgs struct {
    DocID  string `json:"doc_id"`
    NodeID string `json:"node_id"`
}

type FindSymbolArgs struct {
    Query    string `json:"query"`
    Kind     string `json:"kind,omitempty"`
    Language string `json:"language,omitempty"`
    Limit    int    `json:"limit,omitempty"`
}

type FindSimilarArgs struct {
    Content    string  `json:"content"`
    Limit      int     `json:"limit,omitempty"`
    Threshold  float64 `json:"threshold,omitempty"`
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

// ── Result envelope helpers ─────────────────────────────────────────

// textResult returns a standard MCP text-content response.
func textResult(text string) *mcpgo.CallToolResult

// jsonBlockResult wraps a JSON-encodable value in a ```json fence
// (matches src/tools.ts:365-367).
func jsonBlockResult(v any) (*mcpgo.CallToolResult, error)

// errorToResult maps any error onto an MCP text-content error response
// with isError=true. Returns the sentinel-mapped JSON-RPC code.
func errorToResult(err error) *mcpgo.CallToolResult
```

## Tool 1: `list_documents`

**Input schema** (matches `src/tools.ts:47-70`):

```go
type ListDocumentsArgs struct {
    Query  string `json:"query,omitempty"`  // keyword filter on title/description/path
    Tag    string `json:"tag,omitempty"`    // frontmatter tag filter
    Limit  int    `json:"limit,omitempty"`  // 1..100, default 30
    Offset int    `json:"offset,omitempty"` // >=0, default 0
}
```

**Behavior:**

1. Apply defaults: `limit = 30` if zero, `offset = 0` if negative.
2. Call `store.ListDocuments({Query, Tag, Limit, Offset})`.
3. Build a Markdown bullet list with `• [doc_id] title (N sections, M words)`,
   path, tags, and up to 5 references-to links per doc (matches
   `src/tools.ts:74-79`).
4. Wrap the summary in a header:
   `Found <total> documents (showing <from>-<to>): ...`.
5. Append the navigation hint:
   `Use get_tree with a doc_id to explore a document's section hierarchy.`
6. Return as `text` content.

**Output:** `CallToolResult { content: [{ type: "text", text }] }`. No
structured fields — all human-readable.

**Errors:**

- JSON-RPC `-32602` (invalid params) if `limit > 100` or `offset < 0`.
- No runtime errors from `store.ListDocuments`.

## Tool 2: `search_documents`

**Input schema** (matches `src/tools.ts:94-117`):

```go
type SearchDocumentsArgs struct {
    Query   string              `json:"query"`              // required
    DocID   string              `json:"doc_id,omitempty"`   // scope to one doc
    Filters map[string][]string `json:"filters,omitempty"`  // facet filters
    Limit   int                 `json:"limit,omitempty"`    // 1..50, default 15
}
```

**Behavior:**

1. Reject empty `Query` with `-32602` "query is required".
2. Apply `limit = 15` default.
3. Call `store.SearchDocuments(query, SearchOptions{Limit, DocID, Filters})`.
4. Call `deps.Formatter(results, store, query)` to render Markdown.
5. Return as `text` content.

**Filter format:** the TS Zod schema accepts values of type `string | string[]`.
The Go version normalizes to `[]string` — a single-string JSON value is
lifted to a one-element slice in a custom `UnmarshalJSON` on
`SearchDocumentsArgs` (see Invariants).

**Output:** text content, formatted by `internal/searchfmt.FormatSearchResults`.

**Errors:**

- `-32602` on empty query.
- `-32602` on unknown facet key (optional; may be a warning, matches TS
  behavior which silently ignores).
- `-32000` wrapping any panic recovered from the store (shouldn't happen,
  but panic-recover is a guardrail).

## Tool 3: `get_tree`

**Input schema** (matches `src/tools.ts:127-134`):

```go
type GetTreeArgs struct {
    DocID string `json:"doc_id"` // required
}
```

**Behavior:**

1. Call `store.GetTree(docID)`. Missing doc → friendly "not found"
   text response (NOT an MCP error), matching `src/tools.ts:138-147`.
2. Build an indented outline: for each outline node, emit
   `<2*(level-1) spaces>[node_id] #<level> title (N words)` followed
   by an indented summary line.
3. Return text content with header
   `Document: <title>\nDoc ID: <doc_id>\nSections: <N>` and footer
   pointing the agent at `get_node_content` and `navigate_tree`.

**Output:** text content.

**Errors:**

- No MCP errors are returned. Missing doc becomes a friendly text
  response. This matches TS behavior and is deliberate: the TS version
  treats missing docs as information to relay, not as protocol errors.

## Tool 4: `get_node_content`

**Input schema** (matches `src/tools.ts:171-181`):

```go
type GetNodeContentArgs struct {
    DocID   string   `json:"doc_id"`   // required
    NodeIDs []string `json:"node_ids"` // required, 1..10 entries
}
```

**Behavior:**

1. Validate `len(NodeIDs) >= 1 && len(NodeIDs) <= 10`, reject with
   `-32602` otherwise.
2. Call `store.GetNodeContent(docID, nodeIDs)`.
3. If result is `nil` (doc missing) → friendly "not found" text.
4. If result is empty (no matching nodes) → friendly "no matching
   nodes found for IDs: X, Y" text with a hint to call `get_tree`.
5. Otherwise format each node as:
   `━━━ <title> [<node_id>] (H<level>) ━━━\n\n<content|"(empty section)">`
   joined by `\n\n`.

**Output:** text content.

**Errors:**

- `-32602` if `NodeIDs` is empty or longer than 10.
- No MCP errors for missing docs or missing node IDs.

## Tool 5: `navigate_tree`

**Input schema** (matches `src/tools.ts:231-236`):

```go
type NavigateTreeArgs struct {
    DocID  string `json:"doc_id"`  // required
    NodeID string `json:"node_id"` // required
}
```

**Behavior:**

1. Call `store.GetSubtree(docID, nodeID)`. Missing doc or node →
   friendly text response.
2. For every node in the subtree, emit an indented heading with its
   content. Indent is `2 * max(0, level - rootLevel)` spaces.
3. Compute total word count by summing `node.WordCount` across the
   subtree.
4. Return text content with header
   `Subtree: <rootTitle> (<N> sections, <totalWords> words)`.

**Output:** text content.

**Errors:** none (missing targets become friendly text).

## Tool 6: `find_symbol`

**Input schema** (matches `src/tools.ts:273-294`):

```go
type FindSymbolArgs struct {
    Query    string `json:"query"`              // required
    Kind     string `json:"kind,omitempty"`     // enum
    Language string `json:"language,omitempty"`
    Limit    int    `json:"limit,omitempty"`    // 1..50, default 15
}
```

The `Kind` enum is `{class, interface, function, method, type, enum,
variable}`. Invalid values are rejected with `-32602`.

**Behavior:**

1. Validate `Kind` against the enum if non-empty.
2. Build `filters := map[string][]string{"content_type": {"code"}}` and
   optionally add `symbol_kind: {Kind}` and `language: {Language}`.
3. Call `store.SearchDocuments(Query, SearchOptions{Limit, Filters: filters})`.
4. On empty results, return a friendly "No symbols found" text that
   mentions `CODE_ROOT`.
5. Otherwise format each result as:
   `<N>. <node_title> [<node_id>]\n   File: <file_path>\n   Score: <.1>\n   Signature: <snippet>`

**Output:** text content.

**Errors:**

- `-32602` on invalid `Kind` or `Limit` out of range.
- Registration is unconditional. Missing `CODE_ROOT` is not an error;
  the tool just returns an empty result with a hint.

## Tool 7: `find_similar` *(WIKI_WRITE only)*

**Input schema** (matches `src/tools.ts:392-418`):

```go
type FindSimilarArgs struct {
    Content    string  `json:"content"`               // required, min length 1
    Limit      int     `json:"limit,omitempty"`       // 1..20, default 5
    Threshold  float64 `json:"threshold,omitempty"`   // 0..10, default 0.1
    Collection string  `json:"collection,omitempty"`  // scope to one collection
}
```

**Behavior:**

1. Reject empty `Content` with `-32602`.
2. Call `curator.FindSimilar(store, content, curator.FindSimilarOptions{
   Limit, Threshold, Collection, DuplicateThreshold: deps.Wiki.DuplicateThreshold})`.
3. JSON-encode the `curator.FindSimilarResult` struct with 2-space
   indent.
4. Return wrapped in a ```` ```json ```` fence.

**Output:** text content with a JSON fenced block.

**Errors:**

- `-32602` on empty content, `Limit` or `Threshold` out of range.
- Maps `curator.ErrInvalidArgs` → `-32602`.
- Wraps any other curator error with `-32000` generic error.

## Tool 8: `draft_wiki_entry` *(WIKI_WRITE only)*

**Input schema** (matches `src/tools.ts:436-458`):

```go
type DraftWikiEntryArgs struct {
    Topic         string `json:"topic"`                 // required, min 1
    RawContent    string `json:"raw_content"`           // required, min 1
    SuggestedPath string `json:"suggested_path,omitempty"` // must end in .md
    SourceURL     string `json:"source_url,omitempty"`
}
```

**Behavior:**

1. Validate `Topic` and `RawContent` non-empty.
2. Call `curator.DraftWikiEntry(store, deps.Wiki, curator.DraftArgs{...})`.
3. Return the `curator.DraftResult` JSON-encoded inside a fenced block.
4. On `curator.ErrPathEscape` (path outside wiki root) → `-32602` with
   message "suggested_path escapes wiki root".

**Output:** text with fenced JSON block.

**Errors:**

- `-32602` on empty topic/raw_content, invalid suggested_path.
- Maps `curator.ErrPathEscape` → `-32602`.
- Wraps `curator.ErrIndexer` → `-32000`.

## Tool 9: `write_wiki_entry` *(WIKI_WRITE only)*

**Input schema** (matches `src/tools.ts:476-506`):

```go
type WriteWikiEntryArgs struct {
    Path           string         `json:"path"`            // required, must end in .md
    Frontmatter    map[string]any `json:"frontmatter"`     // required
    Content        string         `json:"content"`         // required (may be empty string)
    DryRun         bool           `json:"dry_run,omitempty"`
    AllowDuplicate bool           `json:"allow_duplicate,omitempty"`
    Overwrite      bool           `json:"overwrite,omitempty"`
}
```

**Behavior:**

1. Validate path is non-empty and ends in `.md`.
2. Call `curator.WriteWikiEntry(ctx, store, deps.Wiki, curator.WriteArgs{...})`.
3. Return the `curator.WriteResult` JSON-encoded inside a fenced block.
4. The curator handles duplicate detection, path containment,
   frontmatter validation, atomic write, and incremental reindex. This
   tool is a pure dispatch wrapper.

**Output:** text with fenced JSON block, containing `{doc_id, path,
written, reindex: {added, removed, elapsed_ms}}` on success.

**Errors:**

- `-32602` on invalid input: empty path, bad extension, malformed
  frontmatter.
- Maps `curator.ErrDuplicate` → `-32000` with message
  `"duplicate: overlap of <score> exceeds threshold <threshold>; retry with allow_duplicate=true"`.
- Maps `curator.ErrPathEscape` → `-32602` with message
  `"path escapes wiki root"`.
- Maps `curator.ErrExists` (overwrite=false collision) → `-32000`
  "file already exists; retry with overwrite=true".
- Wraps any other curator error with `-32000`.

## Invariants

1. **Exactly 6 tools registered when `deps.Wiki == nil`.** The
   registration order is `list_documents`, `search_documents`,
   `get_tree`, `get_node_content`, `navigate_tree`, `find_symbol`,
   followed by the `index-stats` resource.
2. **Exactly 9 tools registered when `deps.Wiki != nil`.** After the
   six read tools the registration adds `find_similar`,
   `draft_wiki_entry`, `write_wiki_entry` in that order.
3. **`index-stats` resource is always registered**, regardless of
   `Wiki`.
4. **JSON nil-slice gotcha.** Any tool response field that represents
   a JSON array MUST be constructed with `make([]T, 0)` — never
   `var s []T` and never a freshly-declared slice literal without
   explicit length. Affected fields:
   - `list_documents`: `documents[]`, `documents[i].tags[]`,
     `documents[i].references[]`
   - `search_documents`: not directly — text output — but the
     underlying `types.SearchResult` must keep this invariant
   - `get_tree`: `nodes[]`, `nodes[i].children[]`
   - `get_node_content`: `nodes[]`
   - `navigate_tree`: `nodes[]`
   - `find_symbol`: same as `search_documents`
   - `find_similar`: `matches[]`, `matches[i].backlinks[]`
   - `draft_wiki_entry`: `tags[]`, `backlinks[]`, `warnings[]`
   - `write_wiki_entry`: `reindex.added[]`, `reindex.removed[]`
   The Phase B parity test round-trips each result through
   `encoding/json` and asserts the output string contains `"[]"` not
   `"null"` for every affected field.
5. **Filter-value lift.** `SearchDocumentsArgs.Filters` accepts
   `map[string]string | map[string][]string` on the wire. A custom
   `UnmarshalJSON` lifts single strings into one-element slices so
   the handler only sees `map[string][]string`.
6. **Friendly-vs-error split.** Missing docs / missing nodes are
   returned as text content, NOT as MCP errors. This matches TS
   `src/tools.ts:138-147` and similar sites. Validation failures
   (schema, enum, range) ARE MCP errors.
7. **Error response shape.** `errorToResult` returns
   `CallToolResult { isError: true, content: [{ type: "text", text: "Error: <code>: <message>" }] }`
   matching `src/tools.ts:369-383`.

## Error code table

| Sentinel | JSON-RPC code | Message template |
|---|---|---|
| (validation: bad JSON, missing required, out-of-range, bad enum) | `-32602` | `"invalid params: <detail>"` |
| `curator.ErrInvalidArgs` | `-32602` | `"invalid args: <detail>"` |
| `curator.ErrPathEscape` | `-32602` | `"path escapes wiki root"` |
| `curator.ErrInvalidFrontmatter` | `-32602` | `"invalid frontmatter: <detail>"` |
| `curator.ErrDuplicate` | `-32000` | `"duplicate: overlap <score> exceeds threshold <t>; retry with allow_duplicate=true"` |
| `curator.ErrExists` | `-32000` | `"file already exists; retry with overwrite=true"` |
| `curator.ErrIndexer` | `-32000` | `"indexer error: <detail>"` |
| `store.ErrDocNotFound` (if used) | (not an MCP error; text response) | `"Document \"<id>\" not found. Use list_documents to see available documents."` |
| any other error | `-32000` | `"internal: <error>"` |
| panic recovered | `-32000` | `"internal: panic: <value>"` |

## Concurrency

- Handlers run on goroutines spawned by `mcp-go`'s transport.
- Read handlers acquire `store.mu.RLock()`. Write handlers
  (`write_wiki_entry`) go through `curator.WriteWikiEntry` which
  acquires `store.mu.Lock()` for the reindex step.
- `internal/mcp` itself holds no state, so it has no locking of its
  own. The `Deps` struct is immutable after `RegisterTools` returns.
- Phase B runs the full suite under `go test -race`.

## Fixture data

Located in `testdata/mcp/`:

- `list-tools-read-only.json` — expected `listTools` response when
  `WIKI_WRITE` is unset. Exactly 6 tools + 1 resource.
- `list-tools-wiki-write.json` — expected `listTools` response when
  `WIKI_WRITE=1`. Exactly 9 tools + 1 resource.
- `golden/<tool-name>/<case>.json` — request/response pairs captured
  from the TS server for each read tool.
- `errors/<sentinel>.json` — one forced-error fixture per curator
  sentinel, asserting the resulting MCP error code and message.
- `filters-lift.json` — request with scalar filter values, expected
  to unmarshal into `map[string][]string`.
- `nil-slice-roundtrip.json` — empty-corpus response that asserts
  every array field serializes as `[]`, never `null`.

All fixtures are generated by `scripts/dump-fixtures.ts` from the TS
implementation and checked in. Regenerating them is a conscious act
that requires a commit message explaining the drift.
