# Tier 4 Decision Review

**Date:** 2026-05-06
**Author:** measurement run for [docs/plans/2026-05-03-semble-feature-port.md](2026-05-03-semble-feature-port.md), PR 8
**Status:** Recommendation — **close out Tier 4 for now**; revisit only if a real corpus surfaces an NL-recall regression

This is the data-driven review the Semble-feature-port plan calls for before
deciding whether to ship Tier 4 (pure-TS Model2Vec embeddings under
`SEMANTIC=1`). Three measurements were collected against current `main`
(commit `faef40b`); the fixture for the future PR-9 parity gate was also
produced. All raw numbers are reproducible via the scripts checked in alongside
this doc.

---

## Measurement 1 — NL vs exact-match NDCG@10 split

**Goal:** quantify the headroom Tier 4 could realistically buy. The plan
identifies natural-language / synonym queries as the slice where static
embeddings would help; everything else is BM25's home turf.

**Buckets** (re-grouping the existing QRel categories):

- **Exact-friendly:** `exact`, `multi-term`, `code-symbol`, `discriminating`
- **NL / recall-leaning:** `synonym`, `facet-filtered`

  `facet-filtered` was included in the NL bucket because its scoring path
  (filter + lexical) is the closest analog the corpus has to broad recall —
  the `synonym` bucket alone is only 6 QRels, which is too few to read
  confidently. `zero-result` was excluded entirely (NDCG of an empty ideal is
  vacuously 1 and would inflate the average).

**Harness:** `scripts/measure-tier4.ts` reuses the same QRel resolution and
NDCG@10 implementation as `tests/search-quality.test.ts` (verbatim copy of
`ndcgAtK` from that file), feeding through `DocumentStore.searchDocuments`.

### Results

| Bucket | QRels | Evaluated | Mean NDCG@10 |
| --- | ---: | ---: | ---: |
| exact-friendly | 53 | 52 | **0.8353** |
| NL / recall-leaning | 13 | 13 | **0.8481** |
| Gap (exact − NL) | — | — | **−0.0128** |

Per-category breakdown:

| Category | n | Mean NDCG@10 |
| --- | ---: | ---: |
| exact | 9 | 0.8113 |
| multi-term | 19 | 0.7928 |
| code-symbol | 19 | 0.9313 |
| discriminating | 5 | 0.6754 |
| synonym | 6 | 0.8158 |
| facet-filtered | 7 | 0.8758 |

**Headroom on the NL bucket:** `1.0000 − 0.8481 = 0.1519`. Tier 4's acceptance
gate is a `≥ 0.05` lift over Tier 3, which would have to come from this
0.1519 of remaining headroom. The bucket is already at 0.85, and the
within-bucket gap between `synonym` (the slice semantic embeddings most plausibly
help) and `facet-filtered` (where embeddings would not change the filter logic)
is only 0.06.

### Takeaway

The NL bucket is **not bottlenecking** retrieval quality on this corpus.
Tier 1–3 (subtoken indexing, RRF fusion, query-shape adaptive weighting,
glossary expansion) have already closed most of the gap that motivated Tier 4
in the original plan. The slice Tier 4 targets is now at 0.85 NDCG@10, with
the lowest-scoring sub-bucket being `discriminating` (0.68) — but that's an
exact-friendly category, not an NL one, so static embeddings would not
help it.

---

## Measurement 2 — Cold-index timing on a real-shape corpus

**Goal:** ground-truth the plan's "fast index" claim. The acceptance gate is
`index time ≤ 30 s on a 5k-file corpus`. Two corpora were measured.

### Corpus A — installed `node_modules` tree (medium, low-test density)

`bun init` + `bun add @modelcontextprotocol/sdk typescript zod react react-dom express` →
1,488 source files indexed (the indexer's `EXCLUDED_DIRS` strips nested
`node_modules/`, `dist/`, `build/`, etc.).

