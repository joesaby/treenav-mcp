# Enhanced Search Formatter with Cross-References

## Problem

`treenav-mcp`'s `search_documents` tool returns snippet-only results, requiring the agent to make follow-up `get_node_content` calls to read actual content. `treenav-agent`'s `treenav-service` has a `search-formatter.ts` that inlines top-3 content, but it predates the cross-reference, auto-facet, and auto-glossary features added to `treenav-mcp`.

The two repos have diverged in both directions — this design merges the best of both and extends with cross-reference navigation.

## Goal

Reduce ReAct loop iterations by making `search_documents` output self-contained for the top matches, and actionable for related documents via cross-references.

## Design

### Output Structure

```
Search results for "webex calling setup" (5 matches):

1. [webex-calling] Provisioning Guide
   Section: User Licensing (node-123)
   Score: 9.2 | code: javascript
   Snippet: To provision a user...

2. [admin-guide] Admin Setup
   Section: Initial Configuration (node-45)
   Score: 7.1
   Snippet: ...

--- Full content (top 3 matches) ---

=== [webex-calling] User Licensing + 2 subsections ===

## User Licensing [node-123]
...full content...

  ### Trial Licenses [node-124]
  ...

→ References: [admin-guide] (node-45), [user-mgmt]
```

### Components

**1. Snippet list (all results)**
- Doc ID, title, section name + node ID, score
- Facet badges inline: `| code: javascript, python` or `| has_links` — only shown when present
- Keeps the list scannable without noise

**2. Inline content blocks (top 3 results)**
- Full subtree content for each top match (existing logic from `treenav-service`)
- Indented by heading level relative to the matched section root

**3. Cross-reference block (per inlined result)**
- `→ References: [doc_id] (node_id), [doc_id]` — appended after each inlined block
- File paths from `references[]` are resolved to doc IDs via a reverse map built at index time
- `node_id` included only when the URL fragment (`#heading`) can be matched to a node
- Unresolvable paths are omitted (not shown as dead-end paths)

### Store Interface Extension

```typescript
export interface SubtreeProvider {
  getSubtree(doc_id, node_id): { nodes: ... } | null;
  resolveRef(path: string): { doc_id: string; node_id?: string } | null;
}
```

`DocumentStore` implements `resolveRef` using a reverse map (`Map<string, {doc_id, node_id?}>`) built during `loadDocuments`. The key is the basename of the file path (e.g., `admin-guide.md`). Fragment resolution maps `#heading-slug` → node IDs via the document tree.

### `docnav.py` System Prompt Update

Add to navigation strategy item 1:

> Search results also include `→ References` lines listing doc IDs that the matched section explicitly links to. Use `navigate_tree(doc_id)` or `get_node_content(doc_id, node_id)` to follow them — they represent the author's intended navigation path and often contain complementary detail needed for a complete answer.

## Files Changed

- `treenav-mcp/src/search-formatter.ts` — new file (port + extend)
- `treenav-mcp/src/store.ts` — add `resolveRef()` + reverse map construction
- `treenav-mcp/src/tools.ts` — use `formatSearchResults` instead of inline formatting
- `treenav-mcp/src/types.ts` — no changes needed (references already on DocumentMeta)
- `aegra/graphs/docnav.py` — update system prompt navigation strategy

## Out of Scope

- Glossary in the formatter — better placed in query expansion inside `searchDocuments()`
- Reverse cross-refs (docs that link TO a result) — adds complexity, low ROI for now
- Syncing `treenav-service` from `treenav-mcp` — separate task
