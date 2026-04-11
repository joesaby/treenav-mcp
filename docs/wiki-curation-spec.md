# Wiki Curation Toolset — Specification

**Status:** Draft
**Target implementation:** `src/curator.ts`, `src/server.ts`, `src/store.ts`
**Date:** 2026-04-11
**ADR:** [adr/0001-llm-curated-wiki.md](./adr/0001-llm-curated-wiki.md)

---

## 1. Goals

This spec defines the write-side toolset that lets an MCP-calling agent
curate a Karpathy-style markdown wiki using treenav-mcp's existing
structural primitives. The goals are:

1. **Enable Karpathy-style curation** — raw input in, structured,
   deduped, cross-linked markdown out.
2. **Preserve "zero LLM calls" inside treenav-mcp** — all intelligence
   stays in the calling agent.
3. **Fail safely** — no write path is reachable without opt-in, no write
   escapes `DOCS_ROOT`, every write is git-trackable.
4. **Stay fast** — the curation round trip (dedupe check → draft →
   write → re-index) stays under 100ms for typical entries.

Non-goals:

- Embedding an LLM client inside treenav-mcp.
- Ingesting non-markdown raw sources (PDFs, HTML). Those belong in a
  sibling tool or in the calling agent.
- Semantic deduplication (treenav continues to use BM25 overlap; this
  is a known gap — see ADR 0001).
- Auto-committing to git.

---

## 2. Activation

The entire curation surface is gated behind a single environment variable.

```bash
WIKI_WRITE=1                    # required; off by default
WIKI_ROOT=./docs                # defaults to DOCS_ROOT
WIKI_DUPLICATE_THRESHOLD=0.35   # overlap ratio above which writes warn
```

When `WIKI_WRITE` is unset or `0`, the curation tools MUST NOT be
registered with the MCP server. The read-only posture is preserved by
default.

When `WIKI_WRITE=1`:

- The six existing read tools remain unchanged.
- The five curation tools (§4) are registered.
- `src/server.ts` logs a startup warning: `[wiki-write] write mode enabled; DOCS_ROOT is mutable`.

---

## 3. Reserved frontmatter keys

The following additional keys are reserved (not used as facets) to
support source attribution on curated entries:

| Key | Type | Meaning |
|---|---|---|
| `source_url` | string | Canonical URL of the raw source |
| `source_title` | string | Title of the raw source at capture time |
| `captured_at` | ISO8601 string | When curation wrote the entry |
| `curator` | string | Identifier of the agent/user that curated |

These join the existing reserved set (`title`, `description`, `layout`,
`permalink`, `slug`, `draft`, `date`) documented in `CLAUDE.md`.

---

## 4. Tools

### 4.1 `find_similar`

Dedupe check. Runs arbitrary text through the existing BM25 engine and
returns top-N overlapping entries.

**Input:**
```ts
{
  content: string;          // prospective entry body (may include frontmatter)
  limit?: number;           // default 5
  threshold?: number;       // 0..1, default 0.1 — omit lower-scored hits
  collection?: string;      // restrict to one collection
}
```

**Output:**
```ts
{
  matches: Array<{
    node_id: string;
    path: string;
    title: string;
    score: number;          // raw BM25 score
    overlap: number;        // normalized 0..1, score / self_score_ceiling
    snippet: string;        // density-based excerpt
  }>;
  tokens_analyzed: number;
  suggest_merge: boolean;   // true if any match.overlap >= WIKI_DUPLICATE_THRESHOLD
}
```

**Implementation:** reuses `DocumentStore.search()` with the input text
as query. `overlap` normalizes against the maximum achievable score for
the tokenized input (self-score) so the result is comparable across
inputs of different lengths.

**Errors:** none expected; empty content returns empty matches.

---

### 4.2 `draft_wiki_entry`

Produces a structural scaffold for a new entry. Does **not** write
anything. The calling agent fills in the body using its own LLM.

