/**
 * treenav type definitions
 *
 * Models the hierarchical document tree (PageIndex) with search
 * capabilities adapted from Pagefind (CloudCannon). See DESIGN.md
 * for full attribution of every design decision.
 *
 * Attribution summary:
 *   TreeNode, TreeOutline        → PageIndex (tree navigation model)
 *   Posting, NodeStats, BM25     → Pagefind (positional index, scoring)
 *   FilterIndex, FacetCounts     → Pagefind (data-pagefind-filter)
 *   content_hash                 → Pagefind (fragment hashing)
 *   collection, collection_weight → Pagefind (multisite/indexWeight)
 *   description_weight           → Pagefind (data-pagefind-weight)
 *   RankingParams                → Pagefind (configurable ranking)
 */

// ── Tree model (PageIndex-inspired) ─────────────────────────────────

/** A single node in the document tree */
export interface TreeNode {
  node_id: string;
  title: string;
  level: number; // heading level: 1-6
  parent_id: string | null;
  children: string[]; // child node_ids
  content: string; // text content under this heading (before next heading)
  summary: string; // first ~200 chars
  word_count: number;
  line_start: number;
  line_end: number;
  /**
   * For code-indexed nodes: the symbol kind (class, function, interface, ...).
   * Undefined for markdown nodes. Consumed by the scorer for definition boost
   * and by find_symbol for kind filtering.
   */
  symbol_kind?: string;
  /**
   * For code-indexed nodes: the bare symbol name (e.g. "AuthService"),
   * without the kind prefix that lives in `title` ("class AuthService").
   * Undefined for markdown nodes.
   */
  symbol_name?: string;
}

/** Compact tree representation for agent consumption (no content) */
export interface TreeOutline {
  doc_id: string;
  title: string;
  nodes: {
    node_id: string;
    title: string;
    level: number;
    children: string[];
    word_count: number;
    summary: string;
  }[];
}

// ── Document metadata ───────────────────────────────────────────────

/**
 * Metadata for an indexed document.
 *
 * content_hash: Inspired by Pagefind's stable fragment hashing —
 *   "if an HTML page has not changed between two Pagefind indexes,
 *    the fragment filename will not change."
 *   We use it for incremental re-indexing.
 *
 * collection: Inspired by Pagefind's multisite search with mergeFilter.
 *   Each DOCS_ROOT is a named collection with its own weight.
 *
 * facets: Inspired by Pagefind's data-pagefind-filter attributes.
 *   Extracted from frontmatter for faceted search.
 */
export interface DocumentMeta {
  doc_id: string;
  file_path: string; // relative path from docs root
  title: string; // first H1 or filename
  description: string; // first paragraph or frontmatter description
  word_count: number;
  heading_count: number;
  max_depth: number; // deepest heading level in the document
  last_modified: string; // ISO date
  tags: string[]; // extracted from frontmatter if present
  content_hash: string; // Pagefind-style content hash for incremental re-index
  collection: string; // Pagefind-style multisite collection name
  facets: Record<string, string[]>; // Pagefind-style filter facets from frontmatter
  /** Cross-references: doc-relative paths extracted from markdown links */
  references: string[];
}

/** Complete indexed document */
export interface IndexedDocument {
  meta: DocumentMeta;
  tree: TreeNode[]; // flat array of all nodes
  root_nodes: string[]; // top-level node_ids (usually H1/H2)
}

// ── Positional index types (Pagefind-inspired) ──────────────────────

/**
 * A posting in the positional inverted index.
 *
 * Design borrowed from Pagefind's weighted_locations model where word
 * positions are stored per-page and cross-referenced with heading anchors.
 * We adapt: instead of anchors-on-a-flat-page, our nodes ARE the sections,
 * so positions are relative to each node's token stream.
 */
export interface Posting {
  doc_id: string;
  node_id: string;
  positions: number[]; // word offsets within the node's token stream
  term_frequency: number; // |positions|
  weight: number; // base weight: title=3.0, body=1.0, code=1.5
}

/**
 * Per-node statistics needed for BM25 length normalization.
 */
export interface NodeStats {
  doc_id: string;
  node_id: string;
  total_tokens: number;
}