| Metric | Value |
| --- | ---: |
| Files indexed | **1,488** |
| Total tree nodes | 49,461 |
| Index wall-clock (`indexCodeCollection`) | **489 ms** |
| Per-file mean | **0.33 ms** |
| Store load | 3,387 ms |
| Total cold pipeline | 3,876 ms |
| RSS delta after index | +205 MB |
| RSS delta after store load | +1,071 MB |
| Heap delta after store load | +344 MB |

### Corpus B — `microsoft/TypeScript` clone (large, dense test fixtures)

Full clone (`git clone --depth 1 microsoft/TypeScript`) → 39,318 files
indexed, dominated by the `tests/baselines/` directory.

| Metric | Value |
| --- | ---: |
| Files indexed | **39,318** |
| Total tree nodes | 282,834 |
| Index wall-clock | **2,337 ms** |
| Per-file mean | **0.06 ms** |
| Store load | 7,795 ms |
| Total cold pipeline | 10,132 ms |
| RSS delta after index | +611 MB |
| RSS delta after store load | +2,889 MB |
| Heap delta after store load | +1,019 MB |

### 5k-file projection

Linear extrapolation from Corpus A's per-file rate:
`0.33 ms × 5,000 = 1.6 s` for index, well under the 30 s gate.
From Corpus B: `0.06 ms × 5,000 = 0.3 s` — both anchors comfortably pass.

### Takeaway

