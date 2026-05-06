/**
 * Tier 4 decision-review measurement harness.
 *
 * One-off measurement tool — NOT part of the test suite. Produces three numbers
 * the Tier 4 PR-8 write-up needs:
 *
 *   1. NDCG@10 split by query bucket (NL/recall-leaning vs exact-friendly).
 *      The bigger the gap, the more headroom semantic embeddings could buy.
 *
 *   2. Cold-index wall-clock + per-file time + memory delta on a real-shape
 *      corpus (passed via --corpus). Anchors the "fast index" claim.
 *
 *   3. Optionally, sanity-checks the QRel resolution path so later passes
 *      don't silently drop relevance signals.
 *
 * Usage:
 *   bun run scripts/measure-tier4.ts                  # bucket NDCG only
 *   bun run scripts/measure-tier4.ts --corpus <path>  # bucket NDCG + index timing on <path>
 *
 * Reads the same QRels the production search-quality test suite uses, so the
 * evaluation harness is identical to tests/search-quality.test.ts.
 */

import { join } from "node:path";
import { indexCollection } from "../src/indexer";
import { indexCodeCollection, CODE_GLOB } from "../src/code-indexer";
import { DocumentStore } from "../src/store";
import { QRELS } from "../tests/fixtures/search-quality-qrels";
import type { RawQRel, QueryCategory } from "../tests/fixtures/search-quality-qrels";

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
function getArg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}

const corpusPath = getArg("corpus");

// ── Bucket definition (per PR-8 spec) ────────────────────────────────────────

const EXACT_FRIENDLY: ReadonlySet<QueryCategory> = new Set([
  "exact",
  "multi-term",
  "code-symbol",
  "discriminating",
]);

const NL_LEANING: ReadonlySet<QueryCategory> = new Set([
  "synonym",
  // facet-filtered queries depend on filters resolving correctly, not on lexical
  // recall alone — they're closer in spirit to the NL/recall side. Including
  // them broadens the NL bucket beyond the 6 synonym QRels and gives semantic
  // embeddings a wider surface to demonstrate lift.
  "facet-filtered",
]);

// zero-result is excluded — those QRels assert NO results; NDCG of an empty
// ideal is vacuously 1 and would skew bucket averages upward.

// ── IR metric helpers (copied verbatim from search-quality.test.ts) ──────────

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

// ── Corpus-fixture indexing (same as search-quality.test.ts beforeAll) ───────

const FIXTURE_MD_ROOT = join(import.meta.dir, "..", "tests/fixtures/search-quality/md");
const FIXTURE_CODE_ROOT = join(import.meta.dir, "..", "tests/fixtures/search-quality/code");

async function buildFixtureStore(): Promise<DocumentStore> {
  const [mdDocs, codeDocs] = await Promise.all([
    indexCollection({ name: "docs", root: FIXTURE_MD_ROOT, weight: 1.0 }),
    indexCodeCollection({ name: "code", root: FIXTURE_CODE_ROOT, weight: 1.0 }),
  ]);
  const store = new DocumentStore();
  store.load([...mdDocs, ...codeDocs]);
  return store;
}

function findDocId(store: DocumentStore, titleFragment: string): string | null {
  const listing = store.listDocuments({ limit: 200 });
  return (
    listing.documents.find(d =>
      d.title.toLowerCase().includes(titleFragment.toLowerCase())
    )?.doc_id ?? null
  );
}