**Input:**
```ts
{
  topic: string;            // short handle, used for path slug and title
  raw_content: string;      // the source material to be distilled
  suggested_path?: string;  // agent hint; tool may override for safety
  collection?: string;      // defaults to default collection
}
```

**Output:**
```ts
{
  suggested_path: string;   // resolved absolute-like path under DOCS_ROOT
  frontmatter: {
    title: string;
    description?: string;   // null if agent should fill
    type?: string;          // inferred from directory or related entries
    category?: string;      // inferred from top facet of related entries
    tags: string[];         // top tag-facet hits from related entries
    source_url?: string;    // echoed if present in raw_content metadata
    captured_at: string;    // ISO8601 now
  };
  backlinks: Array<{
    node_id: string;
    title: string;
    score: number;
    reason: "shared_tag" | "bm25" | "shared_category";
  }>;
  glossary_hits: string[];  // known abbreviations found in raw_content
  duplicate_warning?: {
    node_id: string;
    overlap: number;
  };
}
```

**Behavior:**

1. Tokenize `raw_content`, run `find_similar` internally.
2. If top match ≥ `WIKI_DUPLICATE_THRESHOLD`, populate `duplicate_warning`.
3. Infer `type` from `suggested_path` directory (reuses existing
   auto-inference — see `CLAUDE.md` "Frontmatter Best Practices").
4. Infer `category` and `tags` by aggregating facets across the top
   related entries (simple frequency count; top 3 tags).
5. Resolve `suggested_path`:
   - If agent provided one, validate it is inside `DOCS_ROOT` and does
     not already exist.
   - Otherwise synthesize from `topic` + inferred `type` directory.
6. Scan `raw_content` for known glossary terms (reuses existing
   glossary index).
7. Return the scaffold. **No disk writes.**

---

### 4.3 `write_wiki_entry`

The only tool that touches disk. Performs the actual write after
validating path, frontmatter, and duplicate risk.

**Input:**
```ts
{
  path: string;             // relative to DOCS_ROOT
  frontmatter: Record<string, unknown>;
  content: string;          // markdown body (no frontmatter fence)
  dry_run?: boolean;        // default false
  allow_duplicate?: boolean;// default false — required to override warning
  overwrite?: boolean;      // default false — required to replace existing file
}
```

**Output:**
```ts
{
  written: boolean;         // false if dry_run
  path: string;             // resolved final path
  node_id: string;          // new top-level node ID after re-index
  bytes: number;
  reindex_ms: number;
  duplicate_warning?: {
    node_id: string;
    overlap: number;
  };
  validation: {
    frontmatter_ok: boolean;
    reserved_keys_ok: boolean;
    path_ok: boolean;
  };
}
```

**Validation order (fail fast):**

1. **Path containment.** Resolve `path` against `DOCS_ROOT` (or
   `WIKI_ROOT`). Reject if the resolved real path escapes the root
   (symlink-aware). Reject absolute paths and `..` components.
2. **Extension.** Must end in `.md`.
3. **Existence / overwrite.** If file exists and `overwrite !== true`,
   reject.
4. **Frontmatter schema.**
   - Reject unknown top-level types (must be object).
   - Reject reserved keys being misused (e.g., `date` must be ISO
     string).
   - Warn-only on missing recommended keys (`title`, `description`,
     `tags`).
5. **Duplicate check.** Run `find_similar` on `content`. If max
   `overlap ≥ WIKI_DUPLICATE_THRESHOLD` and `allow_duplicate !== true`,
   reject with the offending `node_id`.
6. **Dry run short-circuit.** If `dry_run`, return the result object
   without writing or re-indexing.
7. **Write.** Serialize frontmatter as YAML, write file via `Bun.write`.
8. **Incremental re-index.** Call the existing content-hash path in
   `store.ts` to index only the new/changed file. Return the new
   node ID.

**Errors:**

