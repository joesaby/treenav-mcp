# doctree-mcp Upgrade Spec

Backport the doc-navigation improvements from treenav-mcp into doctree-mcp.
This spec covers **only** the markdown/doc-side changes — no code-indexer,
no parsers/, no AST work.

---

## 1. types.ts — Add `references` field to DocumentMeta

**What changed:** treenav-mcp added a `references: string[]` field to `DocumentMeta`.

**What to do:**

```typescript
// In DocumentMeta, add after `facets`:
/** Cross-references: doc-relative paths extracted from markdown links */
references: string[];
```

Also add optional `code_collections` to `IndexConfig` (skip if you never plan to add code support):

```typescript
export interface IndexConfig {
  collections: CollectionConfig[];
  /** Optional code collections — source files indexed via AST parsing */
  code_collections?: CollectionConfig[];
  summary_length: number;
  max_depth: number;
}
```

**Files:** `src/types.ts`
**Risk:** Low. Additive field. Existing consumers ignore it.

---

## 2. indexer.ts — Four new extraction functions

### 2a. Better summary extraction (replace `text.slice(0, 200)`)

doctree-mcp uses `text.slice(0, 200)` for summaries. treenav-mcp extracts the
first complete sentence instead, giving agents a meaningful breadcrumb.

**Replace in `flushContent` and `buildTreeRegex`:**

```typescript
// OLD (doctree-mcp):
node.summary = text.slice(0, 200) + (text.length > 200 ? "…" : "");

// NEW:
node.summary = extractFirstSentence(text, 200);
```

**Add this function:**

```typescript
function extractFirstSentence(text: string, maxLen: number): string {
  if (!text || text.length === 0) return "";

  // Skip leading code blocks, tables, and list markers
  const cleaned = text
    .replace(/^\[code:\w*\].*$/m, "")
    .replace(/^\s*[-*•]\s*/m, "")
    .trim();
  if (!cleaned)
    return text.slice(0, maxLen) + (text.length > maxLen ? "…" : "");

  // First sentence boundary: period/question/exclamation followed by
  // whitespace or end-of-string, but not inside abbreviations
  const sentenceEnd = cleaned.search(/[.!?](?:\s|$)/);

  if (sentenceEnd !== -1 && sentenceEnd < maxLen) {
    return cleaned.slice(0, sentenceEnd + 1);
  }

  // No sentence boundary — fall back to word-boundary slice
  if (cleaned.length <= maxLen) return cleaned;
  const truncated = cleaned.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.6) {
    return truncated.slice(0, lastSpace) + "…";
  }
  return truncated + "…";
}
```

**Files:** `src/indexer.ts`
**Risk:** Low. Summaries get better, nothing else depends on exact format.

### 2b. Cross-reference extraction

Parse `[text](target.md)` links from markdown body to build a reference graph
between documents. External URLs and anchor-only links are skipped.

**Add these functions to `indexer.ts`:**

```typescript
function extractReferences(body: string, relPath: string): string[] {
  const refs = new Set<string>();
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(body)) !== null) {
    const target = match[2].split("#")[0].trim();
    if (!target) continue;
    if (/^https?:\/\//i.test(target)) continue;
    if (/^mailto:/i.test(target)) continue;
    if (target.startsWith("/")) {
      refs.add(target.replace(/^\//, ""));
    } else {
      const dir = relPath.includes("/")
        ? relPath.substring(0, relPath.lastIndexOf("/"))
        : "";
      const resolved = dir ? `${dir}/${target}` : target;
      refs.add(normalizePath(resolved));
    }
  }
  return [...refs];
}

function normalizePath(path: string): string {
  const parts = path.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === ".." && normalized.length > 0) {
      normalized.pop();
    } else if (part !== "..") {
      normalized.push(part);
    }
  }
  return normalized.join("/");
}
```

**Wire into `indexFile`:** Call `extractReferences(body, relPath)` and store
the result in `meta.references`.

**Files:** `src/indexer.ts`
**Risk:** Low. Additive data. Agents see it only if the formatter exposes it.

### 2c. Content facet auto-detection

Extract searchable facets from the content body itself (code block languages,
internal link presence), independent of frontmatter quality.

**Add to `indexer.ts`:**