function findNodeId(store: DocumentStore, docId: string, nodeTitle?: string): string | null {
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

function resolveRelevance(store: DocumentStore, qr: RawQRel): Map<string, number> {
  const relevance = new Map<string, number>();
  for (const rel of qr.relevant) {
    const docId = findDocId(store, rel.docTitle);
    if (!docId) continue;
    const nodeId = findNodeId(store, docId, rel.nodeTitle);
    if (!nodeId) continue;
    relevance.set(nodeId, rel.relevance);
  }
  return relevance;
}

// ── Measurement 1: NL vs exact NDCG@10 split ─────────────────────────────────

interface BucketResult {
  name: string;
  categories: QueryCategory[];
  qrelCount: number;
  evaluated: number;             // qrels with at least one resolvable relevant node
  meanNdcg: number;
  perCategory: Map<QueryCategory, { count: number; mean: number }>;
}

function evaluateBucket(
  store: DocumentStore,
  name: string,
  predicate: (cat: QueryCategory) => boolean
): BucketResult {
  const bucketQrels = QRELS.filter(qr => predicate(qr.category));
  const ndcgs: number[] = [];
  const perCat = new Map<QueryCategory, number[]>();

  for (const qr of bucketQrels) {
    const relevance = resolveRelevance(store, qr);
    if (relevance.size === 0) continue; // unresolved → skip, don't fabricate
    const ranked = store
      .searchDocuments(qr.query, { limit: 10, filters: qr.filter })
      .map(r => r.node_id);
    const score = ndcgAtK(ranked, relevance, 10);
    ndcgs.push(score);
    const bucket = perCat.get(qr.category) ?? [];
    bucket.push(score);
    perCat.set(qr.category, bucket);
  }

  const mean = ndcgs.length === 0 ? 0 : ndcgs.reduce((a, b) => a + b, 0) / ndcgs.length;
  const perCategory = new Map<QueryCategory, { count: number; mean: number }>();
  for (const [cat, scores] of perCat) {
    perCategory.set(cat, {
      count: scores.length,
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
    });
  }

  const cats = [...new Set(bucketQrels.map(q => q.category))];
  return {
    name,
    categories: cats,
    qrelCount: bucketQrels.length,
    evaluated: ndcgs.length,
    meanNdcg: mean,
    perCategory,
  };
}

async function measurement1(): Promise<void> {
  console.log("=".repeat(78));
  console.log("Measurement 1: NL vs exact NDCG@10 split (current main)");
  console.log("=".repeat(78));

  const store = await buildFixtureStore();

  const exactBucket = evaluateBucket(store, "exact-friendly", c => EXACT_FRIENDLY.has(c));
  const nlBucket = evaluateBucket(store, "nl/recall-leaning", c => NL_LEANING.has(c));

  for (const b of [exactBucket, nlBucket]) {
    console.log(`\n  Bucket: ${b.name}`);
    console.log(`    Categories:    ${b.categories.join(", ")}`);
    console.log(`    QRels:         ${b.qrelCount} total, ${b.evaluated} evaluated (rest had unresolvable nodes)`);
    console.log(`    NDCG@10 mean:  ${b.meanNdcg.toFixed(4)}`);
    console.log(`    Per-category breakdown:`);
    for (const [cat, stat] of b.perCategory) {
      console.log(`      ${cat.padEnd(18)} n=${stat.count.toString().padStart(2)}  mean=${stat.mean.toFixed(4)}`);
    }
  }

  const gap = exactBucket.meanNdcg - nlBucket.meanNdcg;
  console.log(`\n  Gap (exact − NL): ${gap.toFixed(4)}`);
  console.log(`  Tier-4 acceptance threshold: NDCG@10 lift over Tier 3 ≥ 0.05 on NL bucket.`);
  console.log(`  Headroom available on NL bucket: ${(1.0 - nlBucket.meanNdcg).toFixed(4)}\n`);
}

// ── Measurement 2: Index-time on a real corpus ────────────────────────────────

async function measurement2(rootPath: string): Promise<void> {
  console.log("=".repeat(78));
  console.log(`Measurement 2: Cold index timing on ${rootPath}`);
  console.log("=".repeat(78));

  // Force a GC pass before snapshotting if exposed (Bun does not expose it
  // by default; we rely on cold-process numbers being close enough).
  const memBefore = process.memoryUsage();

  const start = performance.now();
  const docs = await indexCodeCollection({
    name: "corpus",
    root: rootPath,
    weight: 1.0,
    glob_pattern: CODE_GLOB,
  });
  const elapsedMs = performance.now() - start;

  const memAfter = process.memoryUsage();

  // File count: number of distinct file_path entries (one IndexedDocument per file).
  const fileCount = docs.length;
  const perFileMs = fileCount === 0 ? 0 : elapsedMs / fileCount;

  // Build the store too, since "fast index pitch" includes the store load.
  const storeStart = performance.now();
  const store = new DocumentStore();
  store.load(docs);
  const storeMs = performance.now() - storeStart;

  const memFinal = process.memoryUsage();

  const totalNodes = docs.reduce((s, d) => s + d.tree.length, 0);

  console.log(`\n  Corpus root:           ${rootPath}`);
  console.log(`  Files indexed:         ${fileCount}`);
  console.log(`  Total tree nodes:      ${totalNodes}`);
  console.log(`  Index wall-clock:      ${elapsedMs.toFixed(0)} ms`);
  console.log(`  Per-file mean:         ${perFileMs.toFixed(2)} ms`);
  console.log(`  Store load:            ${storeMs.toFixed(0)} ms`);
  console.log(`  Total cold pipeline:   ${(elapsedMs + storeMs).toFixed(0)} ms`);
  console.log(`\n  Memory (RSS):`);
  console.log(`    before index:        ${(memBefore.rss / 1024 / 1024).toFixed(1)} MB`);
  console.log(`    after index:         ${(memAfter.rss / 1024 / 1024).toFixed(1)} MB  (+${((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`    after store load:    ${(memFinal.rss / 1024 / 1024).toFixed(1)} MB  (+${((memFinal.rss - memBefore.rss) / 1024 / 1024).toFixed(1)} MB total)`);
  console.log(`  Memory (heapUsed):`);
  console.log(`    before:              ${(memBefore.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`    after store load:    ${(memFinal.heapUsed / 1024 / 1024).toFixed(1)} MB  (+${((memFinal.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(1)} MB)`);

  // Tier-4 gate: index time ≤ 30s for ~5k files.
  const projected5k = (elapsedMs / Math.max(fileCount, 1)) * 5000;
  console.log(`\n  Projected 5k-file index time (linear scaling): ${(projected5k / 1000).toFixed(1)} s`);
  console.log(`  Plan's "fast index" gate:                       ≤ 30 s on 5k files`);
  console.log(`  Status:                                         ${projected5k <= 30_000 ? "PASS" : "FAIL"}`);

  // Avoid unused-var lint in store reference
  void store;
}

// ── main ─────────────────────────────────────────────────────────────────────

await measurement1();

if (corpusPath) {
  console.log("");
  await measurement2(corpusPath);
} else {
  console.log("\n(skipping Measurement 2 — pass --corpus <path> to run it)\n");
}
