/**
 * compile_context — composed retrieval primitive.
 *
 * Pure orchestration over DocumentStore's existing public methods.
 * No new ranking, no new index, no LLM calls.
 *
 * See docs/superpowers/specs/2026-05-06-compile-context-design.md.
 */

import type {
  ResolvedMode,
  CompileContextHit,
  ResolvedSource,
  CompileContextOutline,
  CompileContextOutlineNode,
  CompileContextFullContent,
} from "./types";
import type { DocumentStore } from "./store";

const LOOKUP_KEY_RE = /^[A-Z]+-\d+$/;
const REGEX_META_RE = /[\\\[\]^$|]|\.\*|\(\?/;
const SYMBOL_KEYWORD_RE = /^(class|function|interface|type|enum)\s+/i;
// camelCase or PascalCase single token (no whitespace, has internal capital)
const CAMEL_TOKEN_RE = /^[A-Za-z][a-zA-Z0-9_$]*$/;
const HAS_INTERNAL_CAPITAL_RE = /[a-z][A-Z]|^[A-Z][a-z]/;

/**
 * Resolve a CompileContextMode from the raw intent string.
 *
 * Order matters: lookup before grep before symbol before search.
 *   - lookup: PROJ-44 / ITEM-1234 shaped
 *   - grep:   contains regex metacharacters
 *   - symbol: starts with class/function/etc. or is a single camelCase token
 *   - search: anything else (the natural-language path)
 */
export function resolveMode(intent: string): ResolvedMode {
  if (LOOKUP_KEY_RE.test(intent)) return "lookup";
  if (REGEX_META_RE.test(intent)) return "grep";
  if (SYMBOL_KEYWORD_RE.test(intent)) return "symbol";
  if (
    CAMEL_TOKEN_RE.test(intent) &&
    HAS_INTERNAL_CAPITAL_RE.test(intent) &&
    !intent.includes(" ")
  ) {
    return "symbol";
  }
  return "search";
}

/**
 * Resolve the facet filters that scope a dispatch to one source. The
 * collections behind a source are looked up from the store (not hardcoded)
 * so custom CODE_COLLECTION names and multi-root DOCS_ROOTS setups route
 * correctly. Returns null when the source has no collections — the caller
 * should short-circuit to an empty hit list.
 */
function sourceFilters(
  store: DocumentStore,
  source: "docs" | "code",
  filters: Record<string, string | string[]> | undefined
): Record<string, string | string[]> | null {
  const collections = store.getSourceCollections()[source];
  if (collections.length === 0) return null;
  // Caller-supplied filters win on conflict (including `collection`).
  return { collection: collections, ...(filters ?? {}) };
}

/**
 * Dispatch a BM25 search against a single source collection.
 * Returns up to topK hits, each tagged with the source.
 */
export function dispatchSearch(
  store: DocumentStore,
  intent: string,
  source: "docs" | "code",
  filters: Record<string, string | string[]> | undefined,
  topK: number
): CompileContextHit[] {
  const scoped = sourceFilters(store, source, filters);
  if (!scoped) return [];
  const results = store.searchDocuments(intent, {
    limit: topK,
    filters: scoped,
  });
  return results.map((r) => ({
    source,
    doc_id: r.doc_id,
    node_id: r.node_id,
    doc_title: r.doc_title,
    node_title: r.node_title,
    file_path: r.file_path,
    score: r.score,
    snippet: r.snippet || undefined,
  }));
}

/**
 * Dispatch an exact-key row lookup.
 * Returns 0 or 1 hits, always tagged with source = "rows".
 */
export function dispatchLookup(
  store: DocumentStore,
  intent: string
): CompileContextHit[] {
  const result = store.lookupRow(intent);
  if (!result) return [];
  return [
    {
      source: "rows",
      doc_id: result.doc_id,
      node_id: result.node.node_id,
      doc_title: result.doc_id,
      node_title: result.node.title,
      file_path: "",
      score: 1.0,
      snippet: result.node.summary || result.node.content.slice(0, 200),
    },
  ];
}

/**
 * Dispatch a literal/regex scan against a single source.
 * Maps GrepHits onto the unified CompileContextHit shape.
 */
export function dispatchGrep(
  store: DocumentStore,
  intent: string,
  source: "docs" | "code",
  filters: Record<string, string | string[]> | undefined,
  topK: number
): CompileContextHit[] {
  // Scope the scan to the source's collections — without this, the same
  // hit would be returned (and misattributed) under every requested source.
  const scoped = sourceFilters(store, source, filters);
  if (!scoped) return [];
  // Treat regex if it contains regex metacharacters; otherwise literal.
  const regex = REGEX_META_RE.test(intent);
  const outcome = store.grepDocuments({
    pattern: intent,
    regex,
    case_insensitive: false,
    filters: scoped,
    context: 0,
    limit: topK,
  });
  // Cache doc titles to avoid repeated getTree calls for same doc_id.
  const titleCache = new Map<string, string>();
  const titleFor = (docId: string): string => {
    if (!titleCache.has(docId)) {
      titleCache.set(docId, store.getTree(docId)?.title ?? docId);
    }
    return titleCache.get(docId)!;
  };
  return outcome.hits.map((h) => ({
    source,
    doc_id: h.doc_id,
    node_id: h.node_id,
    doc_title: titleFor(h.doc_id),
    node_title: h.node_title,
    file_path: h.file_path,
    // Grep has no ranking; score is a placeholder, ordering preserved by hit position.
    score: 1.0,
    snippet: h.line,
    line_no: h.line_no,
  }));
}

/**
 * Dispatch a symbol search — search restricted to code collection,
 * with optional kind/language filters layered on caller filters.
 * Mirrors the existing find_symbol tool's filter strategy.
 */
export function dispatchSymbol(
  store: DocumentStore,
  intent: string,
  filters: Record<string, string | string[]> | undefined,
  topK: number
): CompileContextHit[] {
  const mergedFilters: Record<string, string | string[]> = {
    content_type: "code",
    ...(filters ?? {}),
  };
  const results = store.searchDocuments(intent, {
    limit: topK,
    filters: mergedFilters,
  });
  return results.map((r) => ({
    source: "code" as const,
    doc_id: r.doc_id,
    node_id: r.node_id,
    doc_title: r.doc_title,
    node_title: r.node_title,
    file_path: r.file_path,
    score: r.score,
    signature: r.snippet || undefined,
  }));
}

/**
 * Collect TreeOutlines for the top-N unique doc_ids across the merged
 * hit list. Hits arrive pre-ranked; first occurrence wins.
 */
export function collectOutlines(
  store: DocumentStore,
  hits: CompileContextHit[],
  topN: number
): CompileContextOutline[] {
  if (topN <= 0) return [];
  const seen = new Set<string>();
  const outlines: CompileContextOutline[] = [];
  for (const h of hits) {
    if (seen.has(h.doc_id)) continue;
    seen.add(h.doc_id);
    const tree = store.getTree(h.doc_id);
    if (!tree) continue;
    const nodes: CompileContextOutlineNode[] = tree.nodes.map((n) => ({
      node_id: n.node_id,
      title: n.title,
      level: n.level,
      word_count: n.word_count,
      summary: n.summary,
    }));
    outlines.push({ doc_id: tree.doc_id, doc_title: tree.title, nodes });
    if (outlines.length >= topN) break;
  }
  return outlines;
}

/**
 * Collect full node content for the top-N hits in arrival order.
 */
export function collectFullContent(
  store: DocumentStore,
  hits: CompileContextHit[],
  topN: number
): CompileContextFullContent[] {
  if (topN <= 0) return [];
  const blocks: CompileContextFullContent[] = [];
  for (const h of hits) {
    if (blocks.length >= topN) break;
    const result = store.getNodeContent(h.doc_id, [h.node_id]);
    if (!result || result.nodes.length === 0) continue;
    const node = result.nodes[0];
    blocks.push({
      doc_id: h.doc_id,
      node_id: node.node_id,
      node_title: node.title,
      content: node.content,
    });
  }
  return blocks;
}

import type { CompileContextResult, CompileContextInput } from "./types";

const SOURCE_ORDER: ResolvedSource[] = ["docs", "code", "rows"];

function formatHitsBlock(
  source: ResolvedSource,
  hits: CompileContextHit[],
  total: number
): string {
  const heading = `## Hits — ${source} (${hits.length} of ${total})`;
  if (hits.length === 0) return heading;
  const lines = hits.map((h, i) => {
    const head = `${i + 1}. [${h.doc_id} → ${h.node_id}] ${h.doc_title} › ${h.node_title}  (score ${h.score.toFixed(4)})`;
    const path = h.line_no
      ? `   ${h.file_path}:${h.line_no}`
      : `   ${h.file_path}`;
    const tail = h.signature
      ? `   Signature: ${h.signature}`
      : h.snippet
        ? `   Snippet: ${h.snippet}`
        : "";
    return [head, path, tail].filter(Boolean).join("\n");
  });
  return `${heading}\n${lines.join("\n\n")}`;
}

function formatOutlinesBlock(result: CompileContextResult): string {
  if (result.outlines.length === 0) return "";
  const blocks = result.outlines.map((o) => {
    const heading = `▸ ${o.doc_id} — ${o.doc_title}`;
    const nodeLines = o.nodes
      .map((n) => {
        const indent = "  ".repeat(Math.max(0, n.level - 1));
        const summary = n.summary
          ? `\n${indent}    Summary: ${n.summary.slice(0, 120)}…`
          : "";
        return `${indent}  [${n.node_id}] ${"#".repeat(n.level)} ${n.title} (${n.word_count} words)${summary}`;
      })
      .join("\n");
    return `${heading}\n${nodeLines}`;
  });
  return `## Outlines (top ${result.outlines.length})\n\n${blocks.join("\n\n")}`;
}

function formatFullContentBlock(result: CompileContextResult): string {
  if (result.full_content.length === 0) return "";
  const blocks = result.full_content.map((b) => {
    return `▸ [${b.doc_id} → ${b.node_id}] ${b.node_title}\n  ${b.content}`;
  });
  return `## Full content (top ${result.full_content.length})\n\n${blocks.join("\n\n")}`;
}

function formatBudgetBlock(result: CompileContextResult): string {
  const notes = result.trim_notes.length > 0
    ? `  (${result.trim_notes.join("; ")})`
    : "";
  return `## Budget\ntokens_used=${result.tokens_used_estimate} / ${result.tokens_budget}${notes}`;
}

function formatFollowUp(): string {
  return [
    "## Follow-up",
    `- Read full content: get_node_content("<doc_id>", ["<node_id>"])`,
    `- Drill into a subtree: get_node_content("<doc_id>", ["<node_id>"], include_descendants=true)`,
    `- Exact-match recheck: grep_documents("<intent>")`,
  ].join("\n");
}

/** Cheap token estimate: bytes / 4. */
function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

function estimateResultTokens(result: CompileContextResult): number {
  return estimateTokens(formatResult(result));
}

/**
 * Trim a result so that its rendered text fits within `budget` tokens.
 *
 * Drop order (lowest-priority dropped first — highest-priority kept last):
 *   1. Outline nodes: deepest leaves first, then entire outlines (spec §5 step 6)
 *   2. Full-content blocks: lowest-ranked first (spec §5 step 5)
 *   3. Snippets: shorten to 80 chars, then drop entirely (spec §5 step 4)
 *   4. Extra hits: lowest-ranked first, always preserving top-1 per source (spec §5 step 3)
 *
 * The intent header and follow-up section are never trimmed (spec §5 steps 1, 7).
 */
export function trimToBudget(
  result: CompileContextResult,
  budget: number
): CompileContextResult {
  const r: CompileContextResult = JSON.parse(JSON.stringify(result));
  r.tokens_budget = budget;
  r.trim_notes = [];

  const isOver = () => estimateResultTokens(r) > budget;
  if (!isOver()) {
    r.tokens_used_estimate = estimateResultTokens(r);
    return r;
  }

  // Step 6: Trim outlines — deepest leaves first, then drop entire outlines.
  if (isOver() && r.outlines.length > 0) {
    let droppedOutlineNodes = 0;
    let droppedOutlines = 0;
    while (isOver() && r.outlines.length > 0) {
      const last = r.outlines[r.outlines.length - 1];
      if (last.nodes.length > 0) {
        // Find and drop deepest node (highest level number = most nested).
        const maxLevel = Math.max(...last.nodes.map((n) => n.level));
        const idx = last.nodes.findIndex((n) => n.level === maxLevel);
        if (idx >= 0) {
          last.nodes.splice(idx, 1);
          droppedOutlineNodes++;
        } else {
          last.nodes.pop();
          droppedOutlineNodes++;
        }
        // If nodes are now exhausted, drop the empty outline shell immediately.
        if (last.nodes.length === 0) {
          r.outlines.pop();
          droppedOutlines++;
        }
      } else {
        r.outlines.pop();
        droppedOutlines++;
      }
    }
    if (droppedOutlineNodes > 0) r.trim_notes.push(`trimmed ${droppedOutlineNodes} outline nodes`);
    if (droppedOutlines > 0) r.trim_notes.push(`dropped ${droppedOutlines} outlines`);
  }

  // Step 5: Trim full-content blocks (lowest-ranked first).
  if (isOver() && r.full_content.length > 0) {
    let droppedFC = 0;
    while (isOver() && r.full_content.length > 0) {
      r.full_content.pop();
      droppedFC++;
    }
    if (droppedFC > 0) r.trim_notes.push(`dropped ${droppedFC} full-content blocks`);
  }

  // Step 4a: Shorten snippets to 80 chars.
  if (isOver()) {
    let shortened = 0;
    outer: for (const src of SOURCE_ORDER) {
      const arr = r.hits_by_source[src];
      if (!arr) continue;
      for (const h of arr) {
        if (h.snippet && h.snippet.length > 80) {
          h.snippet = h.snippet.slice(0, 80);
          shortened++;
          if (!isOver()) break outer;
        }
      }
    }
    if (shortened > 0) r.trim_notes.push(`shortened ${shortened} snippets`);
  }

  // Step 4b: Drop snippets entirely (title-only).
  if (isOver()) {
    outer: for (const src of SOURCE_ORDER) {
      const arr = r.hits_by_source[src];
      if (!arr) continue;
      for (const h of arr) {
        if (h.snippet) {
          h.snippet = undefined;
          if (!isOver()) break outer;
        }
      }
    }
  }

  // Step 3: Drop lowest-ranked hits within each source, keeping at least 1.
  let droppedHits = 0;
  while (isOver()) {
    let droppedThisRound = false;
    for (const src of SOURCE_ORDER) {
      const arr = r.hits_by_source[src];
      if (arr && arr.length > 1) {
        arr.pop();
        droppedHits++;
        droppedThisRound = true;
        if (!isOver()) break;
      }
    }
    if (!droppedThisRound) break;
  }
  if (droppedHits > 0) r.trim_notes.push(`dropped ${droppedHits} hits`);

  r.tokens_used_estimate = estimateResultTokens(r);
  return r;
}

const DEFAULT_TOP_K = 3;
const DEFAULT_OUTLINES = 2;
const DEFAULT_FULL_CONTENT = 0;
const DEFAULT_MAX_TOKENS = 2000;

function expandSources(
  sources: CompileContextInput["sources"]
): ResolvedSource[] {
  if (!sources || sources.length === 0) return ["docs", "code", "rows"];
  if (sources.includes("all")) return ["docs", "code", "rows"];
  return sources.filter((s): s is ResolvedSource => s !== "all");
}

/**
 * Top-level entrypoint. Resolves mode, dispatches per source, collects
 * outlines + full content, applies budget, and renders.
 *
 * Returns both the structured result (for callers that want the data)
 * and the rendered text (for the MCP tool's text response).
 */
export function compileContext(
  store: DocumentStore,
  input: CompileContextInput
): { result: CompileContextResult; text: string } {
  const t0 = Date.now();
  const resolvedMode: ResolvedMode =
    !input.mode || input.mode === "auto"
      ? resolveMode(input.intent)
      : input.mode;
  const sources = expandSources(input.sources);
  const topK = input.output.top_k_per_source ?? DEFAULT_TOP_K;
  const outlinesTop = input.output.include_outlines_for_top ?? DEFAULT_OUTLINES;
  const fullContentTop = input.output.include_full_content_for_top ?? DEFAULT_FULL_CONTENT;
  const maxTokens = input.output.max_tokens ?? DEFAULT_MAX_TOKENS;

  const hitsBySource: Record<ResolvedSource, CompileContextHit[]> = {
    docs: [],
    code: [],
    rows: [],
  };
  const totalsBySource: Record<ResolvedSource, number> = {
    docs: 0,
    code: 0,
    rows: 0,
  };

  // Lookup mode is row-only regardless of requested sources.
  if (resolvedMode === "lookup") {
    const hits = dispatchLookup(store, input.intent);
    hitsBySource.rows = hits;
    totalsBySource.rows = hits.length;
  } else {
    for (const src of sources) {
      if (src === "rows") {
        // Search/grep/symbol modes don't address rows.
        continue;
      }
      let hits: CompileContextHit[] = [];
      if (resolvedMode === "search") {
        hits = dispatchSearch(store, input.intent, src, input.filters, topK);
      } else if (resolvedMode === "grep") {
        hits = dispatchGrep(store, input.intent, src, input.filters, topK);
      } else if (resolvedMode === "symbol") {
        if (src === "code") {
          hits = dispatchSymbol(store, input.intent, input.filters, topK);
        }
      }
      hitsBySource[src] = hits;
      totalsBySource[src] = hits.length;
    }
  }

  // Merge hits in source order for outline + full-content collection.
  const merged: CompileContextHit[] = [];
  for (const s of SOURCE_ORDER) {
    merged.push(...hitsBySource[s]);
  }

  const outlines = collectOutlines(store, merged, outlinesTop);
  const full_content = collectFullContent(store, merged, fullContentTop);

  const rawResult: CompileContextResult = {
    intent: input.intent,
    resolved_mode: resolvedMode,
    sources,
    duration_ms: Date.now() - t0,
    hits_by_source: hitsBySource,
    hit_totals_by_source: totalsBySource,
    outlines,
    full_content,
    trim_notes: [],
    tokens_used_estimate: 0,
    tokens_budget: maxTokens,
  };
  rawResult.tokens_used_estimate = estimateResultTokens(rawResult);

  const trimmed = trimToBudget(rawResult, maxTokens);
  const text = formatResult(trimmed);
  return { result: trimmed, text };
}

/**
 * Render a CompileContextResult as the canonical text artifact.
 * Section order is fixed; provenance brackets are mandatory on every hit.
 */
export function formatResult(result: CompileContextResult): string {
  const header = `━━━ compile_context: "${result.intent}" (mode=${result.resolved_mode}, sources=[${result.sources.join(", ")}], ${result.duration_ms} ms) ━━━`;

  const hitsBlocks = SOURCE_ORDER
    .map((s) => formatHitsBlock(s, result.hits_by_source[s], result.hit_totals_by_source[s]))
    .join("\n\n");

  const outlines = formatOutlinesBlock(result);
  const fullContent = formatFullContentBlock(result);
  const budget = formatBudgetBlock(result);
  const followUp = formatFollowUp();

  return [header, hitsBlocks, outlines, fullContent, budget, followUp]
    .filter((s) => s.length > 0)
    .join("\n\n");
}
