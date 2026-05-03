# Porting Semble's Code-Search Wins to Treenav

**Goal:** Close the practical gap between Treenav and [Semble](https://github.com/MinishLab/semble) on code search quality without abandoning Treenav's design ethos: tree navigation as the primary retrieval model, BM25 as the deterministic core, and Bun-native zero-LLM operation by default.

**Approach:** Four tiers, ordered by impact-per-effort. Tiers 1–3 are pure-algorithm changes with no new dependencies and no philosophical shift. Tier 4 is gated behind an opt-in flag and requires a deliberate decision before adoption.

---

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
- Modify: `src/store.ts` — add `definition_boost` multiplier in scoring path
- Modify: `src/types.ts` — add `definition_boost: number` to `RankingParams` (default ~2.0)
- Test: `tests/search-quality.test.ts` — add QRels asserting definition ranks first

**Step:** When a query token (after stemming + glossary expansion) exactly matches `node.title` and `node.symbol_kind` is set (`class`/`function`/`interface`/`method`/`type`/`enum`), multiply that node's score by `definition_boost`.

### Task 1.2: Identifier-stem subtoken indexing

**Problem:** Query `parse` does not match symbol `parseFrontmatter` because the indexer tokenizes the whole identifier as one term. Semble splits camelCase/snake_case/kebab-case at index time.

**Files:**
- Modify: `src/code-indexer.ts` — emit subtokens for identifiers
- Modify: `src/store.ts` — add a separate posting list (or weight class) for subtoken hits
- Modify: `src/types.ts` — add `subtoken_weight` (default ~0.5)
- Test: `tests/parsers.test.ts` + `tests/search-quality.test.ts`

**Step:** At index time, for each code node, also emit subtokens by splitting `[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|[0-9]+` and on `_` / `-`. Index them into a separate weighted band so a subtoken hit scores below a full-token hit but above no-match. Skip subtokens already identical to the full token.

### Task 1.3: Noise penalties for tests, type stubs, legacy paths

**Problem:** Test files and `.d.ts` stubs often share vocabulary with implementation files and pollute top-K. Semble down-weights these explicitly.

**Files:**
- Modify: `src/types.ts` — add `noise_patterns: { pattern: string; penalty: number }[]` to `RankingParams`
- Modify: `src/store.ts` — apply penalty multiplier per node based on file path
- Test: `tests/search-quality.test.ts`

**Step:** Default noise list (overridable per deployment):

```ts
[
  { pattern: "(^|/)__tests__/", penalty: 0.5 },
  { pattern: "\\.test\\.[a-z]+$", penalty: 0.5 },
  { pattern: "\\.spec\\.[a-z]+$", penalty: 0.5 },
  { pattern: "\\.d\\.ts$", penalty: 0.3 },
  { pattern: "(^|/)vendor/", penalty: 0.4 },
  { pattern: "(^|/)legacy/", penalty: 0.6 },
  { pattern: "(^|/)node_modules/", penalty: 0.1 },
]
```

Match against `node.path`; multiply final score.

### Task 1.4: Adaptive lexical weighting

**Problem:** Symbol-shaped queries (`parseFrontmatter`, `_init`, `BM25_K1`) want lexical precision; natural-language queries (`how do I configure auth`) want recall. Semble bumps lexical weight when the query looks identifier-shaped.

**Files:**
- Modify: `src/store.ts` — detect query shape, scale BM25 weight before fusion (also unblocks Tier 4)

**Step:** Heuristic: if the query is a single token AND matches `/[A-Z]/.test(q) || /_/.test(q) || /^[a-z]+[A-Z]/.test(q)`, treat as symbol-like and apply a `symbol_query_boost` (default ~1.3) to BM25 contributions. Otherwise leave weights unchanged.

### Task 1.5: File coherence bonus

**Problem:** When several results come from the same file, the highest-ranked one should land at a natural entry point (top of file, exported symbol, class def) rather than a random inner method.

**Files:**
- Modify: `src/store.ts` — post-aggregation pass before final sort

**Step:** After per-node accumulation, group results by `path`. For each group, give the node closest to the top of the file (or with shallowest `depth`) a small bonus (`file_coherence_bonus`, default ~0.1× max group score). Does not change which files appear, only which node within a file leads.

**Tier 1 acceptance:** Add ≥10 new QRels to `tests/search-quality.test.ts` covering definition lookups, subtoken queries, and noise filtering. Target: NDCG@10 improvement ≥0.05 on the code corpus, no regression on the markdown corpus.

---

## Tier 2 — Sub-Symbol Chunking (small refactor)

**Problem:** Treenav's AST symbol extraction makes a 200-line function a single `TreeNode`. BM25 over that node loses positional precision — a query matching three lines deep in the body scores the same as one matching the signature.

**Decision point:** Two options, do the cheaper one first.

### Task 2.1 (preferred first): Snippet density tuning

**Files:**
- Modify: `src/store.ts` (snippet generator)

**Step:** When generating snippets for long nodes, prefer windows where multiple query terms co-occur (already partially done via `term_proximity_bonus`; extend to snippet selection itself). Surface the best window as the snippet rather than the node summary. No tree changes; better answer locality for the agent.

### Task 2.2 (only if 2.1 isn't enough): Sub-symbol child nodes

**Files:**
- Modify: `src/code-indexer.ts`
- Modify: `src/types.ts`

**Step:** For nodes whose body exceeds N lines (configurable, default ~80), emit fixed-size positional windows (e.g. 20 lines, 50% overlap) as child `TreeNode`s with `symbol_kind: "fragment"`. Parent symbol node remains for navigation; BM25 hits the fragments for retrieval. Tree navigation tools (`get_tree`) hide fragments by default.

**Tier 2 acceptance:** Improvement on long-function QRels in `tests/search-quality.test.ts`. Skip Task 2.2 unless the metric demands it.

---

## Tier 3 — RRF Fusion Scaffold (small, enables Tier 4)

**Problem:** The current scorer sums weighted contributions into one score. To layer in semantic retrieval cleanly (Tier 4) we need ranked-list fusion, not weighted sums — score distributions across heterogeneous signals don't compose well by addition.

**Files:**
- Modify: `src/store.ts` — refactor `searchDocuments` internals
- Modify: `src/types.ts` — add `rrf_k` (default 60), `signal_weights: Record<string, number>`

**Step:**
1. Have each retrieval signal (BM25-exact, BM25-prefix, subtoken match, future semantic) produce its own ranked list of `{node_id, rank}`.
2. Fuse via Reciprocal Rank Fusion: `score(d) = Σ weight_s · 1/(k + rank_s(d))`, default `k=60`.
3. Apply Tier 1 multipliers (definition boost, noise penalty, file coherence) to the fused score.
4. Keep the public API of `searchDocuments` unchanged.

**Tier 3 acceptance:** No regression on existing search-quality tests; pipeline cleanly accepts a new signal in Tier 4 with a one-line addition.

---

## Tier 4 — Optional Static Embeddings (gated, biggest decision)

This is the only tier that breaks "zero embeddings, no model files." Default install must remain dependency-free; embeddings opt-in via `SEMANTIC=1`.

**Decision required before starting:**
- Does our search-quality corpus show meaningful recall failures on natural-language queries after Tiers 1–3?
- Are users willing to accept an ~16M-param ONNX weights file (~30MB)?

If both answers are yes:

### Task 4.1: ONNX Runtime integration

**Files:**
- Add: `src/embeddings.ts` — model load + token-to-vector lookup + mean-pool
- Modify: `package.json` — add `onnxruntime-node` as **optional** dependency
- Modify: `src/code-indexer.ts` and `src/indexer.ts` — embed leaf nodes when `SEMANTIC=1`
- Modify: `src/store.ts` — store `Float32Array` per node; cosine over BM25 top-K candidates only (not full corpus) for tractable latency
- Modify: `src/types.ts` — extend `RankingParams` with semantic config

**Step:**
1. Use `potion-code-16M` (Model2Vec, static embeddings — no transformer inference at runtime, just token lookup + mean-pool). Fits the "no GPU, no API" claim.
2. Index time: tokenize node text, look up vectors, mean-pool, store as `Float32Array(256)`.
3. Query time: embed query the same way, cosine-rank against BM25 top-K candidates (not the whole corpus — keeps latency in Semble's ballpark).
4. Feed cosine-ranked list into the Tier 3 RRF fuser as a third signal.

### Task 4.2: Documentation + benchmarks

**Files:**
- Modify: `README.md`, `CLAUDE.md` — document `SEMANTIC=1`, weights file location, install size impact
- Add: `docs/benchmarks.md` — publish NDCG@10 with/without semantic, index time, query latency on the same corpora Semble uses if possible

**Tier 4 acceptance:** Default install size + behavior unchanged. With `SEMANTIC=1`: NDCG@10 within 2 points of Semble on a comparable code corpus, query p95 < 50ms.

---

## Sequencing & PR Plan

| PR | Scope | Deps | Risk |
|----|-------|------|------|
| 1 | Tier 1.1 + 1.3 + 1.5 (definition boost, noise, file coherence) | none | low |
| 2 | Tier 1.2 (subtoken indexing) | PR 1 | low |
| 3 | Tier 1.4 (adaptive lexical weighting) | PR 1 | low |
| 4 | Tier 2.1 (snippet density tuning) | PR 1–3 | low |
| 5 | Tier 3 (RRF refactor) | PR 1–4 | medium — touches scoring path |
| 6 | Decision review: do we need Tier 4? | PR 5 + benchmarks | — |
| 7 | Tier 4.1 + 4.2 (only if PR 6 says yes) | PR 5 | medium — new dep, install-size impact |

PRs 1–4 should each include new QRels in `tests/search-quality.test.ts` to ground the win. PR 5 should ship with a before/after NDCG@10 table.

## Open Questions

- Should the noise-pattern list be configurable per collection (e.g. different patterns for the markdown wiki vs. the code root)?
- For sub-symbol chunking, do we want fragments to participate in `get_tree` output for agents that explicitly ask for them?
- Tier 4: prefer `onnxruntime-node` (binary deps) or a pure-JS Model2Vec runtime if one exists?