- `PATH_ESCAPE` — resolved path outside root
- `EXISTS` — file exists and `overwrite=false`
- `FRONTMATTER_INVALID` — schema violation
- `DUPLICATE` — overlap above threshold without `allow_duplicate=true`
- `WRITE_FAILED` — filesystem error (propagated)

---

### 4.4 `suggest_backlinks`

Given an existing node, returns candidate entries that should link back
to it. Purely advisory — makes no edits.

**Input:**
```ts
{
  node_id: string;
  limit?: number;           // default 5
}
```

**Output:**
```ts
{
  node: { id: string; title: string; path: string };
  candidates: Array<{
    node_id: string;
    title: string;
    path: string;
    score: number;
    reason: "bm25" | "shared_tag" | "shared_category";
    already_linked: boolean;  // true if target already contains path/link to source
  }>;
}
```

**Behavior:**

1. Load node content and title.
2. Use title + leading paragraph as a BM25 query against the rest of
   the index.
3. For each candidate, check whether its markdown body already contains
   a link to the source path (simple substring match).
4. Return ranked list excluding already-linked entries (unless the
   agent explicitly asks to include them via a future `include_linked`
   flag).

The agent uses this list to decide which *other* files to edit (via its
own filesystem tool or a follow-up `write_wiki_entry` call on the
target file).

---

### 4.5 `update_glossary`

Appends or updates entries in `glossary.json`. Keeps vocabulary
expansion current as new abbreviations enter the wiki.

**Input:**
```ts
{
  term: string;
  definitions: string[];    // alternative expansions
  replace?: boolean;        // default false — merge with existing
}
```

**Output:**
```ts
{
  path: string;             // resolved glossary.json path
  term: string;
  definitions: string[];    // final merged set
  added: boolean;           // true if term was new
}
```

**Behavior:**

1. Resolve glossary path (`GLOSSARY_PATH` or `$DOCS_ROOT/glossary.json`).
2. Load existing JSON (or create `{}`).
3. Merge or replace per `replace` flag; deduplicate definitions.
4. Write back atomically (write to tmp + rename).
5. Reload glossary in the store so subsequent searches pick up the new
   term.

**Validation:**

