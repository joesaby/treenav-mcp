# Design — compile_context: composed retrieval primitive

**Date:** 2026-05-06
**Status:** Design approved; pending implementation plan
**Author:** brainstormed in response to Pinecone Nexus / KnowQL announcement (May 2026)
**Related:**
- [docs/adr/0002-multi-intent-out-of-scope.md](../../adr/0002-multi-intent-out-of-scope.md) — multi-intent rejection
- [docs/adr/0001-llm-curated-wiki.md](../../adr/0001-llm-curated-wiki.md) — "library, not librarian" principle this design preserves
- [CLAUDE.md](../../../CLAUDE.md) — current tool surface (8 read tools + 3 curation)
- [docs/DESIGN.md](../../DESIGN.md) — current architecture
- [docs/COMPETITIVE-ANALYSIS.md](../../COMPETITIVE-ANALYSIS.md) — positioning context

---

## 1. Problem

Agents calling treenav today follow a multi-step retrieve loop for any
non-trivial flow:

```
search_documents(query) → get_tree(top_doc_id) → get_node_content(top_doc_id, [node_id])
```

That is three MCP calls, three model turns, and three response artifacts
the model must reconcile. For skills (Claude Code skills) that are
*pre-baked compositions for specific flows*, this is wasteful: the skill
author already knows the shape of the retrieval at design time. The
chain is not adapting to runtime conditions; it is rote.

Pinecone's May 2026 Nexus / KnowQL announcement frames this same problem
as "the ten blue links era of agentic retrieval" and ships an opinionated
declarative query language. treenav can address the same root cause —
wasted round trips and reconciliation cost — with a smaller, deterministic
move that fits its existing architecture.

This design adds **`compile_context`**, a single composed-retrieval MCP
tool, while preserving treenav's existing 8 read tools as both the
primitives `compile_context` orchestrates and the comparison baseline for
evaluation.

## 2. Goals and non-goals

### Goals

- Collapse the typical 3-call retrieve loop into 1 call.
- Return a single artifact carrying ranked hits + outline trees for the
  top hits + explicit budget metadata.
- Treat code and docs as first-class peer corpora; skills should not
  have to choose between them at the tool-call layer.
- Preserve treenav's "zero LLM calls, deterministic, no embeddings"
  principle — this is composition over existing primitives, not a new
  ranking stack.
- Be measurable. Define gates (accuracy parity, token win) that decide
  whether the tool ships at all.

### Non-goals (v1)

- Multi-intent fan-out. See [ADR-0002](../../adr/0002-multi-intent-out-of-scope.md).
- New ranking, new index, new parsers.
- JSON output format. v1 returns text, like every other read tool.
- Streaming responses.
- Cross-source score normalization.
- Caching.
- A query-language DSL (KnowQL-style). The Zod schema *is* the surface.

### Non-goals (ever, unless reopened)

- LLM calls inside treenav.
- Embeddings inside treenav (Tier-4 already closed out at
  [docs/plans/2026-05-06-tier4-decision-review.md](../../plans/2026-05-06-tier4-decision-review.md)).

## 3. Tool surface

One new tool, `compile_context`, registered alongside the existing 8 in
`src/tools.ts`. Existing tools are untouched.

### Input (Zod schema)

```ts
{
  intent: string,                                  // the query — NL, literal, regex, or key
  mode?: "auto" | "search" | "grep" | "lookup" | "symbol",  // default: "auto"
  sources?: ("docs" | "code" | "rows" | "all")[], // default: ["all"]
  filters?: Record<string, string | string[]>,    // same facet shape as search_documents
  output: {
    top_k_per_source?: number,                    // default 3, max 10
    include_snippets?: boolean,                   // default true
    include_outlines_for_top?: number,            // default 2, max 5; 0 disables
    include_full_content_for_top?: number,        // default 0; opt-in for heavy returns
    max_tokens?: number,                          // default 2000, hard cap 8000
  }
}
```

### `mode: auto` heuristic

