# Retrieval Variants — Decision Support

**Status:** Working analysis as of 2026-05-07. Variant 3 just shipped on PR #33; variants 1 and 2 are described for comparison.

**Purpose:** treenav has three viable retrieval strategies. They imply different MCP API surfaces. This doc lays out the trade-offs explicitly so the question "should we change the MCP API?" can be answered with evidence rather than instinct.

---

## TL;DR

- **Variant 1** (BM25 + tree primitives) — what was already shipping. Tiers 1–3 of the Semble port (PRs 0–7) tuned the BM25 stack against a 76-QRel corpus. NL-slice NDCG@10 reached 0.848.
- **Variant 2** (semantic / Model2Vec) — closed by PR-8 decision review. NL headroom too small (0.152) to justify the 0.05 acceptance gate. Artifacts retained for fast resumption (`scripts/measure-tier4.ts`, `scripts/generate-golden-vectors.py`, fixture).
- **Variant 3** (`compile_context` orchestration) — just shipped on PR #33. 50.1% token reduction on representative flows, NDCG parity with variant 1 (-0.0006), 1 call replaces 3.

The decision: **default skill flows toward variant 3, keep variant 1 primitives intact, leave variant 2 deferred.** Detail and reopening criteria below.

---

## Variant 1 — BM25 + tree primitives (the pre-PR-33 baseline)

### What's actually in it

The Semble feature port (PRs 0–7) is the complete implementation history. Reproduced verbatim from `docs/plans/2026-05-03-semble-feature-port.md`:

| PR | Scope | Deps | Risk |
|----|-------|------|------|
| 0 | Lock decisions in "Decisions to lock before PR 1": add `symbol_kind`/`symbol_name` to `TreeNode`, move `noise_patterns` to `CollectionConfig`. Pure type/plumbing change with no scoring effect. | none | low |
| 1 | Task 1.1 (definition boost) | PR 0 | low |
| 2 | Task 1.3 (noise penalties + tightened `CODE_GLOB` defaults) | PR 0 | low |
| 3 | Task 1.5 (file coherence — both file boost AND lead bonus) | PR 1 | low |
| 4 | Task 1.2 (subtoken indexing with full_coverage_bonus precision) | PR 0–3 | medium — touches index + score |
| 5 | Task 1.4 (query-shape-aware multipliers) | PR 1, 4 | low |
| 6 | Task 2.1 (window-density ranking signal) | PR 0–5 | low |
| 7 | Tier 3.1 + 3.2 (RRF refactor + adaptive weighting) | PR 0–6 | medium — refactors scoring path |
| 8 | Decision review with corpus-scale benchmark: do we need Tier 4? | PR 7 + index-time measurement | — |
| 9 | Tier 4.1 + 4.2 (only if PR 8 says yes) — pure-TS Model2Vec runtime, fallback to `onnxruntime-node` only if blocked | PR 7 | medium — model-weights download, index-time impact |

**Key files modified across PRs 0–7:**

- `src/types.ts` — `symbol_kind?: string` and `symbol_name?: string` on `TreeNode` (`src/types.ts`); `definition_boost`, `subtoken_weight`, `file_coherence_bonus`, `file_lead_bonus`, `window_density_bonus`, `rrf_k`, `signal_weights` on `RankingParams`; `noise_patterns?: { pattern: string; penalty: number }[]` on `CollectionConfig`
- `src/code-indexer.ts` — populate `symbol_kind` / `symbol_name` in `symbolToTreeNode`; subtoken emission for code nodes; tightened default `CODE_GLOB` (excludes `node_modules/`, `vendor/`, `dist/`, `build/`, `.git/`)
- `src/store.ts` — definition boost multiplier; separate `exactTerms`/`subtokenTerms` tracking; `full_coverage_bonus` fires only on exact matches; noise penalty pre-compiled per collection at `load()` time; file coherence bonus + lead bonus as a post-aggregation pass; window-density signal for nodes longer than 2× `avgNodeLength`; RRF refactor (signals produce ranked lists, fused via `score(d) = Σ weight_s · 1/(k + rank_s(d))`); adaptive signal weighting per query shape

**Calibration deltas (actual vs plan):**

- `file_coherence_bonus`: `0.05` actual vs `~0.15` plan — the bonus as originally specced would have over-promoted multi-match files above focused single-match nodes; halved to 0.05 based on QRel feedback before locking.
- `window_density_bonus`: `0.005` actual vs `~1.0` plan — the plan's default of `~1.0` was stated as a starting point for tuning; the calibrated value is 0.005 after measuring on the QRel corpus. The bonus is deliberately small: long-body density is already partially captured by BM25 length normalization; the window bonus is a marginal nudge, not a dominant signal.

