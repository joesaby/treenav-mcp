# Search Formatter

## Summary

`internal/searchfmt` is a pure function that turns a slice of
`types.SearchResult` into the Markdown-flavoured text that appears in a
Claude Desktop chat window. It has three jobs, each one a small string
template:

1. A ranked **snippet list** of every result, with a facet badge per
   row.
2. An inline **full-content block** for the top three matches, rendered
   by walking each match's subtree and emitting indented headings plus
   body text.
3. A **cross-reference line** per inlined block, listing the
   `[doc_id] (node_id)` of every link resolved from the match's
   frontmatter `references` field.

Formatting details are user-visible: any tweak to an indent, an ellipsis,
or the `→ References:` prefix is something end users will notice and
notice again during a PR review. That's why this sits in its own
package with its own unit tests rather than being inlined in
`internal/mcp`.

The formatter is a pure function from inputs to a string. It does not
hit the filesystem, does not log, and does not spawn goroutines. The
only external state it reads is whatever `SubtreeProvider` returns, and
that interface is small enough to satisfy with a stub in tests.

## Go package (`internal/searchfmt`)

`internal/searchfmt` — render BM25 search results as Markdown text.

Exports:

- `SubtreeProvider` interface — the minimal subset of `DocumentStore`
  methods the formatter needs. Declared here rather than in `store` so
  tests can pass a fake without importing the full store.
- `FormatSearchResults(results []types.SearchResult, store SubtreeProvider, query string) string`
  — the one entry point used by `internal/mcp`.
- `FormatFunc` — a type alias for the above, used by `internal/mcp.Deps`
  so the real formatter and test fakes are interchangeable.
- `InlineContentTopN` — exported constant (`3`) that fixes how many
  top matches get full subtree inlined. Matches `src/search-formatter.ts:14`.

## Public API (Go signatures)

```go
package searchfmt

import "github.com/treenav/treenav-mcp/internal/types"

// InlineContentTopN is the number of leading results for which the
// formatter inlines the full subtree (heading path + content) into
// the output. Matches src/search-formatter.ts:14.
const InlineContentTopN = 3

// SubtreeProvider is the minimal store interface needed to render
// search results. Satisfied by *store.DocumentStore in production.
type SubtreeProvider interface {
    // GetSubtree returns the root node and every descendant for the
    // given doc_id/node_id, in document order. Returns ok=false when
    // the doc or node doesn't exist.
    GetSubtree(docID, nodeID string) (*SubtreeView, bool)

    // ResolveRef resolves a frontmatter reference string (a file path
    // or #anchor) into a concrete {doc_id, node_id}. Returns ok=false
    // if the ref doesn't map to any indexed node.
    ResolveRef(path string) (types.RefResolution, bool)

    // GetDocMeta returns the DocumentMeta record for a doc_id, or
    // ok=false if unknown.
    GetDocMeta(docID string) (types.DocumentMeta, bool)
}

// SubtreeView is a slim projection of TreeNode used only by the
// formatter. The full TreeNode is denser than needed and would
// couple searchfmt to every indexer change.
type SubtreeView struct {
    Nodes []SubtreeNode
}

type SubtreeNode struct {
    NodeID  string
    Title   string
    Level   int
    Content string
}

// FormatFunc is the signature of FormatSearchResults, used so
// internal/mcp can accept a function value rather than importing the
// concrete package in its test fakes.
type FormatFunc func(results []types.SearchResult, store SubtreeProvider, query string) string

// FormatSearchResults renders the given results as a Markdown-flavoured
// string suitable for an MCP tool text response. The query is echoed
// into the header line. The function returns a human-readable "No
// results found" message when results is empty.
func FormatSearchResults(results []types.SearchResult, store SubtreeProvider, query string) string
```

## Key behaviors

- **Empty results return a friendly fallback string**, not an empty
  string. Format:
  `No results found for "<query>". Try broader terms or use list_documents to browse the catalog.`
  Matches `src/search-formatter.ts:33-35` verbatim.

