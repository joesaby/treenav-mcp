# Porting Semble's Code-Search Wins to Treenav

**Goal:** Close the practical gap between Treenav and [Semble](https://github.com/MinishLab/semble) on code search quality without abandoning Treenav's design ethos: tree navigation as the primary retrieval model, BM25 as the deterministic core, and Bun-native zero-LLM operation by default.

**Approach:** Four tiers, ordered by impact-per-effort. Tiers 1–3 are pure-algorithm changes with no new dependencies and no philosophical shift. Tier 4 is gated behind an opt-in flag and requires a deliberate decision before adoption.

---

## Decisions to lock before PR 1

These came out of evaluation against the current code in `src/store.ts` and `src/code-indexer.ts` and shape the type signatures of subsequent tasks. Resolve them first, in this order, or PR 1 will need rework.

1. **`TreeNode` shape for symbol metadata.** Today `TreeNode` carries no `symbol_kind` or `symbol_name` — `symbol_kind` is a *document-level* facet (`src/code-indexer.ts:257`) and the kind is encoded into `node.title` as a prefix (`"class AuthService"`, `src/code-indexer.ts:146`). Definition boost (Task 1.1) needs node-level access. **Decision:** add optional `symbol_kind?: string` and `symbol_name?: string` fields to `TreeNode`, populated by `symbolToTreeNode` for code-indexed docs, undefined for markdown nodes. Avoid the title-regex fallback — it leaks parser detail into the scorer.
2. **Per-collection ranking config.** Markdown wikis may legitimately keep `legacy/` content; code roots usually want it down-ranked. **Decision:** noise patterns are configured per `CollectionConfig`, not globally on `RankingParams`. Adds a `noise_patterns?: { pattern: string; penalty: number }[]` field to `CollectionConfig`. Resolves Open Question 1.
3. **Subtoken interaction with `full_coverage_bonus`.** A 2-word query hitting two subtokens of one identifier must NOT trigger the full-coverage bonus, otherwise `parseFrontmatter` "fully covers" the query `parse frontmatter`. **Decision:** track exact-match terms separately from subtoken-match terms; `full_coverage_bonus` fires only on exact-match coverage.

## Background

[Semble](https://github.com/MinishLab/semble) (MinishLab) is a fast code-search MCP server built on a hybrid retrieval pipeline:

- **Chunking** via Chonkie (code-aware)
- **Dual retrievers:** BM25 + Model2Vec static embeddings (`potion-code-16M`)
- **Score fusion** via Reciprocal Rank Fusion (RRF)
- **Code-aware reranker:** definition boosts, identifier-stem matching, file coherence, noise penalties (tests, type stubs, legacy shims), adaptive lexical weighting

Reported numbers: ~250ms index, ~1.5ms query, 0.854 NDCG@10 (≈99% of CodeRankEmbed Hybrid at 218×/11× faster index/query).

Treenav today is BM25-only with positional indexing, glossary expansion, frontmatter facets, and AST-based symbol extraction across 8+ languages. It has tree navigation (which Semble lacks) and document support (Semble is code-only). The gap is in **code-specific ranking signals** and **optional semantic recall**.

## Non-Goals

- Replacing tree navigation with flat chunk lists.
- Switching the project off Bun/TypeScript.
- Making embeddings mandatory or default-on.
- Copying Semble's Python/Chonkie chunker verbatim — Treenav's AST-based symbol extraction is structurally better for navigation.

---

## Tier 1 — Code-Aware Ranking Signals (no new deps)

These slot into the existing scorer in `src/store.ts` (around the `entry.score *= colWeight` line) as additional bonuses/penalties on top of BM25. Each is independent and can land as a separate PR.

### Task 1.1: Definition boost for symbol-name matches

**Problem:** When a query token equals a code node's symbol name (e.g. query `parseFrontmatter` matching a function literally named `parseFrontmatter`), Treenav scores it the same as any other tf-idf hit. Definitions should rank above call-sites and references.

**Files:**
- Modify: `src/types.ts` — add `symbol_kind?: string` and `symbol_name?: string` to `TreeNode`; add `definition_boost: number` to `RankingParams` (default ~2.0)
- Modify: `src/code-indexer.ts` — populate the new `TreeNode` fields in `symbolToTreeNode` (kind from `symbol.kind`, name from `symbol.name`)
- Modify: `src/store.ts` — add `definition_boost` multiplier in scoring path
- Test: `tests/search-quality.test.ts` — add QRels asserting definition ranks above call-sites

**Step:** Match against `node.symbol_name` (not `node.title`, which is `"class AuthService"` with the kind prefix). When a query term (after stemming + glossary expansion, plus its raw form pre-stem) equals `node.symbol_name?.toLowerCase()` AND `node.symbol_kind` is one of `class`/`function`/`interface`/`method`/`type`/`enum`/`struct`/`trait`/`enum_variant`, multiply that node's score by `definition_boost`. Apply once per node regardless of how many query terms match — the boost is "this is a definition," not stackable.

### Task 1.2: Identifier-stem subtoken indexing

**Problem:** The current scorer already does prefix matching for terms ≥3 chars at query time (`src/store.ts:623`), so `parse` already matches `parsefrontmatter` (lowercased, single-token). The actual gaps:

- **Middle subtokens.** `frontmatter` does not prefix-match `parsefrontmatter`. Need true split-at-index.
- **Stem-on-subtoken matching.** Query `parsing config` should match `parseConfig` and `ConfigParser`. Today the stemmer runs on whole tokens, so `parsing → pars` never sees `parse` inside `parseConfig`.
- **Casing-aware splits.** `URLParser` should split as `URL`, `Parser`, not `U`, `R`, `L`, `Parser`.

**Files:**
- Modify: `src/code-indexer.ts` — emit subtokens for identifiers in code nodes only
- Modify: `src/store.ts` — index subtokens into a separate posting band; track subtoken matches separately from exact matches in `nodeScores`
- Modify: `src/types.ts` — add `subtoken_weight: number` to `RankingParams` (default ~0.5)
- Test: `tests/parsers.test.ts` + `tests/search-quality.test.ts`

**Step:** At index time, for code nodes only (skip markdown to keep title-weight semantics intact), split each identifier with `/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|[0-9]+/g` and on `_` / `-`. Stem each subtoken. Add a posting marked `kind: "subtoken"` distinct from the full-token posting. In `searchDocuments`, when accumulating scores in `nodeScores`, track `exactTerms: Set<string>` and `subtokenTerms: Set<string>` separately. Apply rules:

- Subtoken hit contributes `bm25_score * subtoken_weight` to the node score.
- `term_proximity_bonus` counts the union of exact + subtoken matches (recall is the goal).
- `full_coverage_bonus` fires ONLY when `exactTerms.size === uniqueTerms.length` (precision: no spoofing coverage with subtokens of one identifier).
- Skip subtokens identical to the full token (avoid double-counting).

### Task 1.3: Noise penalties for tests, type stubs, legacy paths

**Problem:** Test files, `.d.ts` stubs, and `compat`/`legacy` shims share vocabulary with canonical implementations and pollute top-K. Semble down-weights these explicitly. Two distinct concerns to keep separate:

- **Index-time exclusion** (`node_modules/`, `vendor/`, `dist/`, build outputs): if these are indexed at all, that's a `CODE_GLOB` misconfiguration. Out of scope here — fix in glob defaults, not score.
- **Score-time penalty** (tests, `.d.ts`, `compat/`, `legacy/`, `examples/`): legitimately part of the corpus, but should rank below canonical implementations.

**Files:**
- Modify: `src/types.ts` — add `noise_patterns?: { pattern: string; penalty: number }[]` to `CollectionConfig` (per-collection, NOT global, so the markdown wiki and code root can configure independently — see Decision 2)
- Modify: `src/store.ts` — pre-compile patterns once per collection at `load()` time (avoid per-node `RegExp` instantiation in the hot path); apply penalty multiplier per node based on `doc.meta.collection` and `doc.meta.file_path`
- Modify: `src/code-indexer.ts` — tighten the default `CODE_GLOB` to exclude `node_modules/`, `vendor/`, `dist/`, `build/`, `.git/` (index-time, not score-time)
- Test: `tests/search-quality.test.ts`

**Step:** Default score-time noise list applied to code collections only:

```ts
[
  { pattern: "(^|/)__tests__/", penalty: 0.5 },
  { pattern: "\\.test\\.[a-z]+$", penalty: 0.5 },
  { pattern: "\\.spec\\.[a-z]+$", penalty: 0.5 },
  { pattern: "\\.d\\.ts$", penalty: 0.3 },
  { pattern: "(^|/)compat/", penalty: 0.6 },
  { pattern: "(^|/)legacy/", penalty: 0.6 },
  { pattern: "(^|/)examples?/", penalty: 0.7 },
]
```

Markdown collections get an empty default — wikis often have legitimate `legacy/` content. Match against `doc.meta.file_path`; multiply final score by the lowest penalty among matching patterns (so multiple matches don't compound).

### Task 1.4: Query-shape-aware ranking adjustments

**Problem:** Symbol-shaped queries (`parseFrontmatter`, `_init`, `BM25_K1`) want exact-definition precision; natural-language queries (`how do I configure auth`) want broader recall via subtokens and prefix matches. Semble's "adaptive weighting" rebalances *between* lexical and semantic retrievers — that mechanism is moot until Tier 3+ when there's a second signal to weight against. **This task is therefore moved to Tier 3.** Within Tier 1, the shape signal is still useful but applied differently:

**Files:**
- Modify: `src/store.ts` — detect query shape and adjust intra-Tier-1 multipliers (not BM25 weight in aggregate)
- Modify: `src/types.ts` — add `symbol_query_definition_boost_multiplier` (default ~1.5) and `symbol_query_subtoken_dampener` (default ~0.5)

**Step:** Heuristic: query is "symbol-shaped" if any token matches `/[A-Z][a-z]/` (camelCase), `/_/` (snake_case), or is all-uppercase ≥2 chars (`BM25`, `URL`). When symbol-shaped:

- Multiply `definition_boost` by `symbol_query_definition_boost_multiplier` for this query.
- Multiply `subtoken_weight` by `symbol_query_subtoken_dampener` for this query (the user typed a specific identifier; subtoken matches are likely noise).

For natural-language queries, leave both at defaults. This is a real behavior change in Tier 1 (unlike a flat BM25 multiplier, which would no-op when BM25 is the only signal).

### Task 1.5: File coherence bonus

**Problem:** Two related sub-problems Semble lumps under "file coherence" — keep them distinct:

- **(a) Multi-chunk file boost:** when several chunks of the same file match, the file as a whole is more likely relevant than a single one-off match elsewhere. Semble boosts the *file*. This affects which files appear at all in top-K.
- **(b) Intra-file leading node:** within the matching file, the agent reads better when the lead result is a natural entry point (file top, exported class) rather than a random inner method. Treenav-specific concern, since we expose nodes not flat chunks.

**Files:**
- Modify: `src/store.ts` — post-aggregation pass before final sort
- Modify: `src/types.ts` — `file_coherence_bonus` (default ~0.15, applied to per-file boost) and `file_lead_bonus` (default ~0.05, applied to leading node within a multi-hit file)

**Step:** After per-node accumulation, group results by `doc_id`. For each group with ≥2 matching nodes:

1. Add `file_coherence_bonus * (matchCount - 1) * mean(group scores)` to every node in the group (Semble-style file boost).
2. Within the group, add `file_lead_bonus * max(group scores)` to the node with the smallest `line_start` (or shallowest `level` if `line_start` is equal — root nodes win ties).

This deviates from Semble: Semble boosts the file as a unit, we boost the file *and* nudge the file's natural entry point. Worth measuring separately to confirm both bonuses earn their keep.

**Tier 1 acceptance:** Add ≥12 new QRels to `tests/search-quality.test.ts` covering: (a) definition lookups vs call-sites, (b) middle-subtoken queries (`frontmatter` matching `parseFrontmatter`), (c) symbol-shaped vs natural-language splits, (d) noise filtering for `*.test.*` and `.d.ts`, (e) multi-hit file leading-node selection. Target: NDCG@10 improvement ≥0.05 on the code corpus, no regression (≥-0.01) on the markdown corpus. Run each task as its own PR with its own before/after metrics — combined improvements can mask individual regressions.

---

## Tier 2 — Sub-Symbol Granularity (small refactor)

**Problem (correctly framed):** BM25 itself doesn't care about positions, only tf-idf — so the original framing ("matching three lines deep scores the same as the signature") was wrong. The actual issues with long nodes are:

- **Snippet quality.** `buildDensitySnippet` (`src/store.ts:990`) already finds the best window, but the snippet is not used as a *ranking* signal — only for display. So a 200-line function with one cluster of matches scores the same as one with sparsely scattered matches.
- **Per-node tf normalization.** A long node can accumulate enough tf-idf from incidental term mentions to outrank a focused short node. BM25's length norm (`bm25_b=0.75`) helps but doesn't fully cancel this for very long bodies.

### Task 2.1 (preferred first): Window-density ranking signal

**Files:**
- Modify: `src/store.ts` — extract best-window density score during scoring, not just snippet generation
- Modify: `src/types.ts` — add `window_density_bonus: number` (default ~1.0)

**Step:** During score accumulation, compute the highest density (matches-per-window-token) across a sliding window of `windowWords` tokens for nodes longer than 2× `avgNodeLength`. Add `window_density_bonus * density` to the node score. For short nodes, the existing tf-idf already concentrates matches, so skip — added work for no metric movement.

### Task 2.2 (only if 2.1 isn't enough): Sub-symbol child nodes

**Files:**
- Modify: `src/code-indexer.ts`
- Modify: `src/types.ts`

**Step:** For nodes whose body exceeds N lines (configurable, default ~80), emit fixed-size positional windows (e.g. 20 lines, 50% overlap) as child `TreeNode`s with `symbol_kind: "fragment"`. Parent symbol node remains for navigation; BM25 hits the fragments for retrieval. Tree navigation tools (`get_tree`) hide fragments by default. Note: fragments must NOT participate in `definition_boost` (they have no symbol name) and SHOULD inherit their parent's noise penalty.

**Tier 2 acceptance:** Improvement on long-function QRels in `tests/search-quality.test.ts`. Add 3–5 QRels specifically targeting long-body matches (e.g. queries matching a single internal block of a 150+ line function). Skip Task 2.2 unless 2.1 leaves measurable headroom.

---

## Tier 3 — RRF Fusion Scaffold + Adaptive Lexical Weighting

**Problem:** The current scorer sums weighted contributions into one score. To layer in semantic retrieval cleanly (Tier 4) we need ranked-list fusion, not weighted sums — score distributions across heterogeneous signals don't compose well by addition. This is also the tier where Semble-style adaptive lexical weighting becomes meaningful (see Task 3.2, formerly Task 1.4).

### Task 3.1: RRF refactor

**Files:**
- Modify: `src/store.ts` — refactor `searchDocuments` internals
- Modify: `src/types.ts` — add `rrf_k` (default 60), `signal_weights: Record<string, number>`

**Step:**
1. Have each retrieval signal (BM25-exact, BM25-prefix, subtoken match, future semantic) produce its own ranked list of `{node_id, rank}`.
2. Fuse via Reciprocal Rank Fusion: `score(d) = Σ weight_s · 1/(k + rank_s(d))`, default `k=60`.
3. Apply Tier 1 multipliers (definition boost, noise penalty, file coherence) to the fused score, NOT to individual per-signal scores. Multipliers operate on whole-result ranking, not on individual retriever lists.
4. Keep the public API of `searchDocuments` unchanged.

### Task 3.2: Adaptive signal weighting (formerly Task 1.4)

**Files:**
- Modify: `src/store.ts` — detect query shape, scale per-signal RRF weights

**Step:** When the query is symbol-shaped (heuristic from Task 1.4 step), bump `signal_weights["bm25_exact"]` and dampen `signal_weights["subtoken"]`. When natural-language, leave defaults. This is the Semble-style adaptive weighting in its proper home — between two ranked retrievers, not on a single BM25 stream.

**Tier 3 acceptance:** No regression on existing search-quality tests after Task 3.1 (RRF should be ranking-equivalent to the current weighted sum given a single-signal pipeline). Task 3.2 ships with QRels covering both query shapes — symbol-shaped queries should improve precision@1, natural-language queries should not regress.

---

## Tier 4 — Optional Static Embeddings (gated, biggest decision)

This is the only tier that breaks "zero embeddings, no model files." Default install must remain dependency-free; embeddings opt-in via `SEMANTIC=1`.

**Decision required before starting:**
- Does our search-quality corpus show meaningful recall failures on natural-language queries after Tiers 1–3? Run a measurement specifically on natural-language QRels (excluding `category: "exact"`) — that's the slice Tier 4 targets.
- Are users willing to accept an ~30MB model-weights file (one-time download to `$XDG_CACHE_HOME/treenav-mcp/`, not bundled in the npm tarball)?
- **Index-time budget:** measure embedding cost on a representative 5k-file corpus before committing. Semble's "~250ms index" is for small/medium repos; potion-code-16M token-lookup-and-mean-pool over thousands of nodes can reach tens of seconds. If index time exceeds 30s on 5k files, the "fast index" pitch is broken even with `SEMANTIC=1` — reconsider before shipping.

If all three answers are favorable:

### Task 4.1: Pure-TS Model2Vec runtime (preferred path)

**Rationale:** Model2Vec inference is *literally* tokenize → per-token lookup in a fixed embedding table → mean-pool → optional L2-normalize. No forward pass, no attention. PCA and Zipf weighting are baked into the embedding matrix at distillation time, not applied at runtime. A tensor execution engine (`onnxruntime-node`, ~50MB native binary, no Alpine/musl prebuilt, spotty Linux ARM64 prebuilts) is massive overkill for a hashmap lookup and a mean. Implementing it directly in TypeScript preserves the "no binary deps" install story and keeps the install footprint to just the model weights.

`model2vec-rs` was considered and rejected: it ships only a Rust crate + CLI + experimental browser-WASM build. There are no Node/NAPI bindings, so using it from Bun would require either writing our own NAPI layer, shelling out to a CLI per query (latency unacceptable), or an unproven WASM-via-`bun:ffi` integration. All three are larger projects than just porting the inference loop.

**Embedding-equivalence claim.** Because PCA and Zipf weighting are baked into the matrix and runtime is plain mean-pool, our embeddings will be **bit-equivalent (within float32 epsilon) to Semble's** for any input string both tokenizers tokenize identically. Quality parity therefore hinges on tokenizer fidelity, not on inference math. Validation gate before merging PR 9: golden-vector test — encode a fixed corpus of 100 strings (mix of natural language, identifiers, code) with the reference Python `model2vec` library AND our pure-TS path; assert max cosine distance ≤ 1e-5 per pair. Any divergence is a tokenizer bug we must fix before claiming parity.

**Files:**
- Add: `src/embeddings.ts` — tokenizer load + embedding-matrix `mmap` + lookup + mean-pool + optional L2 normalize (~80–120 lines)
- Add: `src/embeddings-loader.ts` — fetch + cache the weights file on first `SEMANTIC=1` run (HuggingFace Hub URL → `$XDG_CACHE_HOME/treenav-mcp/potion-code-16M/`)
- Modify: `src/code-indexer.ts` and `src/indexer.ts` — embed leaf nodes when `SEMANTIC=1`
- Modify: `src/store.ts` — store `Float32Array` per node; cosine over BM25 top-K candidates only (not full corpus) for tractable latency
- Modify: `src/types.ts` — extend `RankingParams` with semantic config
- Modify: `package.json` — add `@huggingface/tokenizers` as the *only* new dep (Apache-2.0, ~300KB unpacked, pure JS/TS, no native bindings, runs on any hardware where Bun runs). **Do not** use `@huggingface/transformers` — that package depends on `onnxruntime-node` + `sharp` and would silently re-introduce the binary-deps problem.
- Add: `tests/embeddings-parity.test.ts` — golden-vector test against Python `model2vec` reference outputs (vectors checked into the repo, not regenerated at test time)

**Step:**
1. Load `potion-code-16M` weights (Model2Vec, static embeddings — no transformer inference at runtime, just token lookup + mean-pool). Fits the "no GPU, no API" claim. Read the embedding matrix into a single `Float32Array` backed by `mmap` where possible.
2. Index time: tokenize node text → token IDs → gather rows from the embedding matrix → mean-pool → optionally L2-normalize → store as `Float32Array(256)` per node. Honor the model's `normalize` flag from its config (POTION models default to true).
3. Query time: embed query the same way, cosine-rank against BM25 top-K candidates (not the whole corpus — keeps latency in Semble's ballpark).
4. Feed cosine-ranked list into the Tier 3 RRF fuser as a third signal.
5. Run the parity test as a CI gate; do not merge until cosine distance to reference vectors is within tolerance.

**Fallback (only if pure-TS path proves blocked):** add `onnxruntime-node` as an *optional* dependency and gate `SEMANTIC=1` behind it. Document the install-size and Alpine/ARM caveats clearly in the README. Do not pursue this unless steps 1–2 above hit an unforeseen blocker (most likely cause: tokenizer fidelity gap that can't be closed) — the pure-TS path is preferred specifically because it preserves the project's install story.

### Task 4.2: Documentation + benchmarks

**Files:**
- Modify: `README.md`, `CLAUDE.md` — document `SEMANTIC=1`, weights file location, install size impact
- Add: `docs/benchmarks.md` — publish NDCG@10 with/without semantic, index time, query latency on the same corpora Semble uses if possible

**Tier 4 acceptance:** Default install size + behavior unchanged. With `SEMANTIC=1`:
- **Embedding parity**: golden-vector test (Task 4.1, step 5) passes — our embeddings match the reference Python `model2vec` output within 1e-5 cosine distance on a 100-string fixture.
- Index time ≤ 5× the BM25-only index time on a 5k-file corpus.
- Query p95 < 50ms.
- NDCG@10 lift over Tier 3 ≥ 0.05 on natural-language QRels (the corpus we already control). Comparing to Semble's published 0.854 on their eval is informational only — different corpus, different ground truth, not a direct comparison. Once parity passes, retrieval-quality differences from Semble come from corpus + ranking pipeline, NOT from the embedder.

---

## Sequencing & PR Plan

Each PR ships isolated so before/after NDCG@10 deltas attribute cleanly. Bundling tasks (as the original PR 1 did) lets a regression in one mask a win in another.

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

Every code-change PR ships with new QRels and a before/after metric table specific to that PR's claim — no aggregate-only metrics, since they hide regressions.

## Open Questions

- For sub-symbol chunking, do we want fragments to participate in `get_tree` output for agents that explicitly ask for them, or stay hidden behind a flag?
- ~~Tier 4: prefer `onnxruntime-node` or a pure-JS Model2Vec runtime?~~ **Resolved (2026-05-04):** pure-TS Model2Vec runtime is the preferred path; `onnxruntime-node` is fallback-only. See Task 4.1 rationale. `model2vec-rs` was considered and rejected (no Node/NAPI bindings).
- Should `definition_boost` and `subtoken_weight` be per-collection too, or is global enough? (Suggest global until a real corpus shows otherwise — don't speculate.)