// ── Filter facets (Pagefind data-pagefind-filter inspired) ──────────

/**
 * Filter index for faceted search.
 *
 * Pagefind loads filter data as separate index chunks and supports
 * faceted navigation via data-pagefind-filter attributes. We extract
 * facets from frontmatter and store them in an inverted structure:
 *   key → value → Set<doc_id>
 *
 * This lets the agent narrow search results the way a user would
 * click filter checkboxes in Pagefind's default UI.
 */
export type FilterIndex = Map<string, Map<string, Set<string>>>;

/**
 * Facet counts returned to the agent for discovery.
 * e.g., { tags: { auth: 47, jwt: 23 }, category: { api: 120, guide: 85 } }
 */
export type FacetCounts = Record<string, Record<string, number>>;

// ── Search result ───────────────────────────────────────────────────

/** Search result with positional match data and facets */
export interface SearchResult {
  doc_id: string;
  doc_title: string;
  file_path: string;
  node_id: string;
  node_title: string;
  level: number;
  snippet: string; // best region chosen by density (Pagefind excerpt algorithm)
  score: number; // BM25 relevance score (× collection weight)
  match_positions: number[]; // word positions of all matches in node
  matched_terms: string[]; // which query terms matched
  collection: string; // Pagefind-style multisite collection
  facets: Record<string, string[]>; // document's facet values
}

// ── Literal / regex grep over indexed content ───────────────────────

/**
 * Options for literal or regex scanning over indexed node content.
 *
 * Complementary to BM25 search: grep is the right tool when the agent
 * already knows the exact string, symbol, error code, or regex to find
 * and doesn't want stemming/glossary expansion interfering.
 */
export interface GrepOptions {
  pattern: string;
  regex?: boolean; // if false, pattern is matched literally
  case_insensitive?: boolean;
  doc_id?: string;
  path_glob?: string; // e.g. "**/runbooks/**"
  filters?: Record<string, string | string[]>;
  context?: number; // lines of context on each side (0-5)
  limit?: number;
  /** Wall-clock budget in ms before the scan aborts (ReDoS guard). */
  time_budget_ms?: number;
}

/** A single match produced by grepDocuments. */
export interface GrepHit {
  doc_id: string;
  file_path: string;
  node_id: string;
  node_title: string;
  line_no: number; // approximate absolute line in source file
  line: string; // matching line
  context_before: string[];
  context_after: string[];
}

export interface GrepOutcome {
  hits: GrepHit[];
  truncated: boolean; // hit the limit
  aborted: boolean; // hit the time budget
  docs_scanned: number;
  nodes_scanned: number;
}

// ── Ranking configuration (Pagefind-style configurable knobs) ───────

/**
 * BM25 + ranking tuning parameters.
 *
 * Pagefind v1.1 aligned its ranking to BM25 and exposed tuning knobs after
 * finding that reference documentation sites benefit from different params
 * than blog/marketing sites. We follow the same philosophy.
 */
export interface RankingParams {
  /** TF saturation. Higher = TF matters more.
   *  Standard: 1.2. For docs heavy in repeated terms, try 0.8-1.0. */
  bm25_k1: number;

  /** Document length normalization. 0 = none, 1 = full. Standard: 0.75 */
  bm25_b: number;

  /** Multiplier for terms found in heading titles.
   *  Mirrors Pagefind's implicit heading weight boost. Default 3.0 */
  title_weight: number;

  /** Multiplier for terms found in code blocks.
   *  Like Pagefind's data-pagefind-weight for custom regions. Default 1.5 */
  code_weight: number;

  /** Multiplier for terms found in frontmatter description.
   *  Inspired by Pagefind's data-pagefind-meta weighting. Default 2.0 */
  description_weight: number;

  /** Bonus per additional query term co-occurring in the same node.
   *  Rewards sections that match multiple aspects of the query.
   *  RRF-rescaled default: 0.01 (was 2.0 in the pre-RRF additive scorer).
   *  See Tier 3 of the Semble feature port plan for the rescaling rationale —
   *  RRF fused scores live in `~[0, 0.05]`, so additive bonuses had to
   *  shrink by ~2 orders of magnitude to remain meaningful but not
   *  dominant. */
  term_proximity_bonus: number;