- **Ranked snippet list format** for every result, exactly:

  ```
  <N>. [<doc_id>] <doc_title>
     Section: <node_title> (<node_id>)
     Score: <score formatted .1>[ | <badge1> | <badge2>]
     Snippet: <snippet>
  ```

  The badge is built by `buildFacetBadge` — `code: <lang1, lang2>` if
  `facets["code_languages"]` is non-empty, otherwise `has_code` if
  `facets["has_code"] == "true"`, followed by `has_links` if
  `facets["has_links"] == "true"`.

- **Full-content block for the top N results.** N is
  `InlineContentTopN = 3`. Each block starts with a divider
  `=== [<doc_id>] <label> ===` where `<label>` is either
  `<node_title> + <k> subsection(s)` when k > 0 or just `<node_title>`.
  Inside the block every subtree node is emitted as
  `<indent>#<level> <title> [<node_id>]\n<indent><content|"(empty)">`.
  Indent is `2*(level - root_level)` spaces.

- **Cross-reference line** after each full-content block, only when
  the doc's frontmatter lists references and at least one resolves.
  Format: `\n\n→ References: [doc1] (node1), [doc2], [doc3] (node3)`.
  Unresolved references are dropped silently — matches
  `src/search-formatter.ts:97-110`.

- **Header line ties it all together.** Final string is:
  `Search results for "<query>" (<N> matches):\n\n<snippet-list>`
  followed by `\n--- Full content (top <k> match[es]) ---\n\n<blocks>`
  when at least one content block exists. `k` is
  `min(len(results), InlineContentTopN)` and the "match"/"matches"
  pluralization depends on `k == 1`.

- **Zero allocations in the hot path is a non-goal.** Correctness and
  byte-exact parity with the TS formatter matter more than perf here.
  The output is bounded by `results.Limit * InlineContentTopN`
  subtrees, typically dozens of KB.

## Dependencies

- **stdlib:**
  - `strings` — `strings.Builder`, `strings.Repeat` for indentation,
    `strings.Join` for the references list.
  - `fmt` — `fmt.Sprintf` for every template row.
  - `math` — `math.Min` isn't used (we use Go's `if` form), but
    `strconv.FormatFloat` with `'f', 1` gives the `.toFixed(1)` parity.
- **third-party:** none.
- **internal:**
  - `internal/types` — `SearchResult`, `DocumentMeta`, `RefResolution`.

Notably *not* a dependency: `internal/store`. The formatter is
store-agnostic by interface, so tests don't have to build a full store
to exercise a rendering path.

## Relationship to TS source

Direct port of `src/search-formatter.ts` (111 lines). Function
boundaries:

- `formatSearchResults` (line 28) → `FormatSearchResults`.
- `buildFacetBadge` (line 88) → unexported `buildFacetBadge`.
- `buildRefLine` (line 97) → unexported `buildRefLine`.
- `SubtreeProvider` interface at line 4 → Go interface of the same
  name. Go's structural matching lets the real `DocumentStore` satisfy
  it without an explicit `implements` declaration.

Parity is enforced by a table-driven Phase B test that captures
rendered output from the TS formatter as `testdata/searchfmt/*.golden`
files and asserts the Go formatter's output is byte-identical.

## Non-goals

- **No HTML or color output.** Claude Desktop renders Markdown; any
  escaping is the client's problem. The formatter emits plain UTF-8
  with Markdown-style heading hashes.
- **No localization.** "No results found", "Search results for",
  "References" are all in English. Matches TS.
- **No truncation of long snippets.** The store already bounds snippet
  length at `max_snippet_length`. The formatter trusts it.
- **No caching.** Every call rebuilds the string. Rendering is cheap
  and the input changes every query.
- **No knowledge of MCP.** The formatter returns a string. Wrapping it
  in `{ content: [{ type: "text", text }] }` happens in `internal/mcp`.
