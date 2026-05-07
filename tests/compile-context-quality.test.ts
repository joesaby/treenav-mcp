/**
 * compile_context Accuracy Parity Gate — Layer 2
 *
 * Validates that compileContext (mode="search") returns search results that
 * are equivalent in quality to the baseline store.searchDocuments() across
 * the full QRel set used by tests/search-quality.test.ts.
 *
 * Pass criteria (mirror the existing search-quality suite):
 *   Overall  NDCG@10  ≥ 0.65  AND  ≥ baseline mean − 0.005 (no regression)
 *   Exact-match NDCG@10 ≥ 0.80
 *   Mean MRR ≥ 0.70
 *   Per-language NDCG@10 (8 languages) ≥ 0.65 each
 *   Per-domain NDCG@10 (7 domains) ≥ 0.65 each
 *
 * Merge strategy for composed results:
 *   compileContext returns up to top_k_per_source=10 hits each for docs and
 *   code (up to 20 hits total). To match the baseline's single global BM25
 *   ranking, we re-sort all hits by score descending before taking top-10.
 *   This is an apples-to-apples comparison: same query, same BM25 scoring,
 *   same top-10 cut.
 *
 * NOTE: IR metric helpers (ndcgAtK, reciprocalRank, meanReciprocalRank) and
 * corpus/QRel resolution helpers are duplicated here from search-quality.test.ts
 * because they are tightly coupled to the store instance created in beforeAll.
 * Long-term these could be factored into tests/helpers/quality-corpus.ts but
 * the duplication is acceptable for v1 to avoid touching the gate test.
 */

import { beforeAll, describe, test, expect } from "bun:test";
import { join } from "node:path";
import { indexCollection } from "../src/indexer";
import { indexCodeCollection } from "../src/code-indexer";
import { DocumentStore } from "../src/store";
import { compileContext } from "../src/compile-context";
import { QRELS } from "./fixtures/search-quality-qrels";
import type { RawQRel } from "./fixtures/search-quality-qrels";
import type { CompileContextHit } from "../src/types";

// ── Corpus paths ───────────────────────────────────────────────────────────────

const MD_ROOT   = join(import.meta.dir, "fixtures/search-quality/md");
const CODE_ROOT = join(import.meta.dir, "fixtures/search-quality/code");

// ── Store (populated once in beforeAll) ───────────────────────────────────────

let store: DocumentStore;

