/**
 * 3-variant retrieval benchmark for treenav.
 *
 * Evaluates three retrieval strategies on a real corpus and produces
 * apples-to-apples bytes / latency / recall numbers per query.
 *
 * Variants:
 *   1. bm25_chain       — legacy 3-step chain: search → get_tree → get_node_content
 *   2. semantic         — cosine sim over a pre-computed embedding sidecar (optional)
 *   3. compile_context  — single compileContext() call
 *
 * Usage examples:
 *
 *   # Minimal — docs only, built-in queries, no vectors, no qrels, CSV to stdout:
 *   bun run scripts/measure-compile-context.ts --docs ./docs
 *
 *   # Full corpus with code, custom queries, vectors + qrels:
 *   bun run scripts/measure-compile-context.ts \
 *     --docs ./docs \
 *     --code ./src \
 *     --queries ./bench/queries.json \
 *     --vectors ./bench/vectors.json \
 *     --qrels   ./bench/qrels.json \
 *     --out     ./bench/results.csv
 *
 *   # queries.json shape:  [{ "query": "auth token rotation", "filters": { "type": "runbook" } }, ...]
 *   # qrels.json shape:    [{ "query": "auth token rotation", "relevant": ["doc_id#node_id", ...] }, ...]
 *
 * Sidecar (--vectors) schema:
 * {
 *   "version": "1",
 *   "model": "minishlab/M2V_base_glove",
 *   "dim": 256,
 *   "node_vectors": [
 *     { "doc_id": "...", "node_id": "...", "vector": [0.12, ...] }
 *   ],
 *   "query_vectors": [
 *     { "query": "auth token rotation", "vector": [0.04, ...] }
 *   ]
 * }
 *
 * scripts/generate-golden-vectors.py already produces something close to this
 * shape — adapt it to emit node_vectors + query_vectors over your full corpus.
 *
 * NOT part of the test suite. Run manually.
 */

import { join } from "node:path";
import { indexCollection } from "../src/indexer";
import { indexCodeCollection } from "../src/code-indexer";
import { DocumentStore } from "../src/store";
import { formatSearchResults } from "../src/search-formatter";
import { compileContext } from "../src/compile-context";

// ── CLI argument parsing ─────────────────────────────────────────────────────

const args = Bun.argv.slice(2);

function getArg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

if (hasFlag("help") || hasFlag("h")) {
  process.stderr.write(
    [
      "Usage: bun run scripts/measure-compile-context.ts [options]",
      "",
      "  --docs   <path>   (required) DOCS_ROOT for markdown indexing",
      "  --code   <path>   CODE_ROOT for code indexing (optional)",
      "  --queries <file>  JSON file: array of {query, filters?} (default: built-in 10)",
      "  --vectors <file>  Embedding sidecar for variant 2 (optional)",
      "  --qrels  <file>   JSON file: array of {query, relevant: [doc_id#node_id,...]}",
      "  --out    <file>   CSV output path (default: stdout)",
      "  --help            Show this help",
      "",
    ].join("\n")
  );
  process.exit(0);
}

const docsPath = getArg("docs");
if (!docsPath) {
  process.stderr.write("Error: --docs <path> is required.\n");
  process.exit(1);
}

const codePath = getArg("code");
const queriesFile = getArg("queries");
const vectorsFile = getArg("vectors");
const qrelsFile = getArg("qrels");
const outFile = getArg("out");

// ── Built-in query set (from tests/compile-context.test.ts token-win test) ──

interface QueryEntry {
  query: string;
  filters?: Record<string, string | string[]>;
}

const BUILTIN_QUERIES: QueryEntry[] = [
  { query: "auth token rotation", filters: { type: "runbook" } },
  { query: "incident response procedure", filters: { type: "runbook" } },
  { query: "AuthService" },
  { query: "rate limiter implementation" },
  { query: "deploy freeze policy", filters: { type: "guide" } },
  { query: "JWT signing key" },
  { query: "database migration runbook", filters: { type: "runbook" } },
  { query: "feature flag rollout" },
  { query: "circuit breaker pattern" },
  { query: "oncall escalation", filters: { type: "guide" } },
];