```typescript
function extractContentFacets(body: string): Record<string, string[]> {
  const facets: Record<string, string[]> = {};

  const codeBlockRegex = /```(\w+)?/g;
  const languages = new Set<string>();
  let hasCode = false;
  let codeMatch;
  while ((codeMatch = codeBlockRegex.exec(body)) !== null) {
    hasCode = true;
    if (codeMatch[1]) languages.add(codeMatch[1].toLowerCase());
  }

  if (hasCode) facets["has_code"] = ["true"];
  if (languages.size > 0) facets["code_languages"] = [...languages].sort();

  const linkCount = (body.match(/\[[^\]]*\]\([^)]+\)/g) || []).filter(
    (m) => !/\]\(https?:\/\//i.test(m)
  ).length;
  if (linkCount > 0) facets["has_links"] = ["true"];

  return facets;
}
```

**Wire into `indexFile`:** After `extractFacets(frontmatter)`, merge content
facets:

```typescript
const contentFacets = extractContentFacets(body);
for (const [key, values] of Object.entries(contentFacets)) {
  if (!facets[key]) facets[key] = values;
}
```

**Files:** `src/indexer.ts`
**Risk:** Low. New facets appear in `list_documents` facet counts automatically.

### 2d. Auto-glossary extraction

Extract acronym definitions from content patterns like
`"CLI (Command Line Interface)"` without a manually maintained glossary.json.

**Add to `indexer.ts` (export it):**

```typescript
export function extractGlossaryEntries(
  text: string
): Record<string, string[]> {
  const entries: Record<string, string[]> = {};

  // Pattern 1: ACRONYM (Expansion)
  const acronymFirst =
    /\b([A-Z][A-Z0-9]{1,10})\s+\(([A-Z][a-zA-Z\s]{3,60})\)/g;
  let m;
  while ((m = acronymFirst.exec(text)) !== null) {
    const acronym = m[1];
    const expansion = m[2].trim().toLowerCase();
    if (!entries[acronym]) entries[acronym] = [];
    if (!entries[acronym].includes(expansion)) entries[acronym].push(expansion);
  }

  // Pattern 2: Expansion (ACRONYM)
  const expansionFirst =
    /([A-Z][a-zA-Z\s]{3,60})\s+\(([A-Z][A-Z0-9]{1,10})\)/g;
  while ((m = expansionFirst.exec(text)) !== null) {
    const expansion = m[1].trim().toLowerCase();
    const acronym = m[2];
    if (!entries[acronym]) entries[acronym] = [];
    if (!entries[acronym].includes(expansion)) entries[acronym].push(expansion);
  }

  // Pattern 3: ACRONYM — Expansion (em dash)
  const dashPattern =
    /\b([A-Z][A-Z0-9]{1,10})\s*[—–-]\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)(?:\s|[.,;]|$)/g;
  while ((m = dashPattern.exec(text)) !== null) {
    const acronym = m[1];
    const expansion = m[2].trim().toLowerCase();
    if (!entries[acronym]) entries[acronym] = [];
    if (!entries[acronym].includes(expansion)) entries[acronym].push(expansion);
  }

  return entries;
}
```

**Files:** `src/indexer.ts`
**Risk:** Low. Feeds into the glossary system that already exists.

---

## 3. store.ts — Three new methods + auto-glossary + ref map

### 3a. Add `refMap` and `buildRefMap()`

Maps `basename(file_path)` to `{ doc_id, tree }` for cross-reference resolution.

```typescript
// New private field:
private refMap: Map<string, { doc_id: string; tree: TreeNode[] }> = new Map();

// New private method:
private buildRefMap(): void {
  this.refMap.clear();
  for (const doc of this.docs.values()) {
    const basename =
      doc.meta.file_path.split("/").pop() ?? doc.meta.file_path;
    this.refMap.set(basename, { doc_id: doc.meta.doc_id, tree: doc.tree });
  }
}
```

Call `this.buildRefMap()` at the end of `load()`.

### 3b. Add `buildAutoGlossary()`

Scan all indexed content for acronym definitions and merge into the glossary.
Does NOT overwrite entries from an explicitly loaded glossary.json.

```typescript
// Import at top of store.ts:
import { extractGlossaryEntries } from "./indexer";