  /** Flat bonus when ALL query terms present in a single node.
   *  RRF-rescaled default: 0.05 (was 5.0). Sized at roughly the RRF max for
   *  a three-signal pipeline — large enough to promote a full-coverage
   *  rank-2 above a partial-coverage rank-1, but bounded so it doesn't
   *  flatten the rank scale. */
  full_coverage_bonus: number;

  /** Discount factor for prefix matches (0-1). Default 0.5.
   *  Pagefind handles this at the chunk-loading level; we apply as a score multiplier.
   *  Post-Tier-3: also acts as the legacy fallback default for
   *  `signal_weights.bm25_prefix` when the latter is left undefined. */
  prefix_penalty: number;

  /** RRF (Reciprocal Rank Fusion) tuning constant. Each retrieval signal
   *  produces a per-document rank (1, 2, 3, …); the contribution to the
   *  fused score is `signal_weight / (rrf_k + rank)`. Standard literature
   *  default is 60. Lower values steepen the rank curve (top hits dominate
   *  more), higher values flatten it. Default 60. */
  rrf_k: number;

  /** Per-signal RRF weights. Each entry is the multiplier applied to that
   *  signal's `1 / (rrf_k + rank)` contribution. Missing keys fall back
   *  to legacy params: `bm25_exact` defaults to 1.0, `bm25_prefix` falls
   *  back to `prefix_penalty`, `subtoken` falls back to `subtoken_weight`.
   *  Set a value to 0 to disable that signal entirely for the next call. */
  signal_weights: Record<string, number>;

  /** Multiplier applied to a code node's score when a query term exactly matches
   *  its `symbol_name` AND its `symbol_kind` is a definition-kind (class, function,
   *  interface, method, type, enum, struct, trait, enum_variant). Lifts the
   *  definition above call-sites and references. Default 2.0. Set to 1.0 to disable.
   *  Applies once per node regardless of how many terms match. */
  definition_boost: number;

  /** Multiplicative lift applied to every matching node within a doc when the doc
   *  has ≥2 matching nodes. Each node's score is multiplied by
   *  `1 + file_coherence_bonus * min(matchCount - 1, 5)`. Bounded so a doc with
   *  many incidental matches doesn't dominate a doc with a single strong hit.
   *  Models the Semble insight that a file with multiple distinct matches is
   *  more relevant than a file with one incidental match. Default 0.05.
   *  Set to 0 to disable. */
  file_coherence_bonus: number;

  /** Extra additive lift for the leading node in a multi-hit doc. Pushes the
   *  file's natural entry point (top-of-file, exported class) ahead of internal
   *  methods. Adds `file_lead_bonus * max(group scores)` to the node with the
   *  smallest `line_start` (tie-broken by shallowest `level`). Default 0.05.
   *  Set to 0 to disable. */
  file_lead_bonus: number;

  /** Score multiplier applied to subtoken posting hits. At index time, code
   *  nodes (`symbol_kind` set) emit subtoken postings for camelCase /
   *  snake_case / kebab-case identifier splits — so a query for `frontmatter`
   *  matches `parseFrontmatter`. Subtoken hits contribute
   *  `bm25_score * subtoken_weight` to the node score, and count toward
   *  `term_proximity_bonus` but NOT `full_coverage_bonus` (precision guard
   *  so multi-subtoken queries can't spoof full coverage from a single
   *  identifier). Markdown nodes are never subtokenized. Default 0.5.
   *  Set to 0 to disable subtoken contributions. */
  subtoken_weight: number;

  /** When the query looks identifier-shaped (camelCase, snake_case, or an
   *  all-caps acronym ≥2 chars), `definition_boost` is multiplied by this
   *  factor for that single query. The user typed a specific identifier —
   *  surfacing the canonical definition matters even more. Default 1.5.
   *  Set to 1.0 to disable. */
  symbol_query_definition_boost_multiplier: number;