The "fast index" pitch is **already comfortably met by BM25 alone**. Tier 4
would add a per-leaf-node embedding step (tokenize → table lookup → mean-pool)
on top of these numbers. With 49k–283k tree nodes per corpus, even at a few
microseconds per node the embedding pass would dominate; the plan's `≤ 5×
BM25-baseline` budget therefore has real headroom but also a real risk of
collapsing the install-story advantage. The bigger concern from the
measurements is **memory**: store-load alone consumes ~1 GB on the
TypeScript repo today. Adding a 256-float vector per node to a 280k-node
store is ~287 MB extra heap before any model weights are loaded. That's
worth modelling carefully before committing.

---

## Measurement 3 — Tokenizer-parity golden-vector fixture

**Goal:** lay the groundwork for PR 9's CI gate (`max cosine distance ≤ 1e-5`
between Python reference vectors and our future pure-TS port).

### Status — **fixture generated**

| Field | Value |
| --- | --- |
| Path | `tests/fixtures/model2vec-golden-vectors.json` |
| Size | 566,233 bytes (~566 KB) |
| Reference model | `minishlab/potion-code-16M` |
| Reference library | `model2vec==0.8.1` (Python, MinishLab) |
| Embedding dim | 256 |
| Normalization | L2 (model default for POTION) |
| String count | 100 |

The 100 strings span: 15 English-prose sentences, 20 code identifiers and
symbol references, 10 file paths (including a Windows-style backslash path),
10 mixed-case acronyms, 10 non-ASCII strings (Cyrillic, CJK, accented Latin,
Greek, em-dash, smart quotes, an emoji), 15 mixed natural-language-plus-code
fragments, and 20 edge cases (single character, single digit, punctuation
only, leading/trailing whitespace, embedded tabs and newlines, brackets,
slash- / dash- / underscore-joined tokens, inline / block comment syntax).

The list is stable and not shuffled — PR 9's parity test is expected to
iterate it positionally so any divergence reports the offending input
verbatim.

The generator script is checked in at
`scripts/generate-golden-vectors.py`. It is intentionally not wired into
`bun test` or CI: the fixture must be a fixed artifact, not regenerated at
test time. Re-running the generator requires `pip install model2vec` in a
Python ≥ 3.10 venv (the worktree used `/opt/homebrew/bin/python3.12`).

### What PR 9 still needs

When (if) Tier 4 is picked back up, the parity gate test
(`tests/embeddings-parity.test.ts` per the plan) needs to:

1. Load this fixture once in `beforeAll`.
2. Re-encode each string with the pure-TS embedder.
3. Assert `cosine_distance(reference_vec, ts_vec) ≤ 1e-5` per pair.
4. Fail fast on the first divergence with the offending text included.

The fixture itself is already locked in — nothing else is required from
PR-8's measurement scope.

---

## Recommendation

**Close out Tier 4. Defer the pure-TS Model2Vec runtime indefinitely.**

The acceptance criterion for Tier 4 was "NDCG@10 lift ≥ 0.05 on the natural-
language QRel slice over Tier 3." The current measurement places the NL slice
at 0.8481 — only 0.0128 *below* the exact-friendly slice and only 0.1519 from
the ceiling. There is no slope here to improve along: the corpus does not
exhibit the NL-recall failures the plan hypothesized Tier 4 would catch.
Shipping a 30 MB model-weights download, an embedding store taking ~1 KB per
leaf node, and a tokenizer port to chase a sub-0.05 NDCG@10 improvement on
six synonym queries would be a poor trade for the install-footprint and
maintenance cost.

The "fast index" pitch is also not in danger from Tiers 1–3 alone — BM25
indexing on a 39 k-file corpus completes in ~2.3 s. There is room within the
plan's `≤ 5× BM25-baseline` budget for Tier 4 to add embeddings without
breaking that pitch outright, but the budget would be measurably tighter than
on a small corpus, and memory per node would grow non-trivially. None of
that work is justified without a real-corpus signal that NL recall is
failing first.

What this review *does* unblock is a fast resumption if that signal ever
appears. The golden-vector fixture (`tests/fixtures/model2vec-golden-vectors.json`)
is locked in, generated against `model2vec==0.8.1` and `potion-code-16M`,
and ready for the PR-9 parity gate. The measurement script
(`scripts/measure-tier4.ts`) is reusable: re-run it against any future
corpus to re-test the bucket gap before re-opening the question.

### What PR 9 needs *if* the decision is later flipped

- **Trigger condition:** a real-corpus NDCG@10 measurement shows the NL
  bucket >0.10 below the exact-friendly bucket (today the gap is −0.013).
  Re-run `scripts/measure-tier4.ts` against the corpus where the regression
  is observed; do not extrapolate from the search-quality fixture.
- **Index-time budget gate:** PR 9 must keep `total cold pipeline ≤ 5 ×`
  the BM25 baseline measured here (3.9 s for 1,488 files; 10.1 s for
  39,318 files). Anything worse breaks the plan's published claim.
- **Memory budget gate:** track `process.memoryUsage().heapUsed` delta
  with semantic-index-on vs semantic-index-off. The 280 k-node TypeScript
  corpus implies +~287 MB heap just for vectors before model weights;
  state explicitly whether that's acceptable on the targeted runtime.
- **Parity gate:** wire `tests/embeddings-parity.test.ts` to the
  fixture generated here; assert max cosine distance `≤ 1e-5` per the
  plan's Section 4.1, step 5.
- **Fallback path:** the plan lists `onnxruntime-node` as a fallback only
  if the pure-TS port hits an unfixable tokenizer-fidelity gap. That
  fallback should not be invoked silently; if PR 9 goes that route it
  needs its own decision review with the install-size impact stated up
  front.

---

## Reproducing the numbers

```bash
# Measurement 1 (NL vs exact NDCG@10)
bun run scripts/measure-tier4.ts

# Measurement 2 (index time on a custom corpus)
bun run scripts/measure-tier4.ts --corpus /path/to/repo

# Measurement 3 (regenerate the fixture)
python3.12 -m venv /tmp/tier4-venv
/tmp/tier4-venv/bin/pip install model2vec
/tmp/tier4-venv/bin/python scripts/generate-golden-vectors.py \
  > tests/fixtures/model2vec-golden-vectors.json
```