// New private method:
private buildAutoGlossary(documents: IndexedDocument[]): void {
  const autoEntries: Record<string, string[]> = {};

  for (const doc of documents) {
    for (const node of doc.tree) {
      const nodeEntries = extractGlossaryEntries(node.content);
      for (const [acronym, expansions] of Object.entries(nodeEntries)) {
        if (!autoEntries[acronym]) autoEntries[acronym] = [];
        for (const exp of expansions) {
          if (!autoEntries[acronym].includes(exp)) {
            autoEntries[acronym].push(exp);
          }
        }
      }
    }
    const metaEntries = extractGlossaryEntries(
      `${doc.meta.title} ${doc.meta.description}`
    );
    for (const [acronym, expansions] of Object.entries(metaEntries)) {
      if (!autoEntries[acronym]) autoEntries[acronym] = [];
      for (const exp of expansions) {
        if (!autoEntries[acronym].includes(exp)) {
          autoEntries[acronym].push(exp);
        }
      }
    }
  }

  // Merge without overwriting explicit glossary entries
  let added = 0;
  for (const [acronym, expansions] of Object.entries(autoEntries)) {
    const key = acronym.toLowerCase();
    if (!this.glossary.has(key)) {
      this.glossary.set(key, expansions);
      added++;
    }
  }
  if (added > 0) {
    console.log(`Auto-glossary: ${added} entries extracted from content`);
  }
}
```

Call `this.buildAutoGlossary(documents)` in `load()`, after `buildFilterIndex()`.

### 3c. Add `resolveRef()` public method

Resolve a markdown link path to a doc_id + optional node_id via heading slug matching.

```typescript
resolveRef(path: string): { doc_id: string; node_id?: string } | null {
  const [filePart, fragment] = path.split("#");
  const basename = filePart.split("/").pop() ?? filePart;
  const entry = this.refMap.get(basename);
  if (!entry) return null;

  if (!fragment) return { doc_id: entry.doc_id };

  const slug = fragment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const node = entry.tree.find((n) => {
    const nodeSlug = n.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return nodeSlug === slug || n.node_id === fragment;
  });

  return { doc_id: entry.doc_id, node_id: node?.node_id };
}
```

### 3d. Add `getDocMeta()` public method

```typescript
getDocMeta(doc_id: string): DocumentMeta | null {
  return this.docs.get(doc_id)?.meta ?? null;
}
```

### 3e. Add `getGlossaryTerms()` public method

```typescript
getGlossaryTerms(): string[] {
  return [...this.glossary.keys()];
}
```

**Update `load()` call order:**

```typescript
load(documents: IndexedDocument[]): void {
  // ... existing clear + population ...
  this.buildIndex();
  this.buildFilterIndex();
  this.buildAutoGlossary(documents);  // NEW
  this.buildRefMap();                   // NEW
  // ... existing log ...
}
```

**Files:** `src/store.ts`
**Risk:** Low. All additive. Existing methods untouched.

---

## 4. New file: `src/search-formatter.ts`

Formats search results for agent consumption with three improvements:
1. Facet badges on each result
2. Auto-inlines full subtree content for top 3 results (eliminates follow-up calls)
3. Appends resolved cross-references after each inlined block

**Create `src/search-formatter.ts`:**

```typescript
import type { SearchResult, TreeNode, DocumentMeta } from "./types.js";

export interface SubtreeProvider {
  getSubtree(
    doc_id: string,
    node_id: string
  ): {
    nodes: Pick<TreeNode, "node_id" | "title" | "level" | "content">[];
  } | null;
  resolveRef(path: string): { doc_id: string; node_id?: string } | null;
  getDocMeta(doc_id: string): DocumentMeta | null;
}

const INLINE_CONTENT_TOP_N = 3;

export function formatSearchResults(
  results: SearchResult[],
  store: SubtreeProvider,
  query: string
): string {
  if (results.length === 0) {
    return `No results found for "${query}". Try broader terms or use list_documents to browse the catalog.`;
  }

  // 1. Ranked snippet list
  const summary = results
    .map((r, i) => {
      const badge = buildFacetBadge(r.facets);
      return `${i + 1}. [${r.doc_id}] ${r.doc_title}\n   Section: ${r.node_title} (${r.node_id})\n   Score: ${r.score.toFixed(1)}${badge}\n   Snippet: ${r.snippet}`;
    })
    .join("\n\n");

  // 2. Full content blocks for top N
  const contentBlocks = results
    .slice(0, INLINE_CONTENT_TOP_N)
    .map((r) => {
      const subtree = store.getSubtree(r.doc_id, r.node_id);
      if (!subtree || subtree.nodes.length === 0) return null;

      const root = subtree.nodes[0];
      const formatted = subtree.nodes
        .map((n) => {
          const indent = "  ".repeat(Math.max(0, n.level - root.level));
          return `${indent}${"#".repeat(n.level)} ${n.title} [${n.node_id}]\n${indent}${n.content || "(empty)"}`;
        })
        .join("\n\n");

      const subsectionCount = subtree.nodes.length - 1;
      const label =
        subsectionCount > 0
          ? `${r.node_title} + ${subsectionCount} subsection(s)`
          : r.node_title;

      const meta = store.getDocMeta(r.doc_id);
      const refLine = buildRefLine(meta?.references ?? [], store);

      return `=== [${r.doc_id}] ${label} ===\n\n${formatted}${refLine}`;
    })
    .filter((b): b is string => b !== null);

  const parts = [
    `Search results for "${query}" (${results.length} matches):\n\n${summary}`,
  ];

  if (contentBlocks.length > 0) {
    const n = Math.min(results.length, INLINE_CONTENT_TOP_N);
    parts.push(
      `\n--- Full content (top ${n} match${n === 1 ? "" : "es"}) ---\n\n${contentBlocks.join("\n\n")}`
    );
  }

  return parts.join("\n");
}