**Test coverage as of PR 7:**

~69 QRels across 7 categories: `exact`, `multi-term`, `code-symbol`, `discriminating`, `synonym`, `facet-filtered`, `zero-result`. Notable DEF1/DEF2 cases (definition vs call-site disambiguation) explicitly covered in the `code-symbol` bucket. Per-language NDCG tests for 8 languages (Java, Python, TS, Go, Rust, C++, C#, Ruby), each gated at ≥ 0.65. Per-domain NDCG tests for 7 domains (auth, api, ops, arch, frontend, infra, data-science), each gated at ≥ 0.65.

**Deliberate NOT-shipped items from the plan:**

- Task 2.2 (sub-symbol child nodes / fragment emission): skipped because Task 2.1 (window-density signal) moved the needle on long-body QRels without requiring the indexer refactor. Fragment nodes would have complicated the `get_tree` output contract and added index-time complexity with no measured QRel benefit on this corpus.
- Tier 4 (Model2Vec): closed by PR-8 decision review. See Variant 2.

### Implied MCP API surface

8 read tools (the pre-PR-33 set):

- `list_documents`, `search_documents`, `grep_documents`, `get_tree`, `get_node_content`, `navigate_tree`, `lookup_row`, `find_symbol`

Each tool is a primitive. Skills compose them: `search → tree → content`, or `find_symbol → content`, or `lookup_row` directly.

### Strengths

- **Deterministic.** Same input, byte-identical output (modulo timing).
- **Composable.** Skills choose what to call; no opinionated pipeline.
- **Cheap.** ~0.15s to index 1,500 C++ files; <30ms search; no model load, no embedding compute.
- **No external dependencies.** No model files, no API keys, no GPU.
- **Faithful to the project's principle:** "treenav is the library infrastructure; the calling agent is the librarian." (ADR-0001)

### Weaknesses

- **Multi-call cost.** A typical retrieve loop is 3 round trips (~3 model turns), each carrying redundant context.
- **Skill authoring overhead.** The skill author must know which tool to invoke when. `auto`-mode dispatch lives in the agent, not the library.
- **No bundled outline.** After search, the agent must fetch the tree separately to know what to drill into.

### MCP API implications if we standardize on variant 1

- Keep the 8-tool surface fixed.
- Document tool-chaining patterns in MCP prompts (already done: `doc-read`, `doc-grep`).
- Burden of orchestration stays in the agent / skill author.

---

## Variant 2 — Semantic / Model2Vec (deferred per PR-8)

### What's actually in it

Almost nothing in `src/`. Tier 4 was closed before any encoder or hybrid ranker landed. The artifacts that remain:

- `scripts/generate-golden-vectors.py` — Python helper invoking `model2vec==0.8.1` (`StaticModel`, reference model `minishlab/potion-code-16M`, dim 256) over a fixed 100-string corpus (15 English-prose sentences, 20 code identifiers, 10 file paths, 10 mixed-case acronyms, 10 non-ASCII strings, 15 mixed NL+code fragments, 20 edge cases). Generator intentionally not wired into `bun test` or CI — the fixture must be a fixed artifact, not regenerated at test time.
- `tests/fixtures/model2vec-golden-vectors.json` — precomputed vectors (~566 KB) for the 100-string corpus, kept for parity-test resumption. Stable and not shuffled — PR 9's parity test is expected to iterate positionally so any divergence reports the offending input verbatim.
- `scripts/measure-tier4.ts` — bucketed NDCG (NL vs exact-friendly) but only over BM25; no semantic retrieval logic. Reusable for re-measuring the NL/exact gap on any future corpus without rebuilding the measurement infrastructure.
- The fixture and harness exist so that if Tier 4 is ever revived, the parity gate can be re-run quickly.

### Why it was closed (PR-8 decision review)

Headline numbers from `docs/plans/2026-05-06-tier4-decision-review.md`:

| Bucket | QRels | Evaluated | Mean NDCG@10 |
|---|---:|---:|---:|
| Exact-friendly | 53 | 52 | **0.8353** |
| NL / recall-leaning | 13 | 13 | **0.8481** |
| Gap (exact − NL) | — | — | **−0.0128** |

Per-category breakdown:

| Category | n | Mean NDCG@10 |
|---|---:|---:|
| exact | 9 | 0.8113 |
| multi-term | 19 | 0.7928 |
| code-symbol | 19 | 0.9313 |
| discriminating | 5 | 0.6754 |
| synonym | 6 | 0.8158 |
| facet-filtered | 7 | 0.8758 |

The acceptance gate was `≥ 0.05` lift on the NL bucket. Headroom is only `1.000 − 0.848 = 0.152`. The NL bucket is already at 0.85, and the within-bucket gap between `synonym` (the slice semantic embeddings most plausibly help, at 0.8158) and `facet-filtered` (where embeddings would not change the filter logic, at 0.8758) is only 0.06. The lowest-scoring sub-bucket is `discriminating` (0.68) — but that is an exact-friendly category; static embeddings would not help it.

The secondary concern from the cold-index measurements: store-load alone consumes ~1 GB on the `microsoft/TypeScript` clone (39,318 files, 282,834 tree nodes). Adding a 256-float vector per node to a 280k-node store is ~287 MB extra heap before any model weights are loaded.

### Strengths (if revived)

- Better recall on synonym/paraphrase queries where vocabulary diverges between query and indexed text.
- Cross-language semantic matching (treenav's BM25 is monolingual via stemmer choice).
- Plays well with cross-corpus deduplication.
- The pure-TS Model2Vec inference path (tokenize → table lookup → mean-pool) has no forward pass and no attention — no GPU required, no `onnxruntime-node` binary. The plan's preferred implementation strategy keeps the "no binary deps" install story.

### Weaknesses (why it stayed closed)

- **Model dependency.** A static M2V model is ~20–80 MB; loading + indexing time grows; CPU-bound encoding adds latency on cold start.
- **Insufficient measured ROI on this corpus.** The 0.152 ceiling cannot clear a 0.05 gate in practice; the data does not exhibit the NL-recall failures the plan hypothesized Tier 4 would catch.
- **Violates the "zero LLM/no embeddings" promise** that differentiates treenav from PageIndex/Pinecone (see `docs/COMPETITIVE-ANALYSIS.md`).
- **Cross-language coverage is incomplete.** A static model trained on one language family loses on others.
- **Memory.** ~287 MB additional heap just for vectors on the TypeScript clone, before model weights.
- **Determinism caveat.** Float-precision drift across machines; not guaranteed bytes-identical.

### MCP API implications if Tier 4 is ever revived

Three possible shapes:

1. **`SEMANTIC=1` env var, no new tool.** Existing `search_documents` becomes a hybrid scorer (BM25 + semantic). Lowest API surface change; biggest semantic-leakage risk into the "no embeddings" principle.
2. **New `semantic_search` tool.** Keeps BM25 path pure; lets the agent or skill choose which to call. Higher surface, cleaner contract.
3. **New `mode: "semantic"` on `compile_context`.** Slot into variant 3's existing dispatcher. No new tool; a new mode alongside `auto`/`search`/`grep`/`lookup`/`symbol`. Most consistent with the orchestration story but couples the variants.

### Reopening criteria (carried from PR-8 review)

Tier 4 should be revisited only if:

1. A real corpus surfaces an NL-slice NDCG regression below ~0.70 that BM25 + glossary tuning cannot recover. The trigger condition is a bucket gap > 0.10 below the exact-friendly bucket (today the gap is −0.013 in the NL-better direction). Re-run `scripts/measure-tier4.ts` against the corpus where the regression is observed; do not extrapolate from the search-quality fixture.
2. A user reports synonym-heavy queries failing repeatedly in practice.
3. Static-embedding model performance improves materially (e.g., a future `model2vec` revision with a sub-256-dim option that compresses the model below 5 MB).

Until then, deferred.

---

## Variant 3 — `compile_context` orchestration (PR #33, just shipped)

### What's actually in it

Single new MCP tool that composes the existing primitives. All in `src/compile-context.ts` (~550 lines). Zero new ranking, zero new index, zero LLM calls. Pure orchestration over what variant 1 already provides.

- **Mode auto-resolver:** regex heuristic dispatches `intent` to `search` / `grep` / `lookup` / `symbol`. Skills can override with explicit `mode`. Resolved before dispatch and surfaced in the response header so the caller knows which path ran.
- **Source dispatchers:** `dispatchSearch`, `dispatchGrep`, `dispatchLookup`, `dispatchSymbol` — wrap existing `DocumentStore` methods, tag results with source.
- **Outline collector:** `collectOutlines` pulls the top-N unique doc trees so the agent gets structure + content in one response.
- **Full-content collector:** opt-in (`include_full_content_for_top > 0`) for skills that want section bodies inlined.
- **Output formatter + budget trimmer:** assembles a single text artifact with mandatory provenance brackets, applies a 7-step trim order to fit `max_tokens`.

Input schema:

```ts
{
  intent: string,
  mode?: "auto" | "search" | "grep" | "lookup" | "symbol",  // default: "auto"
  sources?: ("docs" | "code" | "rows" | "all")[],           // default: ["all"]
  filters?: Record<string, string | string[]>,
  output: {
    top_k_per_source?: number,       // default 3, max 10
    include_snippets?: boolean,       // default true
    include_outlines_for_top?: number, // default 2, max 5; 0 disables
    include_full_content_for_top?: number, // default 0; opt-in
    max_tokens?: number,             // default 2000, hard cap 8000
  }
}
```

### Measured outcomes (PR #33 gates)

| Gate | Result |
|---|---|
| Principle preserved | Zero LLM calls, no embeddings, no new ranking |
| Accuracy parity | NDCG@10 0.8373 vs 0.8379 baseline (Δ −0.0006), MRR 0.8638 (parity) |
| Token reduction | 50.1% on 10 representative flows (41,554 → 20,731 bytes) |
| Per-language NDCG | All 8 languages ≥ 0.65 |
| Per-domain NDCG | All 7 domains ≥ 0.65 |

### Strengths

- **One call replaces three.** Collapses the typical `search → tree → content` loop. Latency drops from ~3 round trips to 1.
- **Skill-friendly.** A skill author writes one call with declarative options (`sources`, `top_k_per_source`, `max_tokens`, `include_outlines_for_top`); no orchestration logic in the skill.
- **Discoverability.** The tool description guides the agent toward the most efficient path without needing the agent to reason about which primitive to invoke.
- **Variant 1 still intact.** Primitives are unchanged and remain usable. `compile_context` is additive.

### Weaknesses

- **Less granular control.** Skills that want precisely "search but not outline" or "grep with context lines" must drop back to primitives — which is fine, since primitives still exist.
- **Auto-mode mis-classification risk.** The regex heuristic was tested on ~16 cases. On real query mixes, mis-rate >10% triggers a re-evaluation gate (per the spec).
- **Multi-intent gap.** Skills needing disjoint queries fused into one decision context still chain calls (see ADR-0002 for the reopening criteria).

### MCP API implications

Already 9 tools after PR #33 lands. Open questions:

1. **Should `compile_context` become the default skill entry point?** Document it in the `doc-read` MCP prompt as the recommended path. Primitives become "advanced/diagnostic."
2. **Should we deprecate any primitives?** No — they remain composition building blocks. `find_symbol` / `lookup_row` / `grep_documents` all still serve direct, narrow uses.
3. **Should v2 add multi-intent?** Per ADR-0002: only when ≥3 real skills demonstrate the need for disjoint queries fused in one call.
4. **Should v2 add skill-registered named tools?** Rejected as "Option B" during brainstorming. Deferred indefinitely.

---

## How to evaluate trade-offs on your corpus

`scripts/measure-compile-context.ts` (committed to PR #33) runs all three variants on a real corpus and emits CSV with bytes / latency / top_results / NDCG@10 per query.

```bash
bun run scripts/measure-compile-context.ts \
  --docs <large-markdown-root> \
  --code <large-codebase-root> \
  --queries queries.json    # 30+ representative skill queries
  --vectors vectors.json    # optional, variant 2 skipped without
  --qrels   qrels.json      # optional, fills NDCG@10 column
```

For variant 2, supply a sidecar JSON with pre-computed embeddings (schema documented in the script). Adapt `scripts/generate-golden-vectors.py` to walk your corpus and emit the expected schema.

For NDCG, hand-grade ~30 queries (3–5 relevant nodes each).

---

## Decision framework

| If you observe… | Action |
|---|---|
| `compile_context` matches variant 1 NDCG within 0.005 on your corpus AND token reduction ≥ 30% | Promote `compile_context` to the recommended default in MCP prompts. Variant 1 primitives stay. |
| Variant 1 NL-slice NDCG drops below 0.70 on real queries | Revisit Tier 4 / variant 2 (reopening criteria above). |
| Real skills are chaining 2+ `compile_context` calls back-to-back with disjoint intents | Revisit ADR-0002, design `compile_context_batch` as a sibling tool. |
| `mode: auto` mis-classifies > 10% of queries on real workloads | Add explicit fallback chain (try search if grep returns zero) before the next minor release. |
| Per-source top-K crowds out one source consistently | Lower default `top_k_per_source`, OR add cross-source score normalization. |

---

## References

- ADR-0001: LLM-Curated Wiki — `docs/adr/0001-llm-curated-wiki.md`
- ADR-0002: Multi-Intent Out of Scope — `docs/adr/0002-multi-intent-out-of-scope.md`
- compile_context design spec — `docs/superpowers/specs/2026-05-06-compile-context-design.md`
- Tier 4 decision review — `docs/plans/2026-05-06-tier4-decision-review.md`
- Semble feature port plan — `docs/plans/2026-05-03-semble-feature-port.md`
- Competitive analysis — `docs/COMPETITIVE-ANALYSIS.md`