- `term` must be 1–64 chars, no newlines.
- `definitions` must be a non-empty array of strings.
- Reject if glossary file exists but is not valid JSON (agent must fix
  it manually — don't auto-repair).

---

### 4.6 `merge_entries` *(post-MVP)*

Returns a side-by-side merge proposal for two entries. Does not write.
The agent performs the semantic merge using its LLM, then calls
`write_wiki_entry` on the target and (optionally) a future
`delete_wiki_entry` on the source.

Deferred until MVP (tools 4.1–4.5) is validated by real use.

---

## 5. Data-flow diagram

```
┌─────────────────────┐
│   Calling agent     │  (Claude Desktop / Claude Code / etc.)
│  (owns the LLM)     │
└──────────┬──────────┘
           │
   1. find_similar(raw)
           ▼
┌─────────────────────┐
│  treenav-mcp        │
│  BM25 engine        │───► returns top-N existing entries
└──────────┬──────────┘
           │
   2. draft_wiki_entry(topic, raw)
           ▼
┌─────────────────────┐
│  treenav-mcp        │
│  scaffold builder   │───► returns frontmatter + backlinks (no write)
└──────────┬──────────┘
           │
   3. [AGENT's LLM writes the markdown body]
           │
   4. write_wiki_entry(path, frontmatter, content)
           ▼
┌─────────────────────┐
│  treenav-mcp        │
│  validator + writer │───► writes file, incrementally re-indexes
│                     │     returns new node_id
└──────────┬──────────┘
           │
   5. suggest_backlinks(new_node_id)
           ▼
┌─────────────────────┐
│  treenav-mcp        │───► returns candidate entries to edit
└─────────────────────┘
           │
   6. [AGENT edits candidates via its own filesystem tool
       or follow-up write_wiki_entry calls]
```

---

## 6. File layout

```
src/
├── curator.ts              # NEW — write-path logic, validation, scaffolding
├── server.ts               # MODIFIED — register curation tools when WIKI_WRITE=1
├── store.ts                # MODIFIED — expose addDocument()/reindexOne() publicly
├── indexer.ts              # MODIFIED — extract tag/type inference helper
├── types.ts                # MODIFIED — add WikiDraft, WriteResult, SimilarityMatch
└── parsers/                # UNCHANGED
tests/
├── curator.test.ts         # NEW — unit tests for each tool
└── curator-e2e.test.ts     # NEW — round trip: find_similar → draft → write → search
docs/
├── adr/0001-llm-curated-wiki.md    # existing — decision record
└── wiki-curation-spec.md           # this file
CLAUDE.md                   # MODIFIED — document WIKI_WRITE, new reserved keys, new tools
README.md                   # MODIFIED — add curation tools to MCP Tools table
```

Estimated net: one new source file (~250 lines), one new test file
(~200 lines), edits in four existing source files (small).

---

## 7. Guardrails

1. **Opt-in.** `WIKI_WRITE=1` required. The tools do not exist on the
   MCP surface otherwise.
2. **Path containment.** Every write validates the resolved real path
   is inside `WIKI_ROOT` (or `DOCS_ROOT`). Symlinks are followed and
   re-validated.
3. **No silent overwrites.** `overwrite=true` required to replace an
   existing file. Agents SHOULD prefer `dry_run=true` on first call.
4. **Duplicate guard.** Above `WIKI_DUPLICATE_THRESHOLD`, writes require
   `allow_duplicate=true`.
5. **Git-as-undo.** The README curation section will strongly recommend
   keeping `DOCS_ROOT` under version control. treenav does not commit
   for the user.
6. **No external calls.** The curation code MUST NOT make network
   calls, spawn subprocesses, or read files outside `DOCS_ROOT` /
   `WIKI_ROOT` / `GLOSSARY_PATH`.
7. **Atomic glossary writes.** `update_glossary` writes to a temp file
   and renames, so a crash mid-write cannot corrupt `glossary.json`.
8. **No LLM calls.** Reiterating the ADR: treenav-mcp performs zero LLM
   inference in any curation code path. All tool outputs are
   deterministic functions of the current index state.

---

## 8. Testing strategy

### 8.1 Unit tests (`tests/curator.test.ts`)

- `find_similar` returns empty for empty content; returns sorted
  matches for overlapping content; respects `threshold` and `limit`.
- `draft_wiki_entry` produces correct `type` inference for
  `runbooks/*`, `guides/*`, etc.; returns duplicate warning when
  appropriate; resolves `suggested_path` defensively.
- `write_wiki_entry`:
  - rejects paths outside root
  - rejects non-`.md` extensions
  - rejects existing files without `overwrite=true`
  - rejects duplicates without `allow_duplicate=true`
  - honors `dry_run=true` (no file written, no re-index)
  - triggers incremental re-index on success
- `suggest_backlinks` excludes already-linked candidates.
- `update_glossary` merges, dedupes, and handles missing file.

### 8.2 End-to-end (`tests/curator-e2e.test.ts`)

Full round trip against a tmp `DOCS_ROOT`:

1. Seed index with 5 sample docs.
2. Call `find_similar` on a known-novel topic → expect no high-overlap
   hits.
3. Call `draft_wiki_entry` → expect reasonable scaffold.
4. Call `write_wiki_entry` → expect file on disk and node in index.
5. Call `search_documents` (existing tool) for the new title → expect
   the new entry in results.
6. Call `suggest_backlinks` on the new node → expect at least one
   candidate.
7. Call `update_glossary` and re-run `search_documents` with the new
   term → expect expansion to pick it up.

### 8.3 Negative tests

- `WIKI_WRITE` unset → curation tools are not present in `tools/list`.
- Path traversal attempts (`../../etc/passwd`, symlink to `/tmp`) →
  `PATH_ESCAPE`.
- Malformed glossary JSON → tool errors without truncating the file.

---

## 9. Performance budget

| Operation | Target | Notes |
|---|---|---|
| `find_similar` on 900-doc index | < 30ms | Reuses existing BM25 path |
| `draft_wiki_entry` | < 40ms | `find_similar` + facet aggregation |
| `write_wiki_entry` (10KB entry) | < 80ms | Write + incremental re-index |
| `suggest_backlinks` | < 30ms | One BM25 query + substring scan |
| `update_glossary` | < 10ms | Small JSON + atomic rename |

Full round trip (find → draft → write → backlinks) should stay under
**200ms** for typical entries on a 900-doc index.

---

## 10. Rollout plan

### MVP (ships first)

- Tools: `find_similar`, `draft_wiki_entry`, `write_wiki_entry` (with
  dry-run).
- Guardrails: `WIKI_WRITE` gate, path containment, duplicate threshold,
  reserved frontmatter keys.
- Docs: update `CLAUDE.md` and `README.md`; mark this spec
  "Implemented — MVP" and link to the commit.
- Tests: unit + one round-trip e2e.

### Phase 2

- `suggest_backlinks`, `update_glossary`.
- Documentation example: a full curation walkthrough in `docs/`.

### Phase 3 (reassess)

- `merge_entries`, `delete_wiki_entry`.
- Decide based on real-world feedback whether the full dedupe loop is
  worth the additional complexity.

Stop conditions:

- If MVP feedback indicates BM25-based dedupe is insufficient in
  practice → revisit the semantic-dedupe gap called out in the ADR
  (options: ship QMD-style local embeddings as a separate tool, or
  accept the limitation and document workarounds).
- If no users opt into `WIKI_WRITE=1` within a reasonable window →
  treat the curation layer as experimental and freeze further
  investment.

---

## 11. Open questions

1. **Multi-wiki support.** Should `WIKI_ROOT` accept multiple roots
   (one per collection) or just one? Leaning toward one for MVP.
2. **Auto-`git add`.** Nice UX, but introduces a side effect. Deferred
   to Phase 2 behind its own flag (`WIKI_GIT_ADD=1`) if users ask.
3. **Scheduled curation.** Karpathy's concept implies *continuous*
   curation. That's an agent-harness concern (cron + Claude Code
   invocation), not something treenav should own. Document the pattern
   in README; do not build it into the server.