function buildFacetBadge(facets: Record<string, string[]>): string {
  const parts: string[] = [];
  const langs = facets["code_languages"];
  if (langs?.length) parts.push(`code: ${langs.join(", ")}`);
  else if (facets["has_code"]?.[0] === "true") parts.push("has_code");
  if (facets["has_links"]?.[0] === "true") parts.push("has_links");
  return parts.length ? ` | ${parts.join(" | ")}` : "";
}

function buildRefLine(
  references: string[],
  store: SubtreeProvider
): string {
  if (!references.length) return "";

  const resolved = references
    .map((ref) => {
      const r = store.resolveRef(ref);
      if (!r) return null;
      return r.node_id ? `[${r.doc_id}] (${r.node_id})` : `[${r.doc_id}]`;
    })
    .filter((r): r is string => r !== null);

  if (!resolved.length) return "";
  return `\n\n→ References: ${resolved.join(", ")}`;
}
```

**Files:** `src/search-formatter.ts` (new)
**Risk:** None. New file.

---

## 5. Extract tools to `src/tools.ts`

doctree-mcp registers all 5 tools inline in `server.ts` (363 lines). Extract
them into a shared module so both stdio and HTTP transports share identical
tool implementations.

**Create `src/tools.ts`** with a single export:

```typescript
export function registerTools(
  server: McpServer,
  store: DocumentStore
): void {
  // Move all 5 tool registrations here
  // Wire search_documents to use formatSearchResults instead of manual formatting
}
```

**Update `server.ts`:**

```typescript
import { registerTools } from "./tools";
// ...
registerTools(server, store);
```

**Update `server-http.ts`** to use the same `registerTools`.

**Key change in search_documents tool:** Replace the manual result formatting
with `formatSearchResults(results, store, query)`.

**Update list_documents tool:** Add reference hints to output:

```typescript
// After tags line, add:
${d.references?.length
  ? `\n  links to: ${d.references.slice(0, 5).join(", ")}${d.references.length > 5 ? ` (+${d.references.length - 5} more)` : ""}`
  : ""}
```

**Files:** `src/tools.ts` (new), `src/server.ts` (shrink), `src/server-http.ts` (update)
**Risk:** Medium. Refactor — test before and after to confirm identical tool behavior.

---

## 6. Wiki curation toolset (optional, opt-in)

This is the largest addition. Three new MCP tools behind `WIKI_WRITE=1` that
let a calling agent author new documentation while doctree enforces safety.

### 6a. New file: `src/curator.ts`

Three functions, zero LLM calls:

| Function | Purpose |
|----------|---------|
| `findSimilar(store, content, options)` | BM25 dedupe check. Tokenizes content (200 unique terms max), searches store, computes overlap ratio (Jaccard lower-bound). Returns matches + `suggest_merge` flag. |
| `draftWikiEntry(store, wiki, input)` | Structural scaffold: suggested path, inferred frontmatter (type/category/tags from similar docs), glossary hits, backlinks, duplicate warning. Does NOT write. |
| `writeWikiEntry(store, wiki, input)` | Validated write: path containment → extension → existence → frontmatter schema → duplicate check → dry-run shortcut → disk write + incremental re-index. |

**Key types:**

```typescript
export interface WikiOptions {
  root: string;                    // Absolute path, writes confined here
  collectionName?: string;         // Default "docs"
  duplicateThreshold?: number;     // Default 0.35
}

