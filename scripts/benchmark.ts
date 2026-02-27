/**
 * treenav-mcp parser benchmark
 *
 * Indexes a local codebase and reports parsing quality metrics:
 * symbol extraction rates, indexing speed, and search quality.
 *
 * Usage:
 *   bun run scripts/benchmark.ts --root /path/to/repo
 *   bun run scripts/benchmark.ts --root /tmp/wildfly --lang java
 *   bun run scripts/benchmark.ts --root /tmp/envoy --lang cpp --query "filter"
 *   bun run scripts/benchmark.ts --root /tmp/django --query "queryset" --report
 *
 * Flags:
 *   --root <path>    Path to the repository root (required)
 *   --lang <ext>     Filter to one language: java|go|py|ts|rs|cpp|c (optional)
 *   --query <text>   Run a BM25 search and show top results (optional, repeatable)
 *   --report         Write results to docs/benchmark-results.md
 *   --top <n>        Number of sample files to show (default: 10)
 */

import { indexCodeCollection } from "../src/code-indexer";
import { DocumentStore } from "../src/store";
import { writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";

// ── CLI arg parsing ───────────────────────────────────────────────────

const args = Bun.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function getAllArgs(name: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === `--${name}`) results.push(args[i + 1]);
  }
  return results;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const root = getArg("root");
if (!root) {
  console.error("Error: --root <path> is required");
  console.error("Example: bun run scripts/benchmark.ts --root /tmp/wildfly --lang java");
  process.exit(1);
}

const langFilter = getArg("lang");
const queries = getAllArgs("query");
const writeReport = hasFlag("report");
const topN = parseInt(getArg("top") ?? "10", 10);

// ── Language → glob pattern ───────────────────────────────────────────

const LANG_GLOBS: Record<string, string> = {
  java:  "**/*.java",
  go:    "**/*.go",
  py:    "**/*.py",
  ts:    "**/*.{ts,tsx}",
  js:    "**/*.{js,jsx,mjs}",
  rs:    "**/*.rs",
  cpp:   "**/*.{cpp,cc,cxx}",
  c:     "**/*.{c,h,hpp}",
  cs:    "**/*.cs",
  rb:    "**/*.rb",
  kt:    "**/*.kt",
  scala: "**/*.scala",
};

const globPattern = langFilter ? LANG_GLOBS[langFilter] : undefined;
const repoName = basename(root.replace(/\/$/, ""));

// ── Run indexing ──────────────────────────────────────────────────────

console.log(`\n▶  Benchmarking: ${root}`);
if (langFilter) console.log(`   Language filter: ${langFilter}  (${globPattern})`);
console.log();

const t0 = Date.now();

const docs = await indexCodeCollection({
  root,
  name: repoName,
  glob_pattern: globPattern,
});

const indexTime = Date.now() - t0;

const store = new DocumentStore();
const t1 = Date.now();
store.load(docs);
const loadTime = Date.now() - t1;

const stats = store.getStats();

// ── Compute per-file symbol stats ─────────────────────────────────────

const nodesPerFile = docs.map((d) => d.tree.length);
const filesWithNoSymbols = docs.filter((d) => d.tree.length === 0).length;
const filesWithOnlyImports = docs.filter(
  (d) => d.tree.length === 1 && d.tree[0]?.title === "imports"
).length;
const avgNodes = nodesPerFile.reduce((a, b) => a + b, 0) / (docs.length || 1);
const maxNodes = Math.max(...nodesPerFile, 0);
const medianNodes = nodesPerFile.sort((a, b) => a - b)[Math.floor(nodesPerFile.length / 2)] ?? 0;

// Symbol kinds from facets
const listing = store.listDocuments({ limit: 1 });
const kindCounts = listing.facet_counts?.symbol_kind ?? {};
const langCounts = listing.facet_counts?.language ?? {};

// ── Detailed node breakdown ───────────────────────────────────────────

// Count total nodes by kind across all docs
const kindNodeCounts: Record<string, number> = {};
for (const doc of docs) {
  for (const node of doc.tree) {
    const title = node.title;
    if (title === "imports") continue;
    const kind = title.split(" ")[0]; // "class Foo" → "class"
    kindNodeCounts[kind] = (kindNodeCounts[kind] ?? 0) + 1;
  }
}

// ── Print results ─────────────────────────────────────────────────────

const lines: string[] = [];

function out(s = "") {
  console.log(s);
  lines.push(s);
}

out(`# treenav-mcp Benchmark — ${repoName}`);
out();
out(`**Date:** ${new Date().toISOString().slice(0, 10)}`);
out(`**Root:** \`${root}\``);
if (langFilter) out(`**Language filter:** ${langFilter}`);
out();