  /** When the query looks identifier-shaped, the `subtoken` RRF signal
   *  weight is multiplied by this factor for that single query. The user
   *  typed a specific identifier — they want exact matches, not loose
   *  subtoken matches that often pull in unrelated code. Default 0.5.
   *  Set to 1.0 to disable dampening.
   *
   *  Pre-Tier-3 this multiplied the legacy `subtoken_weight` knob inline;
   *  post-Tier-3 it is layered onto the resolved `signal_weights.subtoken`
   *  value (PR 7 of the Semble feature port). */
  symbol_query_subtoken_dampener: number;

  /** When the query looks identifier-shaped, the `bm25_exact` RRF signal
   *  weight is multiplied by this factor for that single query —
   *  symbol-shaped queries should weight the exact-match retriever more
   *  heavily relative to the prefix and subtoken retrievers. Default 1.3.
   *  Set to 1.0 to disable. Companion to `symbol_query_subtoken_dampener`,
   *  added in PR 7 of the Semble feature port. */
  symbol_query_exact_boost: number;

  /** Additive bonus for nodes whose match positions cluster within a small
   *  window. For nodes longer than 2× the corpus average node length, the
   *  scorer adds `window_density_bonus * (best_window_count / window_size)`
   *  to the node's score. Rewards focused matches in long bodies — a 200-line
   *  function with 5 matches in 30 tokens beats one with 5 matches scattered
   *  over 200 tokens. Short nodes are unaffected (their tf-idf already
   *  concentrates matches). RRF-rescaled default: 0.005 (was 1.0). Best
   *  density caps at 1.0, so the bonus caps at 0.005 — about 10% of RRF max
   *  in a three-signal pipeline. */
  window_density_bonus: number;
}

export const DEFAULT_RANKING: RankingParams = {
  bm25_k1: 1.2,
  bm25_b: 0.75,
  title_weight: 3.0,
  code_weight: 1.5,
  description_weight: 2.0,
  // Additive bonus defaults rescaled for Tier 3 RRF score scale (~[0, 0.05]).
  // See per-field doc comments above for rationale. The plan's initial
  // table proposed 0.005/0.01/0.005; sweeping over the search-quality
  // QRels showed a regression on multi-term exact-match queries
  // ("rate limiting", "kubernetes rolling update deployment", "oauth")
  // where canonical doc nodes were not pulled clear of incidental hits.
  // Doubling tp and lifting fc to 0.05 (still ≈ RRF max so a flat lift
  // can promote rank-2 over rank-1 without flattening the scale)
  // restores exact-match NDCG@10 above the 0.83 gate.
  term_proximity_bonus: 0.01,
  full_coverage_bonus: 0.05,
  prefix_penalty: 0.5,
  definition_boost: 2.0,
  file_coherence_bonus: 0.05,
  file_lead_bonus: 0.05,
  subtoken_weight: 0.5,
  symbol_query_definition_boost_multiplier: 1.5,
  symbol_query_subtoken_dampener: 0.5,
  symbol_query_exact_boost: 1.3,
  window_density_bonus: 0.005,
  // RRF fusion (Tier 3): k=60 is the standard literature default. Per-signal
  // weights default to {1.0, prefix_penalty, subtoken_weight} via the
  // resolution rules in store.ts so existing tuning of the legacy knobs
  // continues to work.
  rrf_k: 60,
  signal_weights: {},
};

// ── Collection configuration (Pagefind multisite inspired) ──────────

/**
 * A named collection of documents from a single docs root.
 *
 * Pagefind's multisite feature lets you search across multiple indexes
 * with per-index indexWeight. We support the same pattern in-process:
 * multiple DOCS_ROOTs, each with a name and weight.
 */
export interface CollectionConfig {
  name: string;
  root: string;
  weight: number; // multiplied into BM25 scores. Pagefind's indexWeight equivalent.
  glob_pattern?: string;
  glob_patterns?: string[];
  /** Score-time penalty patterns applied to docs in this collection.
   *  Each pattern is a regex string matched against `meta.file_path`; when
   *  multiple patterns match a doc, the lowest penalty wins (penalties do
   *  not compound). Penalty is a multiplier in (0, 1]; default behavior
   *  (no field set) is no penalty. Used to down-rank tests, .d.ts stubs,
   *  legacy/compat shims while keeping them in the index. */
  noise_patterns?: NoisePattern[];
}