export class CuratorError extends Error {
  constructor(
    public readonly code:
      | "PATH_ESCAPE" | "PATH_INVALID" | "EXISTS"
      | "FRONTMATTER_INVALID" | "DUPLICATE" | "WRITE_FAILED",
    message: string
  ) { ... }
}
```

**Validation in `writeWikiEntry`:**
1. Path must be relative, end in `.md`, resolve inside `wiki.root`
2. File must not exist (unless `overwrite=true`)
3. Frontmatter keys must match `/^[a-zA-Z][\w-]*$/`, values must be string/number/boolean/array, no newlines
4. Duplicate overlap must be below threshold (unless `allow_duplicate=true`)
5. `dry_run=true` returns validation result without touching disk

**Files:** `src/curator.ts` (new, ~640 lines)
**Risk:** Medium. Introduces writes. Path containment validation is critical.

### 6b. New env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `WIKI_WRITE` | *(unset)* | Set to `1` to enable curation tools |
| `WIKI_ROOT` | `$DOCS_ROOT` | Filesystem root for writes |
| `WIKI_DUPLICATE_THRESHOLD` | `0.35` | Overlap ratio for duplicate warning |

### 6c. Register curation tools in `tools.ts`

Add conditional registration:

```typescript
export function registerTools(
  server: McpServer,
  store: DocumentStore,
  options?: { wiki?: WikiOptions }
): void {
  // ... existing 5 read tools ...

  if (options?.wiki) {
    registerCurationTools(server, store, options.wiki);
  }
}
```

Three new tools:
- **`find_similar`** — Takes `content` string, returns JSON with matches + overlap ratios
- **`draft_wiki_entry`** — Takes `topic` + `raw_content`, returns JSON scaffold
- **`write_wiki_entry`** — Takes `path` + `frontmatter` + `content`, validates and writes

### 6d. Wire into `server.ts`

```typescript
import type { WikiOptions } from "./curator";

let wiki: WikiOptions | undefined;
if (process.env.WIKI_WRITE === "1") {
  const wikiRoot = resolve(process.env.WIKI_ROOT || docs_root);
  wiki = {
    root: wikiRoot,
    collectionName: "docs",
    duplicateThreshold: parseFloat(
      process.env.WIKI_DUPLICATE_THRESHOLD || "0.35"
    ),
  };
}

registerTools(server, store, { wiki });
```

**Files:** `src/curator.ts`, `src/tools.ts`, `src/server.ts`, `src/server-http.ts`
**Risk:** Medium. Write-side feature behind explicit opt-in.

---

## 7. `inferTypeFromPath` — export it

doctree-mcp keeps `inferTypeFromPath` private. treenav-mcp exports it because
the curator uses it to infer type facets for drafted entries.

**Change:** `function inferTypeFromPath` → `export function inferTypeFromPath`

**Files:** `src/indexer.ts`
**Risk:** None.

---

## Implementation Order

Recommended sequence — each step is independently shippable:

| Phase | Changes | Effort |
|-------|---------|--------|
| **1** | `extractFirstSentence` (better summaries) | Small — drop-in replacement |
| **2** | `references` field + `extractReferences` + `extractContentFacets` in indexer | Small — additive data |
| **3** | `extractGlossaryEntries` + `buildAutoGlossary` + `buildRefMap` in store | Small — additive behavior |
| **4** | `resolveRef`, `getDocMeta`, `getGlossaryTerms` store methods | Small — 3 simple methods |
| **5** | Extract `tools.ts` + add `search-formatter.ts` | Medium — refactor, need tests |
| **6** | `curator.ts` + wiki curation toolset | Medium — new feature, need tests |

Phases 1-4 are safe incremental changes (each under 50 lines of new code).
Phase 5 is a refactor that improves agent UX. Phase 6 is a new feature.

---

## Test Plan

| Phase | Tests to add |
|-------|-------------|
| 1 | Unit test `extractFirstSentence` with code blocks, lists, long text, empty text |
| 2 | Unit test `extractReferences` with relative/absolute paths, external URLs, anchors. Unit test `extractContentFacets` with code blocks, mixed languages, links |
| 3 | Integration test: index docs with inline acronyms, verify glossary populated |
| 4 | Unit test `resolveRef` with basename, fragment, missing file |
| 5 | Integration test: `search_documents` returns formatted output with facet badges, inlined content, cross-references. Snapshot test recommended. |
| 6 | See existing `tests/curator.test.ts` in treenav-mcp for comprehensive coverage: path containment, frontmatter validation, duplicate detection, dry_run, overwrite, incremental re-index |