4. **PDF / HTML ingestion.** Out of scope per §1 non-goals. If demand
   appears, a sibling tool (`treenav-capture`?) is the right home,
   feeding markdown into `WIKI_ROOT` for treenav to curate.
5. **Conflict resolution when two agents write concurrently.** Not
   handled in MVP; treenav is single-process. If this becomes real,
   add a per-file mutex and optimistic hash check.

---

## 12. Acceptance criteria (MVP)

A PR implementing this spec is mergeable when:

- [ ] `WIKI_WRITE=0` (or unset) → zero behavioral change vs. today.
- [ ] `WIKI_WRITE=1` → `find_similar`, `draft_wiki_entry`,
      `write_wiki_entry` appear in `tools/list`.
- [ ] All tests in `tests/curator.test.ts` and
      `tests/curator-e2e.test.ts` pass.
- [ ] Path-escape attempts are rejected in unit tests.
- [ ] A dry-run `write_wiki_entry` does not touch disk.
- [ ] A successful write triggers incremental re-index and the new
      entry is immediately searchable via `search_documents`.
- [ ] `CLAUDE.md` lists `WIKI_WRITE`, the new reserved frontmatter
      keys, and the new tools.
- [ ] `README.md` "MCP Tools" table lists the new tools with a note
      that they require `WIKI_WRITE=1`.
- [ ] No new runtime dependencies (`package.json` unchanged or only
      adds dev-deps).
- [ ] No LLM client, HTTP client, or subprocess invocation appears in
      `src/curator.ts`.