Cheap, deterministic, no LLM. Resolved before dispatch and surfaced in
the response header so the caller knows which path ran.

| Pattern | Resolved mode |
|---|---|
| Contains regex metacharacters (`\`, `[`, `.*`, `^`, `$`, `(?`) | `grep` |
| Matches `^[A-Z]+-\d+$` (e.g. `PROJ-44`, `INC-104`) | `lookup` |
| Starts with `class `, `function `, `interface `, or matches a known symbol-shaped token | `symbol` |
| Otherwise | `search` |

If `auto` resolves wrong (e.g. picks `grep` for an NL query and returns
zero hits), the empty-result hint suggests the alternate mode. The
caller eats one bad call before correcting. If `auto` mis-classification
exceeds 10% on the evaluation fixture (see Section 7), an explicit
fallback chain is added before shipping.

### What `compile_context` does internally

Pure orchestration over existing public methods on `DocumentStore`:

1. Validate input (Zod).
2. Resolve `mode` via the heuristic above (or use the explicit value).
3. Dispatch one query against each requested source, partitioning by
   collection. Uses `searchDocuments` / `grepDocuments` / `lookupRow` /
   `find_symbol` already implemented in `store.ts`.
4. For the top `include_outlines_for_top` hits across all sources,
   pull outline subtrees via `getTree` / `getSubtree`.
5. Apply the budget trimmer (Section 5).
6. Format as a single text block (Section 4).

No new ranking. No new index. No new parser. ~250–350 lines in a new
`src/compile-context.ts` module.

## 4. Output contract

A single text block, sectioned with explicit headers. Same convention as
every other treenav read tool — agents consume by reading, not parsing.

```
━━━ compile_context: "<intent>" (mode=<resolved_mode>, sources=[...], <X> ms) ━━━

## Hits — docs (3 of 12)
1. [<doc_id> → <node_id>] <doc_title> › <node_title>  (score 0.0421)
   <file_path>
   Snippet: …density-based snippet around the strongest match…

2. …

## Hits — code (2 of 7)
1. [<doc_id> → <node_id>] <ClassName.method>  (score 0.0387)
   <file_path>:<line>
   Signature: parseAuthHeader(req: Request, opts?: AuthOpts): Token | null

2. …

## Outlines (top 2)

▸ <doc_id> — <doc_title>
  [n0] # <h1 title> (412 words)
    [n1]   ## <h2 title> (89 words)
      Summary: …
    [n2]   ## <h2 title> (203 words)
      Summary: …

▸ <doc_id> — <doc_title>
  …

## Full content (top N)
(only emitted when input.output.include_full_content_for_top > 0;
 otherwise omitted)

▸ [<doc_id> → <node_id>] <node_title>
  <full text of the section>

▸ …

## Budget
tokens_used=1640 / 2000  (truncated 4 hits, 1 outline)

## Follow-up
- Read full content: get_node_content("<doc_id>", ["<node_id>"])
- Drill into a subtree: navigate_tree("<doc_id>", "<node_id>")
- Exact-match recheck: grep_documents("<intent>")
```

### Contract guarantees

- **Provenance is mandatory.** Every hit and every outline node carries
  `[<doc_id> → <node_id>]`. No hit appears without it. This is
  non-negotiable: skills and follow-up tools depend on it.
- **Determinism.** Same input → byte-identical output, modulo the
  timing field in the header. Tests strip the timing field before
  asserting.
- **Source ordering is fixed.** `docs` first, then `code`, then `rows`.
  Skills can rely on it.
- **Within-source ordering.** `score` desc, ties broken by
  `(doc_id, node_id)` lexically.
- **Empty sections still emit headers.** `## Hits — code (0 of 0)` is
  emitted even when the code partition is empty, so structural
  consumers see a stable shape.
- **Missing `CODE_ROOT` configured + sources includes `code`** →
  emits `## Hits — code (0 of 0, code indexing not enabled)` and
  continues. Does not error.

### Empty / error cases

- Zero hits across all sources → standard "no matches" block + a hint to
  try the alternate mode (search → grep, or vice versa).
- Invalid mode/source/filter → Zod rejects at the boundary; tool returns
  a typed error.
- Budget too tight to include any outline → `## Outlines` reads
  `(omitted to fit budget — raise max_tokens or lower top_k_per_source)`.
- `mode=lookup` with multiple sources → only `rows` source is meaningful;
  other sources are ignored with a one-line note in the output.

## 5. Budget enforcement

Token approximation: `bytes / 4`, same cheap heuristic the rest of
treenav uses. No tokenizer dependency.

### Trim order (highest-priority kept first)

1. The intent header line — never trimmed.
2. The first hit per source (top doc + top code) — never trimmed below
   snippet length.
3. Remaining hits, lowest-ranked dropped first within each source
   partition.
4. Snippets shortened next: 80 chars, then to title-only.
5. Full-content blocks (when `include_full_content_for_top > 0`)
   trimmed before outlines: drop the lowest-ranked full-content block
   first, then truncate the surviving block(s) to a section-summary
   length, then drop entirely.
6. Outlines trimmed last: drop deepest leaves first, then drop entire
   outlines starting from the lowest-ranked top hit.
7. Follow-up section is small and always retained.

The `## Budget` block reports what got trimmed. No silent truncation.

### Filter semantics

Identical to `search_documents`: keys are facet names, values are
string-or-array. AND across keys, OR within a key. No new filter
grammar.

## 6. Implementation plan (high level)

### File changes

| File | Change |
|---|---|
| `src/store.ts` | No change. All composition runs through existing public methods. |
| `src/compile-context.ts` | **New.** Orchestration module: validation, `auto` resolver, source dispatcher, budget trimmer, output formatter. ~250–350 lines. |
| `src/tools.ts` | Register one new tool, `compile_context`. ~40 lines added. Existing tools untouched. |
| `src/types.ts` | Add `CompileContextInput`, `CompileContextResult` types. |
| `src/prompts.ts` | Optionally extend the `doc-read` prompt to mention `compile_context` as the one-call alternative. Non-blocking. |
| `tests/compile-context.test.ts` | **New.** Unit + token/latency tests (Section 7 layers 1 and 3). |
| `tests/compile-context-quality.test.ts` | **New.** NDCG/MRR parity vs. baseline (Section 7 layer 2). |
| `docs/CONFIGURATION.md` | One paragraph documenting the tool. No new env vars. |
| `docs/DESIGN.md` | One paragraph noting composition lives in `compile-context.ts`. |
| `CLAUDE.md` | Add `compile_context` to the MCP Tools list (becomes 9 read tools). |

No new dependencies. No new env vars. No new config files.

### Rollout

- Single PR, additive. The tool does not change existing behavior.
- Conventional commit prefix `feat:` → minor version bump per the
  project's semantic-release setup.
- Documentation updates land in the same PR.
- No deprecation of existing tools — they remain primitives and the
  evaluation baseline.

## 7. Validation — three layers

The "are we deviating from treenav's principles?" guard resolves here.
Three explicit gates. If any fails, the tool does not ship.

### Layer 1 — Unit / contract tests (fast, deterministic)

Located in `tests/compile-context.test.ts`.

- **Mode auto-resolution.** Table-driven over ~15 cases. Inputs like
  `"PROJ-44"` → `lookup`, `"^class.*Service$"` → `grep`,
  `"how do we rotate tokens"` → `search`,
  `"parseAuthHeader"` → `symbol`.
- **Output structure.** For a fixed query against the existing
  search-quality corpus, assert section headers in fixed order,
  provenance brackets `[doc_id → node_id]` on every hit, and a
  `## Budget` line.
- **Deterministic output.** Call twice, strip timing field, assert
  byte-identical.
- **Trim order.** Under tight `max_tokens`, assert outlines drop before
  snippets shorten before hits drop, top-1 per source preserved.
- **Filter pass-through.** Filters reach `searchDocuments` unmodified;
  verified by comparing `compile_context` hits to `search_documents`
  hits with the same filter.
- **Edge cases enumerated in Section 4.** Empty source partitions,
  missing `CODE_ROOT`, lookup with mixed sources, filter that excludes
  everything.

### Layer 2 — Accuracy parity (the gate)

Located in `tests/compile-context-quality.test.ts`. Extends the same
QRels (~76) used by `tests/search-quality.test.ts`'s 109 tests.

For each QRel, two evaluations side-by-side:

1. **Baseline:** relevant doc/node hits via `search_documents` directly
   (today's path).
2. **Composed:** relevant doc/node hits as they appear in
   `compile_context`'s `## Hits — docs` and `## Hits — code` partitions
   for the same query.

Compute NDCG@10 and MRR for both.

#### Pass criteria

| Metric | Baseline (today) | Compose target |
|---|---|---|
| Overall NDCG@10 | ≥ 0.65 | ≥ 0.65 (no regression) |
| Exact-match NDCG@10 | ≥ 0.83 | ≥ 0.83 (no regression) |
| MRR | ≥ 0.70 | ≥ 0.70 (no regression) |
| Per-language NDCG@10 (8 langs) | ≥ 0.65 each | ≥ 0.65 each |
| Per-domain NDCG@10 (7 domains) | ≥ 0.65 each | ≥ 0.65 each |
| `mode=auto` mis-classification | n/a | < 10% on a small NL/literal/symbol-mix fixture |

`compile_context` is *composition*, not a ranking change — the expected
result is **no regression**. Anything else means semantics drifted
(filter leak, partition crowd-out, off-by-one). If any criterion fails,
do not ship.

### Layer 3 — Token / latency win (the value gate)

Method: ~10 representative skill-style flows (the kind of multi-step
retrieve loops the `doc-read` prompt models). Measure both paths:

- **Baseline:** sum of bytes returned across the original 2–3 tool
  calls (`search_documents → get_tree → get_node_content`).
- **Composed:** bytes returned by one `compile_context` call.

Token estimate = bytes / 4. Latency = `Date.now()` deltas.

#### Pass criteria

- Composed flow returns ≥ 30% fewer tokens than the equivalent baseline
  chain on average.
- Composed flow completes in fewer round trips by definition (1 vs. 3).

If we don't hit the 30% token win, the cost-benefit doesn't justify a
new tool — skills can keep calling existing primitives. Do not ship.

## 8. The "are we deviating?" gate

Operationalized as three signals, all measured before merging:

1. **Principle preserved.** Code review confirms zero LLM calls, zero
   embedding calls, no new ranking. Composition only. Self-check.
2. **Accuracy preserved.** Layer-2 quality tests pass with no
   regression on any criterion.
3. **Value delivered.** Layer-3 measurement shows ≥ 30% token reduction
   on representative flows.

If 2 or 3 fails, this design gets a "rejected — keep using primitives"
update and the work closes out cleanly.

## 9. v2 plan — skill integration (forward-looking)

This section is a sketch, not committed work. It exists so that v1's
shape doesn't box v2 in.

### Goal

Make skill files the canonical authoring surface for `compile_context`
queries: the skill author writes the query once, the host runtime
dispatches it. Skills become declarative and portable across hosts
(Claude Code, Cursor, Codex). The agent continues to see one stable
tool (`compile_context`) regardless of how many skills exist.

### Mechanics (sketch — to be designed in v2)

A skill file embeds a fenced query block alongside its prose:

````markdown
---
name: incident-runbook-lookup
description: Find the runbook for an in-progress incident
---

When the user reports an incident, run the embedded query, then
summarize the top runbook section.

```treenav-query
intent: "${input.symptom}"
mode: search
sources: [docs]
filters:
  type: runbook
output:
  top_k_per_source: 3
  include_outlines_for_top: 1
  max_tokens: 1500
```
````

The host runtime extracts the block, substitutes `${input.*}`
placeholders, and calls `compile_context`. Treenav itself does not
execute the skill — it validates and serves the query.

### What this repo would add in v2

| Addition | Purpose |
|---|---|
| `bunx treenav skills install` | Wires treenav-aware skills into the host's skill directory. Mirrors today's `treenav init` hook installation. |
| `bunx treenav lint --skills` | Validates `treenav-query` blocks against `compile_context`'s Zod schema at author time. |
| `validate_skill_query` MCP tool *(optional)* | Lets a host validate a query block at dispatch time. Probably YAGNI if `lint --skills` covers the author-time path. |
| Reference skill bundle in `examples/skills/` | 3–5 canonical skills demonstrating common flows: incident lookup, code symbol deep-dive, doc-and-code combined search, structured row lookup, "what does this CLI flag do." |

### Scope boundary preserved

- Treenav still does not execute skills. The host runtime owns the
  dispatch loop.
- Treenav still makes zero LLM calls.
- Treenav still does not maintain a registry of named per-skill tools
  (option B in the brainstorm; remains rejected). The agent always
  sees one tool: `compile_context`. Skills are *templates*, not
  *tools*.

### Pre-conditions before starting v2

1. v1 ships and passes its three gates (principle, accuracy, value).
2. ≥ 3 real-world skill flows exist (in this or partner repos) that
   would benefit from declarative query embedding.
3. At least one host runtime confirms it can dispatch from a skill
   query block (Claude Code's skill loader is the obvious first
   target).

### Open questions carried into v2 design

- **Embedding format:** YAML inside the markdown (above) vs. JSON.
  YAML reads better for human authoring; JSON is easier to validate
  and matches the MCP wire format. Default lean: YAML for authoring,
  JSON for the wire.
- **Placeholder syntax:** `${input.intent}` vs `{{input.intent}}`.
- **Composition with existing prompts.** The `doc-read` / `doc-write`
  / `doc-lint` prompts already exist. Skills probably *coexist* with
  them; prompts stay as host-agnostic workflow templates, skills are
  the declarative-query layer on top. Confirmed in v2.
- **Multi-intent revisited.** If v2 surfaces a real skill that
  genuinely needs disjoint queries, this is the moment to revisit
  [ADR-0002](../../adr/0002-multi-intent-out-of-scope.md). Until then,
  deferred.
- **Skill discoverability.** Whether a host needs an MCP resource
  (`treenav://skills`) listing installed skills. YAGNI until a host
  asks.

### What this section is NOT

This is not a v2 spec. It is a sketch dropped into the v1 spec so that
v1's tool shape does not preclude v2 (it does not — skills wrap
`compile_context`, not modify it), v1's measurement criteria do not
conflict with v2 (they do not — skill integration is purely additive),
and a future contributor reading this spec sees where this is going. A
real v2 spec gets its own brainstorming session when the pre-conditions
are met.

## 10. Out of scope (explicit deferrals)

- **Multi-intent fan-out.** See
  [ADR-0002](../../adr/0002-multi-intent-out-of-scope.md). Reopening
  criteria documented there.
- **JSON output format.** Re-evaluate if a skill consumer needs to
  parse structurally rather than read.
- **Per-skill named tools (registry).** Re-evaluate if skill authoring
  becomes the bottleneck and `compile_context` proves value.
- **Streaming.** Re-evaluate when single responses routinely exceed
  the 8K-token cap (the cap currently prevents this).
- **Cross-source score normalization.** Re-evaluate only if Layer-2
  measurement reveals partition crowd-out.
- **Caching.** Re-evaluate if profiling shows compile-time cost on the
  in-memory store. (Currently fast enough that this is YAGNI.)
- **LLM calls inside treenav.** Permanently out of scope per
  [ADR-0001](../../adr/0001-llm-curated-wiki.md) and
  [docs/plans/2026-05-06-tier4-decision-review.md](../../plans/2026-05-06-tier4-decision-review.md).