// ── Load queries ─────────────────────────────────────────────────────────────

async function loadQueries(): Promise<QueryEntry[]> {
  if (!queriesFile) return BUILTIN_QUERIES;
  const raw = await Bun.file(queriesFile).text();
  return JSON.parse(raw) as QueryEntry[];
}

// ── QRels loading + NDCG computation ────────────────────────────────────────

interface QRelEntry {
  query: string;
  relevant: string[]; // "doc_id#node_id" pairs
}

async function loadQRels(path: string): Promise<Map<string, Set<string>>> {
  const raw = await Bun.file(path).text();
  const entries = JSON.parse(raw) as QRelEntry[];
  const map = new Map<string, Set<string>>();
  for (const e of entries) {
    map.set(e.query, new Set(e.relevant));
  }
  return map;
}

function ndcgAtK(ranked: string[], relevant: Set<string>, k: number): number {
  const topK = ranked.slice(0, k);
  const dcg = topK.reduce(
    (sum, id, i) => sum + (relevant.has(id) ? 1 : 0) / Math.log2(i + 2),
    0
  );
  const idealCount = Math.min(relevant.size, k);
  const idcg = Array.from({ length: idealCount }, (_, i) => 1 / Math.log2(i + 2)).reduce(
    (a, b) => a + b,
    0
  );
  return idcg === 0 ? 1 : dcg / idcg;
}

// ── Corpus indexing ───────────────────────────────────────────────────────────

async function buildStore(): Promise<DocumentStore> {
  const tasks: Promise<ReturnType<typeof indexCollection>>[] = [
    indexCollection({ name: "docs", root: docsPath! }),
  ];
  if (codePath) {
    tasks.push(indexCodeCollection({ name: "code", root: codePath }));
  }
  const results = await Promise.all(tasks);
  const allDocs = results.flat();
  const store = new DocumentStore();
  store.load(allDocs);
  return store;
}

// ── Baseline render helpers (verbatim from tests/compile-context.test.ts) ───

/**
 * Mirror of the get_tree handler output (tools.ts).
 */
function renderTreeLikeGetTree(store: DocumentStore, doc_id: string): string {
  const tree = store.getTree(doc_id);
  if (!tree) return `Document "${doc_id}" not found.`;
  const outline = tree.nodes
    .map((n) => {
      const indent = "  ".repeat(n.level - 1);
      return `${indent}[${n.node_id}] ${"#".repeat(n.level)} ${n.title} (${n.word_count} words)\n${indent}  ${n.summary ? `Summary: ${n.summary.slice(0, 120)}…` : ""}`;
    })
    .join("\n");
  return `Document: ${tree.title}\nDoc ID: ${tree.doc_id}\nSections: ${tree.nodes.length}\n\n${outline}\n\nTo read a section's full content, call get_node_content("${doc_id}", ["node_id"]).\nTo get a section and all its subsections, call navigate_tree("${doc_id}", "node_id").`;
}

/**
 * Mirror of the get_node_content handler output (tools.ts).
 */
function renderNodeContentLikeGetNodeContent(
  store: DocumentStore,
  doc_id: string,
  node_id: string
): string {
  const result = store.getNodeContent(doc_id, [node_id]);
  if (!result || result.nodes.length === 0) return `No node found for ${node_id}.`;
  return result.nodes
    .map(
      (n) =>
        `━━━ ${n.title} [${n.node_id}] (H${n.level}) ━━━\n\n${n.content || "(empty section)"}`
    )
    .join("\n\n");
}

// ── Sidecar / semantic variant ───────────────────────────────────────────────

interface NodeVector {
  doc_id: string;
  node_id: string;
  vector: number[];
}

interface QueryVector {
  query: string;
  vector: number[];
}