export interface NoisePattern {
  /** Regex string matched against `DocumentMeta.file_path` */
  pattern: string;
  /** Score multiplier in (0, 1]. Lower = stronger demotion. */
  penalty: number;
}

/** Default score-time noise patterns for code collections.
 *  Markdown collections get NO defaults — wikis often have legitimate
 *  `legacy/` content that should not be auto-penalized. */
export const DEFAULT_CODE_NOISE_PATTERNS: NoisePattern[] = [
  { pattern: "(^|/)__tests__/", penalty: 0.5 },
  { pattern: "\\.test\\.[a-z]+$", penalty: 0.5 },
  { pattern: "\\.spec\\.[a-z]+$", penalty: 0.5 },
  { pattern: "\\.d\\.ts$", penalty: 0.3 },
  { pattern: "(^|/)compat/", penalty: 0.6 },
  { pattern: "(^|/)legacy/", penalty: 0.6 },
  { pattern: "(^|/)examples?/", penalty: 0.7 },
];

/** Main configuration */
export interface IndexConfig {
  collections: CollectionConfig[];
  /** Optional code collections — source files indexed via AST parsing */
  code_collections?: CollectionConfig[];
  summary_length: number;
  max_depth: number;
}

/** Convenience: single-root config (the common case) */
export function singleRootConfig(
  docs_root: string,
  collection_name: string = "docs"
): IndexConfig {
  return {
    collections: [
      {
        name: collection_name,
        root: docs_root,
        weight: 1.0,
        glob_pattern: "**/*.md",
      },
    ],
    summary_length: 200,
    max_depth: 6,
  };
}

// ── compile_context (composed retrieval) ───────────────────────────
//
// See docs/superpowers/specs/2026-05-06-compile-context-design.md
// and docs/adr/0002-multi-intent-out-of-scope.md.
//
// compile_context composes the existing read primitives
// (searchDocuments / grepDocuments / lookupRow / getTree / getSubtree)
// behind one call. Pure orchestration — no new ranking, no new index.

export type CompileContextMode =
  | "auto"
  | "search"
  | "grep"
  | "lookup"
  | "symbol";

/** Resolved mode after `auto` heuristic runs. Never `"auto"`. */
export type ResolvedMode = Exclude<CompileContextMode, "auto">;

export type CompileContextSource = "docs" | "code" | "rows" | "all";

/** Concrete source name in the result (never `"all"`). */
export type ResolvedSource = "docs" | "code" | "rows";

export interface CompileContextInput {
  intent: string;
  mode?: CompileContextMode;
  sources?: CompileContextSource[];
  filters?: Record<string, string | string[]>;
  output: {
    top_k_per_source?: number;
    include_snippets?: boolean;
    include_outlines_for_top?: number;
    include_full_content_for_top?: number;
    max_tokens?: number;
  };
}

export interface CompileContextHit {
  source: ResolvedSource;
  doc_id: string;
  node_id: string;
  doc_title: string;
  node_title: string;
  file_path: string;
  score: number;
  /** Density-based snippet for search/grep hits. */
  snippet?: string;
  /** Symbol signature for symbol-mode / code hits. */
  signature?: string;
  /** Line number for grep hits. */
  line_no?: number;
}

export interface CompileContextOutlineNode {
  node_id: string;
  title: string;
  level: number;
  word_count: number;
  summary: string;
}

export interface CompileContextOutline {
  doc_id: string;
  doc_title: string;
  nodes: CompileContextOutlineNode[];
}

export interface CompileContextFullContent {
  doc_id: string;
  node_id: string;
  node_title: string;
  content: string;
}

export interface CompileContextResult {
  intent: string;
  resolved_mode: ResolvedMode;
  sources: ResolvedSource[];
  duration_ms: number;
  hits_by_source: Record<ResolvedSource, CompileContextHit[]>;
  /** Total hits available before top_k_per_source cut, per source. */
  hit_totals_by_source: Record<ResolvedSource, number>;
  outlines: CompileContextOutline[];
  full_content: CompileContextFullContent[];
  /** Human-readable notes about what was trimmed for budget. */
  trim_notes: string[];
  tokens_used_estimate: number;
  tokens_budget: number;
}