out(`## Indexing Performance`);
out();
out(`| Metric | Value |`);
out(`|---|---|`);
out(`| Files indexed | ${docs.length.toLocaleString()} |`);
out(`| Parse time | ${(indexTime / 1000).toFixed(2)}s |`);
out(`| Store load time | ${(loadTime / 1000).toFixed(2)}s |`);
out(`| Files/second | ${Math.round(docs.length / (indexTime / 1000)).toLocaleString()} |`);
out(`| Total nodes | ${stats.total_nodes.toLocaleString()} |`);
out(`| Indexed terms | ${stats.indexed_terms.toLocaleString()} |`);
out(`| Total words | ${stats.total_words.toLocaleString()} |`);
out();

out(`## Symbol Extraction`);
out();
out(`| Metric | Value |`);
out(`|---|---|`);
out(`| Avg nodes/file | ${avgNodes.toFixed(1)} |`);
out(`| Median nodes/file | ${medianNodes} |`);
out(`| Max nodes/file | ${maxNodes} |`);
out(`| Files with 0 symbols | ${filesWithNoSymbols} (${((filesWithNoSymbols / docs.length) * 100).toFixed(1)}%) |`);
out(`| Files with only imports | ${filesWithOnlyImports} (${((filesWithOnlyImports / docs.length) * 100).toFixed(1)}%) |`);
out();

out(`### Nodes by symbol kind`);
out();
out(`| Kind | Total nodes | Files containing |`);
out(`|---|---|---|`);
for (const [kind, count] of Object.entries(kindNodeCounts).sort((a, b) => b[1] - a[1])) {
  const fileCount = kindCounts[kind] ?? "—";
  out(`| ${kind} | ${count.toLocaleString()} | ${fileCount} |`);
}
out();

if (Object.keys(langCounts).length > 1) {
  out(`### Language distribution`);
  out();
  out(`| Language | Files |`);
  out(`|---|---|`);
  for (const [lang, count] of Object.entries(langCounts).sort((a, b) => b - a)) {
    out(`| ${lang} | ${count} |`);
  }
  out();
}

// ── Sample files ──────────────────────────────────────────────────────

out(`## Sample Files (top ${topN} by node count)`);
out();
const topFiles = [...docs]
  .sort((a, b) => b.tree.length - a.tree.length)
  .slice(0, topN);

out(`| File | Nodes | Description |`);
out(`|---|---|---|`);
for (const d of topFiles) {
  const desc = (d.meta.description ?? "").slice(0, 70).replace(/\|/g, "\\|");
  out(`| \`${d.meta.file_path}\` | ${d.tree.length} | ${desc} |`);
}
out();

// ── Search quality ────────────────────────────────────────────────────

if (queries.length > 0) {
  out(`## Search Quality`);
  out();

  for (const query of queries) {
    out(`### Query: \`${query}\``);
    out();
    const results = store.searchDocuments(query, { limit: 8 });

    if (results.length === 0) {
      out(`_No results found._`);
    } else {
      out(`| Score | Symbol | Snippet |`);
      out(`|---|---|---|`);
      for (const r of results) {
        const snippet = r.snippet.slice(0, 80).replace(/\|/g, "\\|").replace(/\n/g, " ");
        out(`| ${r.score.toFixed(1)} | ${r.node_title} | ${snippet} |`);
      }
    }
    out();
  }
}

// ── Known limitations summary ─────────────────────────────────────────

out(`## Parser Coverage Notes`);
out();
out(`| Language | Parser | Class | Interface | Enum | Methods | Known gaps |`);
out(`|---|---|---|---|---|---|---|`);
out(`| Java | java.ts (dedicated) | ✓ | ✓ | ✓ | ✓ | Inner class members not recursed |`);
out(`| TypeScript/JS | typescript.ts (dedicated) | ✓ | ✓ | ✓ | ✓ | — |`);
out(`| Python | python.ts (dedicated) | ✓ | — | — | ✓ | — |`);
out(`| Go | generic.ts | ✓ structs | ✓ interfaces | ✓ | ✓ receiver methods | impl blocks |`);
out(`| Rust | generic.ts | ✓ structs | ✓ traits | ✓ | top-level fn only | impl blocks, pub(crate) fn |`);
out(`| C++ | generic.ts | ✓ (top-level) | — | — | ✓ ClassName::method | Indented classes (namespaces) |`);
out(`| C# / Kotlin / Scala | generic.ts | ✓ | ✓ | ✓ | ✗ (no fn keyword) | Methods inside classes |`);

// ── Write report ──────────────────────────────────────────────────────

if (writeReport) {
  const outDir = join(import.meta.dir, "..", "docs");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `benchmark-${repoName}-${langFilter ?? "all"}.md`);
  await writeFile(outPath, lines.join("\n") + "\n");
  console.log(`\n📄 Report written to: ${outPath}`);
}