interface VectorSidecar {
  version: string;
  model: string;
  dim: number;
  node_vectors: NodeVector[];
  query_vectors: QueryVector[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function loadSidecar(path: string): Promise<VectorSidecar> {
  const raw = await Bun.file(path).text();
  return JSON.parse(raw) as VectorSidecar;
}

// Build a map from query string → vector for O(1) lookup.
function buildQueryVectorMap(sidecar: VectorSidecar): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const qv of sidecar.query_vectors) {
    m.set(qv.query, qv.vector);
  }
  return m;
}

// Format semantic top-k into a string comparable in shape to formatSearchResults.
function formatSemanticResults(
  hits: Array<{ doc_id: string; node_id: string; score: number }>,
  query: string
): string {
  if (hits.length === 0) return `## Semantic results — "${query}" (0 results)`;
  const lines = hits.map((h, i) =>
    `${i + 1}. [${h.doc_id} → ${h.node_id}]  score=${h.score.toFixed(4)}`
  );
  return `## Semantic results — "${query}" (top ${hits.length})\n${lines.join("\n")}`;
}

// ── Output CSV helpers ────────────────────────────────────────────────────────

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_HEADER = "query,variant,bytes,latency_ms,top_results,ndcg_at_10\n";

interface RowData {
  query: string;
  variant: "bm25_chain" | "semantic" | "compile_context";
  bytes: number | null;
  latency_ms: number | null;
  top_results: string | null; // semicolon-joined "doc_id#node_id"
  ndcg_at_10: number | null;
}

function formatRow(r: RowData): string {
  const fields = [
    csvEscape(r.query),
    r.variant,
    r.bytes !== null ? String(r.bytes) : "",
    r.latency_ms !== null ? r.latency_ms.toFixed(1) : "",
    r.top_results !== null ? csvEscape(r.top_results) : "",
    r.ndcg_at_10 !== null ? r.ndcg_at_10.toFixed(4) : "",
  ];
  return fields.join(",") + "\n";
}

