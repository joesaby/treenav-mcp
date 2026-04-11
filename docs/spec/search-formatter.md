# Spec: Search Formatter

**Feature doc:** [../features/search-formatter.md](../features/search-formatter.md)
**TS source:** `src/search-formatter.ts`
**Go package:** `internal/searchfmt`

## Scope

This spec is authoritative for the exact Markdown string produced by
`FormatSearchResults` given a slice of `types.SearchResult` and a store
that satisfies `SubtreeProvider`. Parity is enforced byte-for-byte via
golden files captured from the TS formatter. The spec does **not**
govern the contents of `SearchResult`, `DocumentMeta`, or the store's
cross-ref resolver — those are `docs/spec/bm25-engine.md` and
`docs/spec/markdown-indexer.md`.

Phase B covers this spec via:

- A table-driven rendering test with one row per fixture in
  `testdata/searchfmt/`.
- A byte-exact golden-file comparison against `*.golden` outputs
  captured from the TS formatter.
- A stub `SubtreeProvider` test that exercises every branch (empty
  result, no matches, one match, three matches, references absent /
  present / unresolved).

## Types

```go
package searchfmt

import "github.com/treenav/treenav-mcp/internal/types"

const InlineContentTopN = 3

type SubtreeProvider interface {
    GetSubtree(docID, nodeID string) (*SubtreeView, bool)
    ResolveRef(path string) (types.RefResolution, bool)
    GetDocMeta(docID string) (types.DocumentMeta, bool)
}

type SubtreeView struct {
    Nodes []SubtreeNode // never nil; empty means "subtree exists but empty"
}

type SubtreeNode struct {
    NodeID  string
    Title   string
    Level   int
    Content string
}

type FormatFunc func(results []types.SearchResult, store SubtreeProvider, query string) string

func FormatSearchResults(results []types.SearchResult, store SubtreeProvider, query string) string
```

## Functions

### FormatSearchResults

**Signature:** `func FormatSearchResults(results []types.SearchResult, store SubtreeProvider, query string) string`

**Preconditions:**

- `results` may be empty or non-empty; nil is tolerated.
- `store` must be non-nil when `len(results) > 0`.
- `query` is the user's original query string, echoed in the header.

**Behavior:**

1. **Empty results** (`len(results) == 0`): return
   `No results found for "<query>". Try broader terms or use list_documents to browse the catalog.`
   and return. (Matches `src/search-formatter.ts:33-35`.)

2. **Ranked snippet list**: for each `results[i]`, in order, emit:

   ```
   <i+1>. [<doc_id>] <doc_title>
      Section: <node_title> (<node_id>)
      Score: <score, 1 decimal><badge>
      Snippet: <snippet>
   ```

   - Score formatting: `strconv.FormatFloat(score, 'f', 1, 64)`. This
     reproduces TS `.toFixed(1)`.
   - `<badge>` is produced by `buildFacetBadge(r.Facets)` (see below).
     Empty badge contributes an empty string; non-empty badge is
     preceded by ` | `.
   - Rows joined by `\n\n`.

3. **Full-content blocks**: for `results[0 .. min(len(results), 3)]`:

   a. Call `store.GetSubtree(r.DocID, r.NodeID)`. On `ok=false` skip
      this result entirely (do NOT emit an empty block).
   b. On empty `subtree.Nodes` skip.
   c. Let `root := subtree.Nodes[0]`.
   d. For each node in the subtree, emit:

      ```
      <indent>#<level> <title> [<node_id>]
      <indent><content or "(empty)">
      ```

      where `indent = strings.Repeat("  ", max(0, node.Level - root.Level))`
      and `<level>` is `strings.Repeat("#", node.Level)`.
   e. Rows joined by `\n\n`.
   f. Compute `subsectionCount := len(subtree.Nodes) - 1`.
   g. Compute `label`:
      - If `subsectionCount > 0`: `<r.NodeTitle> + <subsectionCount> subsection(s)`
      - Else: `r.NodeTitle`.
   h. Compute the cross-reference line via `buildRefLine(...)`.
   i. Assemble block as
      `=== [<r.DocID>] <label> ===\n\n<formatted><refLine>`.

4. **Final assembly**:

   a. `header := "Search results for \"<query>\" (<N> matches):\n\n<snippetList>"`
      where `<N>` is `len(results)`.
   b. If at least one content block was produced, let
      `k := min(len(results), InlineContentTopN)`, and let
      `suffix := "\n--- Full content (top <k> match" + (if k!=1 "es") + ") ---\n\n<blocks joined by \\n\\n>"`.
   c. Return `header + suffix` (or just `header` when no blocks).

**Postconditions:** returned string is deterministic given the same
inputs. No timestamps, no random ordering, no map iteration order.

**Errors:** none. The function does not return an error; unresolved
subtrees and refs are silently elided.

**Edge cases:**

- Result with empty `Snippet` → `Snippet: ` (empty value printed).
- `SubtreeProvider.GetSubtree` returns `ok=true` with `Nodes = []` →
  block is skipped (matches TS `subtree.nodes.length === 0` branch).
- Node with empty `Content` → rendered as `(empty)`.
- `InlineContentTopN > len(results)` → inlines only as many as exist.
- Result with `Facets == nil` → `buildFacetBadge` returns empty
  string; no extra `|` is emitted.