beforeAll(async () => {
  const [mdDocs, codeDocs] = await Promise.all([
    indexCollection({ root: MD_ROOT, name: "docs" }),
    indexCodeCollection({ root: CODE_ROOT, name: "code" }),
  ]);
  store = new DocumentStore();
  store.load([...mdDocs, ...codeDocs]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// IR metric helpers — duplicated from search-quality.test.ts (see file note above)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * NDCG@K — Normalized Discounted Cumulative Gain.
 * Returns 1.0 when there are no relevant documents (vacuous truth).
 */
function ndcgAtK(
  ranked: string[],
  relevance: Map<string, number>,
  k: number
): number {
  const topK = ranked.slice(0, k);
  const dcg = topK.reduce(
    (sum, id, i) => sum + (relevance.get(id) ?? 0) / Math.log2(i + 2),
    0
  );
  const ideal = [...relevance.values()]
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
  return ideal === 0 ? 1 : dcg / ideal;
}

/** Reciprocal rank for a single query (MRR component). */
function reciprocalRank(ranked: string[], relevant: Set<string>): number {
  const idx = ranked.findIndex(id => relevant.has(id));
  return idx === -1 ? 0 : 1 / (idx + 1);
}

/** Mean Reciprocal Rank across multiple queries. */
function meanReciprocalRank(
  queries: Array<{ ranked: string[]; relevant: Set<string> }>
): number {
  if (queries.length === 0) return 0;
  const total = queries.reduce(
    (sum, q) => sum + reciprocalRank(q.ranked, q.relevant),
    0
  );
  return total / queries.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Node resolution helpers — duplicated from search-quality.test.ts
// ═══════════════════════════════════════════════════════════════════════════════

function findDocId(titleFragment: string): string | null {
  const listing = store.listDocuments({ limit: 200 });
  return (
    listing.documents.find(d =>
      d.title.toLowerCase().includes(titleFragment.toLowerCase())
    )?.doc_id ?? null
  );
}

function findNodeId(docId: string, nodeTitle?: string): string | null {
  const tree = store.getTree(docId);
  if (!tree) return null;
  if (!nodeTitle) return tree.nodes[0]?.node_id ?? null;

  const q = nodeTitle.toLowerCase();

  const exact = tree.nodes.find(n => n.title === nodeTitle);
  if (exact) return exact.node_id;

  const exactCI = tree.nodes.find(n => n.title.toLowerCase() === q);
  if (exactCI) return exactCI.node_id;

  const byName = tree.nodes.find(n => {
    const parts = n.title.split(" ");
    const name = parts.length > 1 ? parts.slice(1).join(" ").toLowerCase() : parts[0].toLowerCase();
    return name === q;
  });
  if (byName) return byName.node_id;

  const byNameSubstr = tree.nodes.find(n => {
    const parts = n.title.split(" ");
    const name = parts.length > 1 ? parts.slice(1).join(" ").toLowerCase() : parts[0].toLowerCase();
    return name.includes(q);
  });
  if (byNameSubstr) return byNameSubstr.node_id;

  return tree.nodes.find(n => n.title.toLowerCase().includes(q))?.node_id ?? null;
}

interface ResolvedQRel {
  id: string;
  query: string;
  category: string;
  filter?: Record<string, string[]>;
  relevance: Map<string, number>;
  hasAnyRelevant: boolean;
}

function resolveQRels(raw: RawQRel[]): ResolvedQRel[] {
  return raw.map(qr => {
    const relevance = new Map<string, number>();

    for (const rel of qr.relevant) {
      const docId = findDocId(rel.docTitle);
      if (!docId) continue;
      const nodeId = findNodeId(docId, rel.nodeTitle);
      if (!nodeId) continue;
      relevance.set(nodeId, rel.relevance);
    }

    return {
      id: qr.id,
      query: qr.query,
      category: qr.category,
      filter: qr.filter,
      relevance,
      hasAnyRelevant: relevance.size > 0,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Query runners
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Baseline: direct store.searchDocuments — same as search-quality.test.ts.
 * Returns top-10 node_ids ranked by BM25 score.
 */
function runBaseline(query: string, filter?: Record<string, string[]>, limit = 10): string[] {
  return store
    .searchDocuments(query, { limit, filters: filter })
    .map(r => r.node_id);
}

/**
 * Composed: compileContext with mode="search", sources=["all"], top_k_per_source=10.
 * Merges docs + code hits, re-sorts globally by score, takes top-10.
 *
 * Re-sorting is necessary because compileContext ranks per-source independently
 * (docs hits sorted by BM25, code hits sorted by BM25). A global re-sort makes
 * the final ranked list equivalent to what a single searchDocuments call with
 * no collection filter would produce — the correct apples-to-apples comparison.
 */
function runComposed(query: string, filter?: Record<string, string[]>): string[] {
  const { result } = compileContext(store, {
    intent: query,
    mode: "search",
    sources: ["all"],
    filters: filter,
    output: {
      top_k_per_source: 10,
      max_tokens: 8000,
    },
  });

  const all: CompileContextHit[] = [
    ...result.hits_by_source.docs,
    ...result.hits_by_source.code,
    ...result.hits_by_source.rows,
  ].sort((a, b) => b.score - a.score);

  return all.slice(0, 10).map(h => h.node_id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Aggregate parity metrics
// ═══════════════════════════════════════════════════════════════════════════════

describe("compile_context accuracy parity — aggregate IR metrics", () => {
  // NOTE: resolveQRels() must be called inside each test (after beforeAll).

  test("overall NDCG@10 ≥ 0.65 (composed) and ≥ baseline − 0.005 (no regression)", () => {
    const scorableQrels = resolveQRels(
      QRELS.filter(q => q.category !== "zero-result")
    ).filter(q => q.hasAnyRelevant);

    const baselineScores = scorableQrels.map(qr => {
      const ranked = runBaseline(qr.query, qr.filter, 10);
      return ndcgAtK(ranked, qr.relevance, 10);
    });
    const composedScores = scorableQrels.map(qr => {
      const ranked = runComposed(qr.query, qr.filter);
      return ndcgAtK(ranked, qr.relevance, 10);
    });

    const baselineMean = baselineScores.reduce((a, b) => a + b, 0) / baselineScores.length;
    const composedMean = composedScores.reduce((a, b) => a + b, 0) / composedScores.length;

    if (composedMean < 0.65 || composedMean < baselineMean - 0.005) {
      const byDelta = scorableQrels
        .map((qr, i) => ({
          id: qr.id,
          query: qr.query,
          baseline: baselineScores[i],
          composed: composedScores[i],
          delta: composedScores[i] - baselineScores[i],
        }))
        .sort((a, b) => a.delta - b.delta);
      console.log(
        `Overall NDCG@10: baseline=${baselineMean.toFixed(4)}, composed=${composedMean.toFixed(4)}`,
        "\nLowest delta queries:", byDelta.slice(0, 5)
      );
    }

    expect(composedMean).toBeGreaterThanOrEqual(0.65);
    expect(composedMean).toBeGreaterThanOrEqual(baselineMean - 0.005);
  });

  test("exact-match NDCG@10 ≥ 0.80 (RRF-rescaled threshold, composed)", () => {
    const exactQrels = resolveQRels(
      QRELS.filter(q => q.category === "exact")
    ).filter(q => q.hasAnyRelevant);

    const scores = exactQrels.map(qr => {
      const ranked = runComposed(qr.query, qr.filter);
      return ndcgAtK(ranked, qr.relevance, 10);
    });
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

    if (mean < 0.80) {
      const byScore = exactQrels
        .map((qr, i) => ({ id: qr.id, query: qr.query, ndcg: scores[i] }))
        .sort((a, b) => a.ndcg - b.ndcg);
      console.log(`Exact-match NDCG@10 (composed): ${mean.toFixed(4)}. Lowest:`, byScore.slice(0, 5));
    }

    expect(mean).toBeGreaterThanOrEqual(0.80);
  });

  test("mean MRR ≥ 0.70 (composed)", () => {
    const scorableQrels = resolveQRels(
      QRELS.filter(q => q.category !== "zero-result")
    ).filter(q => q.hasAnyRelevant);

    const queries = scorableQrels.map(qr => ({
      ranked: runComposed(qr.query, qr.filter),
      relevant: new Set(
        [...qr.relevance.entries()]
          .filter(([, rel]) => rel >= 2)
          .map(([id]) => id)
      ),
    }));
    const mrr = meanReciprocalRank(queries);

    if (mrr < 0.70) {
      console.log(`MRR (composed): ${mrr.toFixed(4)}`);
    }

    expect(mrr).toBeGreaterThanOrEqual(0.70);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Per-language parity
// ═══════════════════════════════════════════════════════════════════════════════

describe("compile_context accuracy parity — per-language NDCG@10 ≥ 0.65", () => {
  const LANG_QRELS: Array<{ lang: string; ids: string[] }> = [
    { lang: "java",       ids: ["C1", "C2", "F2"] },
    { lang: "python",     ids: ["C3", "F3"] },
    { lang: "typescript", ids: ["C4", "C7"] },
    { lang: "go",         ids: ["C5", "GO1", "GO2"] },
    { lang: "rust",       ids: ["C6", "RS1", "RS2"] },
    { lang: "cpp",        ids: ["CPP1", "CPP2", "CPP3"] },
    { lang: "csharp",     ids: ["CS1", "CS2", "CS3"] },
    { lang: "ruby",       ids: ["RB1", "RB2", "RB3"] },
  ];

  for (const { lang, ids } of LANG_QRELS) {
    test(`NDCG@10 ≥ 0.65 for ${lang} code queries (composed)`, () => {
      const qrels = resolveQRels(
        QRELS.filter(q => ids.includes(q.id))
      ).filter(q => q.hasAnyRelevant);

      if (qrels.length === 0) return;

      const scores = qrels.map(qr => {
        const ranked = runComposed(qr.query, qr.filter);
        return ndcgAtK(ranked, qr.relevance, 10);
      });
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

      if (mean < 0.65) {
        const byScore = qrels
          .map((qr, i) => ({ id: qr.id, query: qr.query, ndcg: scores[i] }))
          .sort((a, b) => a.ndcg - b.ndcg);
        console.log(`${lang} NDCG@10 (composed): ${mean.toFixed(4)}. Lowest:`, byScore.slice(0, 3));
      }

      expect(mean).toBeGreaterThanOrEqual(0.65);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Per-domain parity
// ═══════════════════════════════════════════════════════════════════════════════

describe("compile_context accuracy parity — per-domain NDCG@10 ≥ 0.65", () => {
  const TYPE_QRELS: Array<{ name: string; ids: string[] }> = [
    {
      name: "authentication",
      ids: ["E1", "E2", "E8", "M1", "M2", "M8", "S1", "S2", "D1", "D3"],
    },
    {
      name: "api-reference",
      ids: ["E3", "E7", "M3", "M4", "S3", "M6", "D4"],
    },
    {
      name: "operations",
      ids: ["E4", "M5", "F1", "F4", "D2"],
    },
    {
      name: "architecture",
      ids: ["E6", "M7"],
    },
    {
      name: "frontend",
      ids: ["FE1", "FE2", "FE3", "FE4", "FE5"],
    },
    {
      name: "infrastructure",
      ids: ["INF1", "INF2", "INF3", "INF4", "INF5"],
    },
    {
      name: "data-science",
      ids: ["DS1", "DS2", "DS3", "DS4"],
    },
  ];

  for (const { name, ids } of TYPE_QRELS) {
    test(`NDCG@10 ≥ 0.65 for ${name} queries (composed)`, () => {
      const qrels = resolveQRels(
        QRELS.filter(q => ids.includes(q.id))
      ).filter(q => q.hasAnyRelevant);

      if (qrels.length === 0) return;

      const scores = qrels.map(qr => {
        const ranked = runComposed(qr.query, qr.filter);
        return ndcgAtK(ranked, qr.relevance, 10);
      });
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

      if (mean < 0.65) {
        const byScore = qrels
          .map((qr, i) => ({ id: qr.id, query: qr.query, ndcg: scores[i] }))
          .sort((a, b) => a.ndcg - b.ndcg);
        console.log(`${name} NDCG@10 (composed): ${mean.toFixed(4)}. Lowest:`, byScore.slice(0, 3));
      }

      expect(mean).toBeGreaterThanOrEqual(0.65);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Diagnostic summary — prints actual numbers for both baseline and composed
// ═══════════════════════════════════════════════════════════════════════════════

describe("compile_context accuracy parity — diagnostic summary", () => {
  test("print baseline vs composed NDCG@10 and MRR numbers", () => {
    const scorableQrels = resolveQRels(
      QRELS.filter(q => q.category !== "zero-result")
    ).filter(q => q.hasAnyRelevant);

    const baselineNdcg = scorableQrels.map(qr =>
      ndcgAtK(runBaseline(qr.query, qr.filter, 10), qr.relevance, 10)
    );
    const composedNdcg = scorableQrels.map(qr =>
      ndcgAtK(runComposed(qr.query, qr.filter), qr.relevance, 10)
    );

    const bMean = baselineNdcg.reduce((a, b) => a + b, 0) / baselineNdcg.length;
    const cMean = composedNdcg.reduce((a, b) => a + b, 0) / composedNdcg.length;

    const exactQrels = resolveQRels(QRELS.filter(q => q.category === "exact")).filter(q => q.hasAnyRelevant);
    const bExactNdcg = exactQrels.map(qr => ndcgAtK(runBaseline(qr.query, qr.filter, 10), qr.relevance, 10));
    const cExactNdcg = exactQrels.map(qr => ndcgAtK(runComposed(qr.query, qr.filter), qr.relevance, 10));
    const bExactMean = bExactNdcg.reduce((a, b) => a + b, 0) / bExactNdcg.length;
    const cExactMean = cExactNdcg.reduce((a, b) => a + b, 0) / cExactNdcg.length;

    const bMrrQueries = scorableQrels.map(qr => ({
      ranked: runBaseline(qr.query, qr.filter, 10),
      relevant: new Set([...qr.relevance.entries()].filter(([, r]) => r >= 2).map(([id]) => id)),
    }));
    const cMrrQueries = scorableQrels.map(qr => ({
      ranked: runComposed(qr.query, qr.filter),
      relevant: new Set([...qr.relevance.entries()].filter(([, r]) => r >= 2).map(([id]) => id)),
    }));
    const bMrr = meanReciprocalRank(bMrrQueries);
    const cMrr = meanReciprocalRank(cMrrQueries);

    console.log("=== Accuracy Parity Report ===");
    console.log(`Scorable QRels: ${scorableQrels.length}`);
    console.log(`Overall NDCG@10:      baseline=${bMean.toFixed(4)}  composed=${cMean.toFixed(4)}  delta=${(cMean - bMean).toFixed(4)}`);
    console.log(`Exact-match NDCG@10:  baseline=${bExactMean.toFixed(4)}  composed=${cExactMean.toFixed(4)}  delta=${(cExactMean - bExactMean).toFixed(4)}`);
    console.log(`MRR:                  baseline=${bMrr.toFixed(4)}  composed=${cMrr.toFixed(4)}  delta=${(cMrr - bMrr).toFixed(4)}`);

    // This test always passes — it's purely diagnostic.
    expect(true).toBe(true);
  });
});
