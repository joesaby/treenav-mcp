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
  const collection = source === "docs" ? "docs" : "code";
  const results = store.searchDocuments(intent, {
    limit: topK,
    collection,
    filters,
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
  // Treat regex if it contains regex metacharacters; otherwise literal.
  const regex = /[\\\[\]^$|]|\.\*|\(\?/.test(intent);
  const outcome = store.grepDocuments({
    pattern: intent,
    regex,
    case_insensitive: false,
    filters,
    context: 0,
    limit: topK,
  });
  return outcome.hits.map((h) => ({
    source,
    doc_id: h.doc_id,
    node_id: h.node_id,
    doc_title: h.doc_id,
    node_title: h.node_title,
    file_path: h.file_path,
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