- Query string containing special chars (quotes, angle brackets) is
  echoed raw; no escaping. Matches TS.

**Parity requirements:**

- Byte-exact match with TS output on every fixture.
- Score formatting must reproduce `.toFixed(1)` including negative
  zero (`-0.0` → `-0.0`, per Go default).
- Whitespace (including trailing newlines, separator spacing, and
  indent widths) is load-bearing and under golden-file control.

**Test requirements unit:**

- Empty results → fallback string.
- One result, no subtree → header + snippet list, no content block.
- One result, subtree with root only → header + snippet + one block
  with no subsections, label is `<title>`.
- Three results, each with subtree → header + snippet list +
  three content blocks, inline suffix present.
- Five results → only three content blocks despite list length.
- Result with `has_code=true` → badge includes `has_code`.
- Result with `code_languages=["go","rust"]` → badge includes
  `code: go, rust` (comma+space separator).
- Result with `has_links=true` and `has_code=true` → badge has both,
  pipe-separated.
- Doc with `references: ["./a.md"]` that resolves → `→ References: [doc-a]`.
- Doc with `references: ["./missing.md"]` that does NOT resolve →
  no reference line at all.
- Doc with `references: []` → no reference line.

**Test requirements e2e:**

- Full MCP round-trip via `search_documents` on a fixture corpus;
  the returned `text` content must match the golden file.

### buildFacetBadge (unexported)

**Signature:** `func buildFacetBadge(facets map[string][]string) string`

**Preconditions:** `facets` may be nil or empty.

**Behavior:**

1. If `facets["code_languages"]` is non-empty, push
   `"code: " + strings.Join(langs, ", ")` onto a parts slice.
2. Else if `facets["has_code"]` is `["true"]`, push `"has_code"`.
3. If `facets["has_links"]` is `["true"]`, push `"has_links"`.
4. If `len(parts) == 0` return `""`.
5. Else return `" | " + strings.Join(parts, " | ")`.

**Postconditions:** return value starts with ` | ` or is empty.

**Parity requirements:** the `else if` between `code_languages` and
`has_code` must be preserved — if both are set, `code_languages` wins
and `has_code` is NOT additionally emitted. Matches
`src/search-formatter.ts:90-93`.

### buildRefLine (unexported)

**Signature:** `func buildRefLine(references []string, store SubtreeProvider) string`

**Preconditions:** `references` may be nil or empty.

**Behavior:**

1. If `len(references) == 0` return `""`.
2. For each `ref` in `references`, call `store.ResolveRef(ref)`.
3. On `ok=false` skip (drop unresolved refs silently).
4. On `ok=true` with empty `NodeID`: emit `[<doc_id>]`.
5. On `ok=true` with non-empty `NodeID`: emit `[<doc_id>] (<node_id>)`.
6. If the resolved list is empty return `""`.
7. Else return `"\n\n→ References: " + strings.Join(resolved, ", ")`.

**Postconditions:** return value is either `""` or starts with
`"\n\n→ References: "`.

**Parity requirements:** the two-newline prefix is load-bearing; it
produces the blank-line separation in Markdown that TS renders
identically.

## Invariants

1. **Determinism.** Same input, same output, no exceptions. No
   iteration over `map[string]T` without an explicit sort.
2. **Empty-array rendering.** Any array fields pulled off
   `SearchResult` / `DocumentMeta` must already have been
   `make([]T, 0)`-initialized by the store. The formatter assumes
   this and does not defensively coerce nils.
3. **No allocation budget.** Not a perf target. Correctness and
   byte-exact parity trump any perf optimization.
4. **`InlineContentTopN` is a constant, not a parameter.** If we ever
   want to make it configurable, that is a new ADR.
5. **No side effects.** No logging, no filesystem, no network. The
   function is a pure `(inputs) → string`.

## Concurrency

- `FormatSearchResults` is safe to call from any goroutine as long
  as the `SubtreeProvider` it closes over is safe. In production the
  provider is `*store.DocumentStore`, which is safe under `RLock`.
- The formatter itself allocates string builders per call; no shared
  state.

## Fixture data

Located in `testdata/searchfmt/`:

- `empty.golden` — zero results.
- `single-no-subtree.golden` — one result, `GetSubtree` returns
  `ok=false`.
- `single-with-subtree.golden` — one result, subtree of three
  nodes, badge empty.
- `three-full.golden` — three results, each with a subtree,
  cross-refs present on the second.
- `five-results.golden` — five results, only three inlined.
- `code-facet.golden` — result with `code_languages=["go","rust"]`.
- `has-code-has-links.golden` — result with both has_code=true and
  has_links=true.
- `unresolved-refs.golden` — doc meta has refs but none resolve.
- `mixed-refs.golden` — two refs resolve, one does not.
- `quoted-query.golden` — query contains escaped quote and newline;
  formatter echoes raw.

Each fixture pairs a `*.input.json` (results + meta snapshot) with a
`*.golden` (expected output). The test suite loads both, calls the
formatter with a stub provider, and asserts byte equality.

Fixtures are regenerated from the TS formatter by running
`bun run scripts/dump-fixtures.ts searchfmt`. Regeneration is a
conscious act that requires a commit message explaining the drift.