// ── Main measurement loop ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  // --- Load corpus ---
  process.stderr.write(`Indexing corpus from: ${docsPath}${codePath ? ` + ${codePath}` : ""}\n`);
  const t0 = Date.now();
  const store = await buildStore();
  process.stderr.write(`Index ready in ${Date.now() - t0} ms.\n`);

  // --- Load queries ---
  const queries = await loadQueries();
  process.stderr.write(`Running ${queries.length} queries × 3 variants.\n`);

  // --- Load sidecar ---
  let sidecar: VectorSidecar | null = null;
  let queryVectorMap: Map<string, number[]> = new Map();
  if (vectorsFile) {
    sidecar = await loadSidecar(vectorsFile);
    queryVectorMap = buildQueryVectorMap(sidecar);
    process.stderr.write(`Loaded ${sidecar.node_vectors.length} node vectors, ${sidecar.query_vectors.length} query vectors from ${vectorsFile}.\n`);
  } else {
    process.stderr.write("No --vectors sidecar provided — variant 2 (semantic) will be skipped for all queries.\n");
  }

  // --- Load qrels ---
  let qrelsMap: Map<string, Set<string>> | null = null;
  if (qrelsFile) {
    qrelsMap = await loadQRels(qrelsFile);
    process.stderr.write(`Loaded QRels for ${qrelsMap.size} queries.\n`);
  }

  // --- Prepare output ---
  const csvRows: string[] = [CSV_HEADER];

  // --- Per-variant accumulators for summary ---
  const acc = {
    bm25_chain: { bytesSum: 0, latencySum: 0, ndcgSum: 0, ndcgN: 0, n: 0 },
    semantic: { bytesSum: 0, latencySum: 0, ndcgSum: 0, ndcgN: 0, n: 0, covered: 0 },
    compile_context: { bytesSum: 0, latencySum: 0, ndcgSum: 0, ndcgN: 0, n: 0 },
  };

  for (const { query, filters } of queries) {
    const qrelSet = qrelsMap?.get(query) ?? null;

    // ── Variant 1: bm25_chain ──────────────────────────────────────────────
    {
      const t1 = Date.now();

      const searchResults = store.searchDocuments(query, { limit: 3, filters });
      const searchText = formatSearchResults(searchResults, store, query);

      let treeText = "";
      let contentText = "";
      if (searchResults.length > 0) {
        treeText = renderTreeLikeGetTree(store, searchResults[0].doc_id);
        contentText = renderNodeContentLikeGetNodeContent(
          store,
          searchResults[0].doc_id,
          searchResults[0].node_id
        );
      }

      const fullText = [searchText, treeText, contentText].filter(Boolean).join("\n\n");
      const bytes = Buffer.byteLength(fullText, "utf8");
      const latency_ms = Date.now() - t1;

      // top 5 results for the CSV column
      const top5 = searchResults
        .slice(0, 5)
        .map((r) => `${r.doc_id}#${r.node_id}`)
        .join(";");

      let ndcg_at_10: number | null = null;
      if (qrelSet) {
        const ranked = searchResults.map((r) => `${r.doc_id}#${r.node_id}`);
        ndcg_at_10 = ndcgAtK(ranked, qrelSet, 10);
        acc.bm25_chain.ndcgSum += ndcg_at_10;
        acc.bm25_chain.ndcgN++;
      }

      acc.bm25_chain.bytesSum += bytes;
      acc.bm25_chain.latencySum += latency_ms;
      acc.bm25_chain.n++;

      csvRows.push(
        formatRow({
          query,
          variant: "bm25_chain",
          bytes,
          latency_ms,
          top_results: top5 || null,
          ndcg_at_10,
        })
      );
    }

    // ── Variant 2: semantic ───────────────────────────────────────────────
    {
      const queryVec = queryVectorMap.get(query) ?? null;

      if (!sidecar || !queryVec) {
        if (sidecar && !queryVec) {
          process.stderr.write(`Warning: no query vector found for "${query}" — skipping semantic variant.\n`);
        }
        csvRows.push(
          formatRow({
            query,
            variant: "semantic",
            bytes: null,
            latency_ms: null,
            top_results: null,
            ndcg_at_10: null,
          })
        );
      } else {
        const t1 = Date.now();

        // Rank all node vectors by cosine similarity.
        const scored = sidecar.node_vectors.map((nv) => ({
          doc_id: nv.doc_id,
          node_id: nv.node_id,
          score: cosine(queryVec, nv.vector),
        }));
        scored.sort((a, b) => b.score - a.score);
        const top3 = scored.slice(0, 3);
        const resultText = formatSemanticResults(top3, query);
        const bytes = Buffer.byteLength(resultText, "utf8");
        const latency_ms = Date.now() - t1;

        const top5 = scored
          .slice(0, 5)
          .map((r) => `${r.doc_id}#${r.node_id}`)
          .join(";");

        let ndcg_at_10: number | null = null;
        if (qrelSet) {
          const ranked = scored.map((r) => `${r.doc_id}#${r.node_id}`);
          ndcg_at_10 = ndcgAtK(ranked, qrelSet, 10);
          acc.semantic.ndcgSum += ndcg_at_10;
          acc.semantic.ndcgN++;
        }

        acc.semantic.bytesSum += bytes;
        acc.semantic.latencySum += latency_ms;
        acc.semantic.n++;
        acc.semantic.covered++;

        csvRows.push(
          formatRow({
            query,
            variant: "semantic",
            bytes,
            latency_ms,
            top_results: top5 || null,
            ndcg_at_10,
          })
        );
      }
    }

    // ── Variant 3: compile_context ────────────────────────────────────────
    {
      const t1 = Date.now();

      const { result, text } = compileContext(store, {
        intent: query,
        sources: ["all"],
        filters,
        output: {
          top_k_per_source: 3,
          include_outlines_for_top: 1,
          include_full_content_for_top: 0,
          max_tokens: 2000,
        },
      });

      const bytes = Buffer.byteLength(text, "utf8");
      const latency_ms = Date.now() - t1;

      // Extract top-5 result IDs from compileContext's actual ranking
      // (merge hits_by_source in source order, re-sort by score descending).
      const allHits = [
        ...result.hits_by_source.docs,
        ...result.hits_by_source.code,
        ...result.hits_by_source.rows,
      ].sort((a, b) => b.score - a.score);
      const top5 = allHits
        .slice(0, 5)
        .map((h) => `${h.doc_id}#${h.node_id}`)
        .join(";");

      let ndcg_at_10: number | null = null;
      if (qrelSet) {
        const ranked = allHits.map((h) => `${h.doc_id}#${h.node_id}`);
        ndcg_at_10 = ndcgAtK(ranked, qrelSet, 10);
        acc.compile_context.ndcgSum += ndcg_at_10;
        acc.compile_context.ndcgN++;
      }

      acc.compile_context.bytesSum += bytes;
      acc.compile_context.latencySum += latency_ms;
      acc.compile_context.n++;

      csvRows.push(
        formatRow({
          query,
          variant: "compile_context",
          bytes,
          latency_ms,
          top_results: top5 || null,
          ndcg_at_10,
        })
      );
    }
  }

  // ── Write CSV ──────────────────────────────────────────────────────────────

  const csvContent = csvRows.join("");
  if (outFile) {
    await Bun.write(outFile, csvContent);
    process.stderr.write(`CSV written to ${outFile}.\n`);
  } else {
    process.stdout.write(csvContent);
  }

  // ── Summary table ──────────────────────────────────────────────────────────

  const n = queries.length;

  function avgOrDash(sum: number, count: number): string {
    return count === 0 ? "n/a" : (sum / count).toFixed(1);
  }
  function ndcgAvg(sum: number, count: number): string {
    return count === 0 ? "n/a" : (sum / count).toFixed(4);
  }

  const b = acc.bm25_chain;
  const s = acc.semantic;
  const c = acc.compile_context;

  process.stderr.write("\n");
  process.stderr.write(`Summary across ${n} queries:\n`);
  process.stderr.write(
    `  bm25_chain      bytes_avg=${avgOrDash(b.bytesSum, b.n).padEnd(8)}  latency_avg=${avgOrDash(b.latencySum, b.n).padEnd(7)}  ndcg_avg=${ndcgAvg(b.ndcgSum, b.ndcgN)}\n`
  );
  process.stderr.write(
    `  semantic        bytes_avg=${avgOrDash(s.bytesSum, s.n).padEnd(8)}  latency_avg=${avgOrDash(s.latencySum, s.n).padEnd(7)}  ndcg_avg=${ndcgAvg(s.ndcgSum, s.ndcgN)}  (${s.covered} of ${n} queries had vectors)\n`
  );
  process.stderr.write(
    `  compile_context bytes_avg=${avgOrDash(c.bytesSum, c.n).padEnd(8)}  latency_avg=${avgOrDash(c.latencySum, c.n).padEnd(7)}  ndcg_avg=${ndcgAvg(c.ndcgSum, c.ndcgN)}\n`
  );

  if (b.n > 0 && c.n > 0) {
    const bAvg = b.bytesSum / b.n;
    const cAvg = c.bytesSum / c.n;
    const reduction = bAvg === 0 ? 0 : (bAvg - cAvg) / bAvg;
    process.stderr.write(`\nToken reduction (compile_context vs bm25_chain): ${(reduction * 100).toFixed(1)}%\n`);
  }

  if (b.ndcgN > 0 && c.ndcgN > 0) {
    const delta = c.ndcgSum / c.ndcgN - b.ndcgSum / b.ndcgN;
    const sign = delta >= 0 ? "+" : "";
    process.stderr.write(`NDCG delta (compile_context vs bm25_chain):       ${sign}${delta.toFixed(4)}\n`);
  }

  if (s.ndcgN > 0 && b.ndcgN > 0) {
    const sAvg = s.ndcgSum / s.ndcgN;
    const bAvg = b.ndcgSum / b.ndcgN;
    const delta = sAvg - bAvg;
    const sign = delta >= 0 ? "+" : "";
    process.stderr.write(`NDCG delta (semantic vs bm25_chain):              ${sign}${delta.toFixed(4)}  (only on queries with vectors)\n`);
  }

  process.stderr.write("\n");
}

await main();
