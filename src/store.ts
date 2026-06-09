/**
 * Document Store — BM25 + Positional Index + Faceted Filters
 *
 * In-memory index combining three design influences:
 *
 * 1. PageIndex (pageindex.ai) — Tree navigation for reasoning-based retrieval
 * 2. Pagefind (CloudCannon) — Positional inverted index, BM25 scoring,
 *    filter facets, content hashing, multisite weights, density excerpts
 * 3. Bun.markdown (Oven) — Structural parsing via render() callbacks
 *
 * See DESIGN.md for full attribution of every design decision.
 */

import type {
  IndexedDocument,
  TreeNode,
  TreeOutline,
  SearchResult,
  DocumentMeta,
  Posting,
  NodeStats,
  RankingParams,
  FilterIndex,
  FacetCounts,
  GrepOptions,
  GrepHit,
  GrepOutcome,
  NoisePattern,
} from "./types";
import { DEFAULT_RANKING } from "./types";
import { extractGlossaryEntries } from "./indexer";

export class DocumentStore {
  private docs: Map<string, IndexedDocument> = new Map();

  // ── Positional inverted index (Pagefind-inspired) ───────────────
  // term → Posting[] (one entry per node the term appears in)
  private index: Map<string, Posting[]> = new Map();
  // Sorted term list for O(log n) prefix lookups
  private sortedTerms: string[] = [];

  // ── Subtoken inverted index (Semble-inspired identifier-stem matching) ─
  // Populated only for code nodes (symbol_kind set). Maps a stemmed
  // subtoken (e.g. "frontmatter" from "parseFrontmatter") → postings.
  // Looked up at search time and weighted by subtoken_weight; matches
  // count toward term_proximity_bonus but NOT full_coverage_bonus.
  private subtokenIndex: Map<string, Posting[]> = new Map();

  // ── Per-node stats for BM25 length normalization ─────────────────
  private nodeStats: Map<string, NodeStats> = new Map();

  // ── Corpus-level stats ───────────────────────────────────────────
  private totalNodes: number = 0;
  private avgNodeLength: number = 0;

  // ── Filter facets (Pagefind data-pagefind-filter inspired) ───────
  // key → value → Set<doc_id>
  private filters: FilterIndex = new Map();

  // ── Content hashes for incremental re-indexing (Pagefind-inspired) ─
  // file_path → content_hash
  private contentHashes: Map<string, string> = new Map();

  // ── Collection weights (Pagefind multisite/indexWeight inspired) ──
  private collectionWeights: Map<string, number> = new Map();

  // ── Noise patterns per collection (Semble-inspired) ──────────────
  // Pre-compiled at setNoisePatterns() time so the scoring hot path
  // doesn't construct RegExp per doc per query.
  private noisePatterns: Map<string, { regex: RegExp; penalty: number }[]> =
    new Map();

  // ── Ranking parameters (Pagefind-style configurable knobs) ───────
  private ranking: RankingParams = { ...DEFAULT_RANKING };

  // ── Glossary for query expansion (abbreviation → expanded forms) ──
  // Maps abbreviated terms to their expanded equivalents so queries
  // like "CLI" also match "command line interface"
  private glossary: Map<string, string[]> = new Map();

  // ── Row index for O(1) key→row lookup (structured data) ─────────
  // normalized key → { doc_id, node_id }
  private rowIndex: Map<string, { doc_id: string; node_id: string }> = new Map();

  // ── Reference map for cross-document linking ────────────────────
  // basename(file_path) → { doc_id, tree }
  private refMap: Map<string, { doc_id: string; tree: TreeNode[] }> = new Map();

  // ── Load / Refresh ──────────────────────────────────────────────

  load(documents: IndexedDocument[]): void {
    this.docs.clear();
    this.index.clear();
    this.subtokenIndex.clear();
    this.nodeStats.clear();
    this.filters.clear();
    this.contentHashes.clear();

    for (const doc of documents) {
      this.docs.set(doc.meta.doc_id, doc);
      this.contentHashes.set(doc.meta.file_path, doc.meta.content_hash);
    }

    this.buildIndex();
    this.buildFilterIndex();
    this.buildAutoGlossary(documents);
    this.buildRefMap();
    this.buildRowIndex();

    console.log(
      `Store loaded: ${this.docs.size} docs, ${this.totalNodes} nodes, ` +
        `${this.index.size} terms, ${this.filters.size} facet keys, ` +
        `${this.glossary.size} glossary mappings, ` +
        `avg node length: ${this.avgNodeLength.toFixed(0)} tokens`
    );
  }

  /**
   * Add or update a single document.
   * Handles incremental re-indexing: removes old data, adds new.
   *
   * Inspired by Pagefind's content hashing: "if an HTML page has not
   * changed between two Pagefind indexes, the fragment filename will
   * not change." We use content hashes to skip unchanged files entirely.
   */
  addDocument(doc: IndexedDocument): void {
    const existingDoc = this.docs.get(doc.meta.doc_id);

    // Remove old postings if this is an update
    if (existingDoc) {
      this.removeDocumentPostings(existingDoc);
      this.removeDocumentFilters(existingDoc);
    }

    this.docs.set(doc.meta.doc_id, doc);
    this.contentHashes.set(doc.meta.file_path, doc.meta.content_hash);
    this.indexDocument(doc);
    this.indexDocumentFilters(doc);
    this.recalcCorpusStats();
  }

  /**
   * Check if a file needs re-indexing based on content hash.
   * Pagefind-style incremental: skip unchanged files.
   */
  needsReindex(filePath: string, newHash: string): boolean {
    const existingHash = this.contentHashes.get(filePath);
    return existingHash !== newHash;
  }

  getContentHash(filePath: string): string | undefined {
    return this.contentHashes.get(filePath);
  }

  removeDocument(doc_id: string): void {
    const doc = this.docs.get(doc_id);
    if (!doc) return;

    this.removeDocumentPostings(doc);
    this.removeDocumentFilters(doc);
    this.contentHashes.delete(doc.meta.file_path);
    this.docs.delete(doc_id);
    this.recalcCorpusStats();
  }

  setRanking(params: Partial<RankingParams>): void {
    this.ranking = { ...this.ranking, ...params };
  }

  /**
   * Set collection weights (Pagefind multisite indexWeight equivalent).
   */
  setCollectionWeights(weights: Record<string, number>): void {
    for (const [name, weight] of Object.entries(weights)) {
      this.collectionWeights.set(name, weight);
    }
  }

  /**
   * Set per-collection noise patterns. Patterns are compiled once and applied
   * to docs in the named collection at scoring time. When multiple patterns
   * match a single doc, the lowest penalty wins (penalties do not compound).
   *
   * Each call replaces the patterns for the named collections — to clear
   * patterns for a collection, pass `{ name: [] }`. Collections not present
   * in the argument retain their existing patterns.
   */
  setNoisePatterns(
    patterns: Record<string, NoisePattern[]>,
  ): void {
    for (const [name, list] of Object.entries(patterns)) {
      this.noisePatterns.set(
        name,
        list.map((p) => ({ regex: new RegExp(p.pattern), penalty: p.penalty })),
      );
    }
  }

  /**
   * Load a glossary for query expansion.
   *
   * Maps abbreviations and short-forms to their expanded equivalents.
   * During search, query terms are expanded using the glossary so that
   * "CLI" also matches "command line interface", "K8s" matches
   * "kubernetes", etc. Bidirectional: expanded terms also map back.
   *
   * Format: Record<string, string[]>
   *   { "CLI": ["command line interface"], "K8s": ["kubernetes"] }
   */
  loadGlossary(entries: Record<string, string[]>): void {
    this.glossary.clear();
    for (const [key, expansions] of Object.entries(entries)) {
      const normalizedKey = key.toLowerCase();
      const normalizedExpansions = expansions.map((e) => e.toLowerCase());

      // Forward: abbreviation → expanded forms
      this.glossary.set(normalizedKey, normalizedExpansions);

      // Reverse: each expanded term → abbreviation
      for (const expansion of normalizedExpansions) {
        const existing = this.glossary.get(expansion) || [];
        if (!existing.includes(normalizedKey)) {
          this.glossary.set(expansion, [...existing, normalizedKey]);
        }
      }
    }
    if (this.glossary.size > 0) {
      console.log(`Glossary loaded: ${Object.keys(entries).length} entries → ${this.glossary.size} expansion mappings`);
    }
  }

  /**
   * Expand query terms using the glossary.
   * Returns the original terms plus any glossary expansions.
   */
  private expandQueryTerms(terms: string[]): string[] {
    if (this.glossary.size === 0) return terms;

    const expanded = new Set(terms);
    for (const term of terms) {
      const expansions = this.glossary.get(term);
      if (expansions) {
        for (const expansion of expansions) {
          // Tokenize and stem each expansion (may be multi-word)
          const expandedTokens = tokenize(expansion).map(stem).filter((t) => t.length >= 2);
          for (const t of expandedTokens) {
            expanded.add(t);
          }
        }
      }
    }
    return [...expanded];
  }

  // ── Remove old postings for incremental update ──────────────────

  private removeDocumentPostings(doc: IndexedDocument): void {
    const docId = doc.meta.doc_id;

    // Remove from main inverted index
    for (const [term, postings] of this.index) {
      const filtered = postings.filter((p) => p.doc_id !== docId);
      if (filtered.length === 0) {
        this.index.delete(term);
      } else {
        this.index.set(term, filtered);
      }
    }

    // Remove from subtoken index (parallel structure)
    for (const [term, postings] of this.subtokenIndex) {
      const filtered = postings.filter((p) => p.doc_id !== docId);
      if (filtered.length === 0) {
        this.subtokenIndex.delete(term);
      } else {
        this.subtokenIndex.set(term, filtered);
      }
    }

    // Remove node stats
    for (const node of doc.tree) {
      this.nodeStats.delete(`${docId}::${node.node_id}`);
    }
  }

  private removeDocumentFilters(doc: IndexedDocument): void {
    const docId = doc.meta.doc_id;

    for (const [, valueMap] of this.filters) {
      for (const [, docSet] of valueMap) {
        docSet.delete(docId);
      }
    }
  }

  // ── Build the full positional inverted index ────────────────────
  //
  // Mirrors Pagefind's indexing pass where it walks HTML, splits on
  // anchor elements, and records word positions + weights.

  private buildIndex(): void {
    for (const doc of this.docs.values()) {
      this.indexDocument(doc);
    }
    this.recalcCorpusStats();
  }

  private indexDocument(doc: IndexedDocument): void {
    // Tokenize description separately for description_weight boosting
    const descriptionTerms = doc.meta.description
      ? new Set(tokenize(doc.meta.description).map(stem).filter((t) => t.length >= 2))
      : new Set<string>();
    const firstNodeId = doc.tree[0]?.node_id;

    for (const node of doc.tree) {
      const nodeKey = `${doc.meta.doc_id}::${node.node_id}`;
      const isFirstNode = node.node_id === firstNodeId;

      // Tokenize title and body separately for weighting
      // (Pagefind also weights heading text differently from body text)
      const titleTokens = tokenize(node.title);
      const bodyTokens = tokenize(node.content);
      const codeTokens = extractCodeTokens(node.content);

      // Combine into single token stream (title first, then body)
      const allTokens = [...titleTokens, ...bodyTokens];
      const titleEnd = titleTokens.length;

      // Store node stats for BM25 length normalization
      this.nodeStats.set(nodeKey, {
        doc_id: doc.meta.doc_id,
        node_id: node.node_id,
        total_tokens: allTokens.length,
      });

      // Build postings: for each unique term, record positions + weight
      const termPositions: Map<
        string,
        { positions: number[]; maxWeight: number }
      > = new Map();

      for (let pos = 0; pos < allTokens.length; pos++) {
        const term = stem(allTokens[pos]);
        if (term.length < 2) continue;

        if (!termPositions.has(term)) {
          termPositions.set(term, { positions: [], maxWeight: 1.0 });
        }

        const entry = termPositions.get(term)!;
        entry.positions.push(pos);

        // Weight by position: title > description > code > body
        // (Pagefind uses data-pagefind-weight for custom region weighting)
        let weight = 1.0;
        if (pos < titleEnd) {
          weight = this.ranking.title_weight;
        } else if (isFirstNode && descriptionTerms.has(term)) {
          // Boost description terms in the first node
          weight = Math.max(weight, this.ranking.description_weight);
        } else if (codeTokens.has(allTokens[pos])) {
          weight = this.ranking.code_weight;
        }
        entry.maxWeight = Math.max(entry.maxWeight, weight);
      }

      // Insert postings into the inverted index
      for (const [term, { positions, maxWeight }] of termPositions) {
        const posting: Posting = {
          doc_id: doc.meta.doc_id,
          node_id: node.node_id,
          positions,
          term_frequency: positions.length,
          weight: maxWeight,
        };

        if (!this.index.has(term)) {
          this.index.set(term, []);
        }
        this.index.get(term)!.push(posting);
      }

      // Subtoken indexing — code nodes only. Operates on the RAW (un-lowercased)
      // title and content so camelCase splits remain visible. Subtokens equal
      // to an existing exact term are skipped to avoid double-counting.
      if (node.symbol_kind !== undefined) {
        const exactTerms = new Set(termPositions.keys());
        const subtokenFreq: Map<string, number> = new Map();
        for (const ident of extractIdentifiers(node.title + " " + node.content)) {
          for (const sub of identifierSubtokens(ident)) {
            const stemmed = stem(sub);
            if (stemmed.length < 2) continue;
            if (exactTerms.has(stemmed)) continue;
            subtokenFreq.set(stemmed, (subtokenFreq.get(stemmed) ?? 0) + 1);
          }
        }
        for (const [term, tf] of subtokenFreq) {
          const posting: Posting = {
            doc_id: doc.meta.doc_id,
            node_id: node.node_id,
            positions: [], // subtoken postings carry no positional info
            term_frequency: tf,
            weight: 1.0,
          };
          if (!this.subtokenIndex.has(term)) {
            this.subtokenIndex.set(term, []);
          }
          this.subtokenIndex.get(term)!.push(posting);
        }
      }
    }
  }

  // ── Build filter facet index (Pagefind data-pagefind-filter) ─────

  private buildFilterIndex(): void {
    for (const doc of this.docs.values()) {
      this.indexDocumentFilters(doc);
    }
  }

  private indexDocumentFilters(doc: IndexedDocument): void {
    const docId = doc.meta.doc_id;

    // Index explicit facets from frontmatter
    for (const [key, values] of Object.entries(doc.meta.facets)) {
      if (!this.filters.has(key)) {
        this.filters.set(key, new Map());
      }
      const valueMap = this.filters.get(key)!;
      for (const val of values) {
        if (!valueMap.has(val)) {
          valueMap.set(val, new Set());
        }
        valueMap.get(val)!.add(docId);
      }
    }

    // Index tags as a facet too
    if (doc.meta.tags.length > 0) {
      if (!this.filters.has("tags")) {
        this.filters.set("tags", new Map());
      }
      const tagMap = this.filters.get("tags")!;
      for (const tag of doc.meta.tags) {
        if (!tagMap.has(tag)) {
          tagMap.set(tag, new Set());
        }
        tagMap.get(tag)!.add(docId);
      }
    }

    // Auto-facet: collection (Pagefind multisite mergeFilter equivalent)
    if (doc.meta.collection) {
      if (!this.filters.has("collection")) {
        this.filters.set("collection", new Map());
      }
      const colMap = this.filters.get("collection")!;
      if (!colMap.has(doc.meta.collection)) {
        colMap.set(doc.meta.collection, new Set());
      }
      colMap.get(doc.meta.collection)!.add(docId);
    }
  }

  private recalcCorpusStats(): void {
    let totalTokens = 0;
    this.totalNodes = this.nodeStats.size;

    for (const stats of this.nodeStats.values()) {
      totalTokens += stats.total_tokens;
    }

    this.avgNodeLength =
      this.totalNodes > 0 ? totalTokens / this.totalNodes : 0;

    this.sortedTerms = Array.from(this.index.keys()).sort();
  }

  /** Binary search for the first index where sortedTerms[i] >= prefix */
  private prefixLowerBound(prefix: string): number {
    let lo = 0, hi = this.sortedTerms.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sortedTerms[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // ── BM25 scoring (Pagefind v1.1+ alignment) ────────────────────
  //
  //   score(q, d) = Σ IDF(qi) · (tf · (k1+1)) / (tf + k1 · (1 - b + b · |d|/avgdl))
  //
  // Extended with weight multipliers and co-occurrence bonuses.

  private computeBM25(
    term: string,
    posting: Posting,
    nodeLength: number
  ): number {
    const postings = this.index.get(term);
    const n = postings ? postings.length : 0;
    return this.computeBM25Raw(posting, nodeLength, n);
  }

  private computeBM25Subtoken(
    term: string,
    posting: Posting,
    nodeLength: number
  ): number {
    const postings = this.subtokenIndex.get(term);
    const n = postings ? postings.length : 0;
    return this.computeBM25Raw(posting, nodeLength, n);
  }

  private computeBM25Raw(
    posting: Posting,
    nodeLength: number,
    n: number,
  ): number {
    const { bm25_k1: k1, bm25_b: b } = this.ranking;
    const N = this.totalNodes;

    // IDF: how rare is this term across all nodes?
    const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);

    // TF component with length normalization
    const tf = posting.term_frequency;
    const lengthNorm = 1 - b + b * (nodeLength / this.avgNodeLength);
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * lengthNorm);

    // Apply position-based weight
    return idf * tfNorm * posting.weight;
  }

  // ── Resolve facet filters to a doc_id whitelist ─────────────────
  //
  // Pagefind applies filters before scoring. We do the same:
  // intersect all filter conditions to get the candidate doc set.

  private resolveFilters(
    filters: Record<string, string | string[]>
  ): Set<string> | null {
    let candidateDocs: Set<string> | null = null;

    for (const [key, value] of Object.entries(filters)) {
      const values = Array.isArray(value) ? value : [value];
      const filterMap = this.filters.get(key);
      if (!filterMap) {
        // Unknown filter key → empty result
        return new Set();
      }

      // Union within values (OR), then intersect across keys (AND)
      const matchingDocs = new Set<string>();
      for (const val of values) {
        const docSet = filterMap.get(val);
        if (docSet) {
          for (const id of docSet) matchingDocs.add(id);
        }
      }

      if (candidateDocs === null) {
        candidateDocs = matchingDocs;
      } else {
        // Intersect
        for (const id of candidateDocs) {
          if (!matchingDocs.has(id)) candidateDocs.delete(id);
        }
      }
    }

    return candidateDocs;
  }

  // ── Cross-document search with BM25 + facets ───────────────────

  searchDocuments(
    query: string,
    options?: {
      limit?: number;
      doc_id?: string;
      collection?: string;
      filters?: Record<string, string | string[]>;
    }
  ): SearchResult[] {
    const queryTerms = tokenize(query).map(stem).filter((t) => t.length >= 2);
    if (queryTerms.length === 0) return [];

    // Detect shape on the RAW query (preserves casing) so camelCase /
    // snake_case / acronym signals survive the lowercasing in tokenize().
    // Used to scale per-signal RRF weights and definition_boost for this
    // single search call — Semble-style adaptive lexical weighting now
    // expressed at the signal level, on top of RRF fusion (Tier 3).
    const symbolShaped = isSymbolShapedQuery(query);
    const effectiveDefinitionBoost = symbolShaped
      ? this.ranking.definition_boost *
        this.ranking.symbol_query_definition_boost_multiplier
      : this.ranking.definition_boost;

    // Resolve per-signal RRF weights. `signal_weights` overrides the legacy
    // knobs; missing keys fall back to legacy params for backward compat.
    // Adaptive weighting layers a multiplicative factor on top of the
    // resolved values when the query is symbol-shaped.
    const sw = this.ranking.signal_weights;
    const baseExactWeight = sw.bm25_exact ?? 1.0;
    const basePrefixWeight = sw.bm25_prefix ?? this.ranking.prefix_penalty;
    const baseSubtokenWeight = sw.subtoken ?? this.ranking.subtoken_weight;
    const effective = {
      bm25_exact: symbolShaped
        ? baseExactWeight * this.ranking.symbol_query_exact_boost
        : baseExactWeight,
      bm25_prefix: basePrefixWeight,
      subtoken: symbolShaped
        ? baseSubtokenWeight * this.ranking.symbol_query_subtoken_dampener
        : baseSubtokenWeight,
    };
    const rrfK = this.ranking.rrf_k;

    // Expand query using glossary (abbreviation ↔ expanded forms)
    const expandedTerms = this.expandQueryTerms(queryTerms);
    const uniqueTerms = [...new Set(expandedTerms)];

    // Resolve facet filters to a doc_id whitelist (Pagefind-style pre-filter)
    let filterWhitelist: Set<string> | null = null;
    if (options?.filters && Object.keys(options.filters).length > 0) {
      filterWhitelist = this.resolveFilters(options.filters);
      if (filterWhitelist && filterWhitelist.size === 0) return [];
    }

    // Add collection filter if specified (Pagefind multisite scoping)
    if (options?.collection) {
      const colDocs = this.filters.get("collection")?.get(options.collection);
      if (!colDocs || colDocs.size === 0) return [];
      if (filterWhitelist) {
        for (const id of filterWhitelist) {
          if (!colDocs.has(id)) filterWhitelist.delete(id);
        }
      } else {
        filterWhitelist = new Set(colDocs);
      }
    }

    // ── Tier 3: Reciprocal Rank Fusion (RRF) ───────────────────────
    //
    // Phase 1: per-signal accumulation. For each retrieval signal
    //   {bm25_exact, bm25_prefix, subtoken}, sum BM25 contributions per
    //   node across query terms. NO per-signal multiplier yet — the
    //   per-signal scores are only used to RANK nodes within the signal.
    //
    // Phase 2: rank fusion. Sort each signal's nodes by score desc, assign
    //   rank 1..N, accumulate `effective[signal] / (rrf_k + rank)` into
    //   `nodeScores`. RRF is rank-driven and bounded — each signal
    //   contributes at most `effective[signal] / (rrf_k + 1)` to a node.
    //
    // Phase 3: matched-term/exact-term bookkeeping. matchedTerms is the
    //   union of all three signals' term-sets (recall-oriented, drives
    //   term_proximity_bonus). exactTerms is the union of exact + prefix
    //   only (precision-oriented, drives full_coverage_bonus — subtokens
    //   excluded so a multi-subtoken match in a single identifier like
    //   parseFrontmatter can't spoof full coverage).
    //
    // Position tracking happens during Phase 1, only from bm25_exact and
    // bm25_prefix postings (subtoken postings have empty positions). The
    // existing MAX_POSITIONS_PER_NODE = 30 cap continues to apply.
    const MAX_POSITIONS_PER_NODE = 30;
    const MAX_PREFIX_TERMS = 50;

    type SignalEntry = {
      score: number;
      terms: Set<string>;
      positions: number[];
      doc_id: string;
      node_id: string;
    };
    const exactSignal = new Map<string, SignalEntry>();
    const prefixSignal = new Map<string, SignalEntry>();
    const subtokenSignal = new Map<string, SignalEntry>();

    const ensure = (
      m: Map<string, SignalEntry>,
      key: string,
      doc_id: string,
      node_id: string
    ): SignalEntry => {
      let e = m.get(key);
      if (!e) {
        e = { score: 0, terms: new Set(), positions: [], doc_id, node_id };
        m.set(key, e);
      }
      return e;
    };

    const appendPositions = (target: number[], src: number[]): void => {
      if (target.length >= MAX_POSITIONS_PER_NODE) return;
      const remaining = MAX_POSITIONS_PER_NODE - target.length;
      const slice = src.length <= remaining ? src : src.slice(0, remaining);
      for (let i = 0; i < slice.length; i++) target.push(slice[i]);
    };

    for (const term of uniqueTerms) {
      // Signal 1: exact term lookup
      if (effective.bm25_exact > 0) {
        const postings = this.index.get(term);
        if (postings) {
          for (const posting of postings) {
            if (options?.doc_id && posting.doc_id !== options.doc_id) continue;
            if (filterWhitelist && !filterWhitelist.has(posting.doc_id)) continue;

            const nodeKey = `${posting.doc_id}::${posting.node_id}`;
            const stats = this.nodeStats.get(nodeKey);
            if (!stats) continue;

            const bm25Score = this.computeBM25(term, posting, stats.total_tokens);
            const entry = ensure(exactSignal, nodeKey, posting.doc_id, posting.node_id);
            entry.score += bm25Score;
            entry.terms.add(term);
            appendPositions(entry.positions, posting.positions);
          }
        }
      }

      // Signal 2: prefix matching via sorted term array (O(log n) lookup)
      if (effective.bm25_prefix > 0 && term.length >= 3) {
        let prefixCount = 0;
        const start = this.prefixLowerBound(term);
        for (let ti = start; ti < this.sortedTerms.length; ti++) {
          const indexedTerm = this.sortedTerms[ti];
          if (!indexedTerm.startsWith(term)) break;
          if (indexedTerm === term) continue;
          if (++prefixCount > MAX_PREFIX_TERMS) break;

          const pfxPostings = this.index.get(indexedTerm)!;
          for (const posting of pfxPostings) {
            if (options?.doc_id && posting.doc_id !== options.doc_id) continue;
            if (filterWhitelist && !filterWhitelist.has(posting.doc_id))
              continue;

            const nodeKey = `${posting.doc_id}::${posting.node_id}`;
            const stats = this.nodeStats.get(nodeKey);
            if (!stats) continue;

            // Prefix postings contribute their raw BM25 score to the prefix
            // signal — the prefix-vs-exact tradeoff lives in the per-signal
            // RRF weight (`effective.bm25_prefix`), not in a per-posting
            // discount as it did pre-RRF.
            const bm25Score = this.computeBM25(indexedTerm, posting, stats.total_tokens);
            const entry = ensure(prefixSignal, nodeKey, posting.doc_id, posting.node_id);
            entry.score += bm25Score;
            entry.terms.add(term); // record the user-typed query term, not the matched index term
            appendPositions(entry.positions, posting.positions);
          }
        }
      }

      // Signal 3: subtoken matching — code nodes only, populated at index time.
      // Subtoken contributions DO NOT count toward exactTerms (so
      // full_coverage_bonus can't be spoofed by a single multi-part
      // identifier). Subtoken postings have empty positions by construction.
      if (effective.subtoken > 0) {
        const subPostings = this.subtokenIndex.get(term);
        if (subPostings) {
          for (const posting of subPostings) {
            if (options?.doc_id && posting.doc_id !== options.doc_id) continue;
            if (filterWhitelist && !filterWhitelist.has(posting.doc_id)) continue;

            const nodeKey = `${posting.doc_id}::${posting.node_id}`;
            const stats = this.nodeStats.get(nodeKey);
            if (!stats) continue;

            const bm25Score = this.computeBM25Subtoken(term, posting, stats.total_tokens);
            const entry = ensure(subtokenSignal, nodeKey, posting.doc_id, posting.node_id);
            entry.score += bm25Score;
            entry.terms.add(term);
          }
        }
      }
    }

    // Phase 2 + 3: RRF fusion. Each signal's nodes are sorted by their
    // signal-internal score, assigned a rank, and contribute
    // `effective[signal] / (rrf_k + rank)` to the unified `nodeScores`.
    const nodeScores: Map<
      string,
      {
        score: number;
        matchedTerms: Set<string>;
        exactTerms: Set<string>;
        positions: number[];
        doc_id: string;
        node_id: string;
      }
    > = new Map();

    const ensureFused = (
      key: string,
      doc_id: string,
      node_id: string
    ): {
      score: number;
      matchedTerms: Set<string>;
      exactTerms: Set<string>;
      positions: number[];
      doc_id: string;
      node_id: string;
    } => {
      let e = nodeScores.get(key);
      if (!e) {
        e = {
          score: 0,
          matchedTerms: new Set(),
          exactTerms: new Set(),
          positions: [],
          doc_id,
          node_id,
        };
        nodeScores.set(key, e);
      }
      return e;
    };

    const fuseSignal = (
      signal: Map<string, SignalEntry>,
      weight: number,
      contributesToExact: boolean,
      carriesPositions: boolean
    ): void => {
      if (weight <= 0 || signal.size === 0) return;
      const entries = Array.from(signal.entries());
      // Sort by signal-internal score desc; stable on key for determinism.
      entries.sort((a, b) => {
        if (b[1].score !== a[1].score) return b[1].score - a[1].score;
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      });
      // Tied scores share a rank ("competition ranking", a.k.a. "1224"
      // ranking) so two nodes with identical signal-internal scores
      // produce identical RRF contributions. Without this, content-equal
      // docs land at consecutive ranks (1, 2) and end up with measurably
      // different fused scores — a behavior that breaks the
      // "identical input → identical output" property the additive
      // scorer used to provide.
      let prevScore = Number.POSITIVE_INFINITY;
      let currentRank = 0;
      for (let i = 0; i < entries.length; i++) {
        const [key, sigEntry] = entries[i];
        if (sigEntry.score !== prevScore) {
          currentRank = i + 1;
          prevScore = sigEntry.score;
        }
        const contribution = weight / (rrfK + currentRank);
        const fused = ensureFused(key, sigEntry.doc_id, sigEntry.node_id);
        fused.score += contribution;
        for (const t of sigEntry.terms) {
          fused.matchedTerms.add(t);
          if (contributesToExact) fused.exactTerms.add(t);
        }
        if (carriesPositions && sigEntry.positions.length > 0) {
          appendPositions(fused.positions, sigEntry.positions);
        }
      }
    };

    fuseSignal(exactSignal, effective.bm25_exact, true, true);
    fuseSignal(prefixSignal, effective.bm25_prefix, true, true);
    fuseSignal(subtokenSignal, effective.subtoken, false, false);

    // Apply co-occurrence bonuses
    for (const [nodeKey, entry] of nodeScores) {
      const matchCount = entry.matchedTerms.size;

      if (matchCount > 1) {
        entry.score += (matchCount - 1) * this.ranking.term_proximity_bonus;
      }

      // full_coverage uses exactTerms (precision) — subtoken matches are
      // excluded so a single multi-part identifier can't spoof full coverage
      // for a multi-term query.
      if (
        entry.exactTerms.size === uniqueTerms.length &&
        uniqueTerms.length > 1
      ) {
        entry.score += this.ranking.full_coverage_bonus;
      }

      // Apply definition boost: when a query term exactly matches a code
      // node's symbol_name AND symbol_kind is a definition-kind, multiply
      // once. Lifts canonical definitions above call-sites and references.
      const doc = this.docs.get(entry.doc_id);
      if (doc) {
        const node = doc.tree.find((n) => n.node_id === entry.node_id);
        if (node && isDefinitionMatch(node, queryTerms, this.glossary)) {
          entry.score *= effectiveDefinitionBoost;
        }

        // Apply noise penalty: down-rank tests / .d.ts / legacy paths in code
        // collections. Lowest matching penalty wins; penalties do NOT compound.
        const collectionPatterns = this.noisePatterns.get(doc.meta.collection);
        if (collectionPatterns && collectionPatterns.length > 0) {
          let lowestPenalty = 1.0;
          for (const { regex, penalty } of collectionPatterns) {
            if (regex.test(doc.meta.file_path) && penalty < lowestPenalty) {
              lowestPenalty = penalty;
            }
          }
          if (lowestPenalty < 1.0) entry.score *= lowestPenalty;
        }

        // Apply collection weight (Pagefind indexWeight equivalent)
        const colWeight =
          this.collectionWeights.get(doc.meta.collection) ?? 1.0;
        entry.score *= colWeight;

        // Apply window-density bonus for long nodes. Rewards focused match
        // clusters in long bodies (e.g. a 200-line function with 5 matches in
        // 30 tokens beats one with 5 matches scattered across 200 tokens).
        // Short nodes get tf-idf concentration for free, so skip them.
        if (this.ranking.window_density_bonus > 0) {
          const stats = this.nodeStats.get(nodeKey);
          if (stats && stats.total_tokens > 2 * this.avgNodeLength) {
            const density = bestWindowDensity(entry.positions, WINDOW_DENSITY_SIZE);
            entry.score += this.ranking.window_density_bonus * density;
          }
        }
      }
    }

    // ── File-level coherence pass ──────────────────────────────────
    // After all per-node multipliers are applied, group by doc_id and lift
    // multi-hit files. Two distinct lifts:
    //  (1) file boost: every matching node's score is multiplied by
    //      `1 + cohBonus * min(matchCount - 1, MAX_COUNT_LIFT)`. Bounded so
    //      docs with many incidental matches don't dominate docs with one
    //      strong hit. Multiplicative (not additive) so already-strong matches
    //      gain more in absolute terms — encodes that the file is more
    //      relevant, but doesn't flatten the within-group ordering.
    //  (2) lead bonus: the node with smallest line_start (shallowest level
    //      on tie) gets an additional additive lift `leadBonus * max(group)`.
    //      Surfaces the file's natural entry point as the leading result.
    const cohBonus = this.ranking.file_coherence_bonus;
    const leadBonus = this.ranking.file_lead_bonus;
    const MAX_COUNT_LIFT = 5;
    if (cohBonus > 0 || leadBonus > 0) {
      const groupsByDoc: Map<string, Array<{ key: string; score: number; node_id: string }>> = new Map();
      for (const [key, entry] of nodeScores) {
        if (!groupsByDoc.has(entry.doc_id)) groupsByDoc.set(entry.doc_id, []);
        groupsByDoc.get(entry.doc_id)!.push({ key, score: entry.score, node_id: entry.node_id });
      }

      for (const [doc_id, group] of groupsByDoc) {
        if (group.length < 2) continue; // single-hit files unaffected
        const doc = this.docs.get(doc_id);
        if (!doc) continue;

        const matchCount = group.length;
        const max = group.reduce((m, g) => (g.score > m ? g.score : m), 0);

        // (1) file boost — multiplicative, bounded
        if (cohBonus > 0) {
          const lift = 1 + cohBonus * Math.min(matchCount - 1, MAX_COUNT_LIFT);
          for (const g of group) {
            nodeScores.get(g.key)!.score *= lift;
          }
        }

        // (2) lead bonus: smallest line_start, tie-break by shallowest level.
        // Computed against pre-coherence-lift max so lead and file boost don't
        // double-amplify each other in unstable ways.
        if (leadBonus > 0) {
          let leadKey = group[0].key;
          let leadStart = Infinity;
          let leadLevel = Infinity;
          for (const g of group) {
            const node = doc.tree.find((n) => n.node_id === g.node_id);
            if (!node) continue;
            if (
              node.line_start < leadStart ||
              (node.line_start === leadStart && node.level < leadLevel)
            ) {
              leadStart = node.line_start;
              leadLevel = node.level;
              leadKey = g.key;
            }
          }
          nodeScores.get(leadKey)!.score += leadBonus * max;
        }
      }
    }

    // Sort by score and only convert top N to full SearchResult objects
    const limit = options?.limit || 20;
    const scored = Array.from(nodeScores.values());
    scored.sort((a, b) => b.score - a.score);
    const topN = scored.slice(0, limit);
    nodeScores.clear();

    // Convert to SearchResult objects
    const results: SearchResult[] = [];

    for (const entry of topN) {
      const doc = this.docs.get(entry.doc_id);
      if (!doc) continue;

      const node = doc.tree.find((n) => n.node_id === entry.node_id);
      if (!node) continue;

      // Density-based snippet (Pagefind excerpt algorithm)
      const snippet = buildDensitySnippet(
        node.content,
        entry.positions,
        node.title,
        180
      );

      results.push({
        doc_id: entry.doc_id,
        doc_title: doc.meta.title,
        file_path: doc.meta.file_path,
        node_id: entry.node_id,
        node_title: node.title,
        level: node.level,
        snippet,
        score: entry.score,
        match_positions: entry.positions.sort((a, b) => a - b),
        matched_terms: [...entry.matchedTerms],
        collection: doc.meta.collection,
        facets: doc.meta.facets,
      });
    }

    return results;
  }

  // ── Catalog with facet counts (Pagefind filter UI equivalent) ───

  listDocuments(options?: {
    tag?: string;
    query?: string;
    collection?: string;
    filters?: Record<string, string | string[]>;
    limit?: number;
    offset?: number;
  }): { total: number; documents: DocumentMeta[]; facet_counts: FacetCounts } {
    let docs = Array.from(this.docs.values()).map((d) => d.meta);

    // Apply filters
    if (options?.tag) {
      const tag = options.tag.toLowerCase();
      docs = docs.filter((d) =>
        d.tags.some((t) => t.toLowerCase().includes(tag))
      );
    }

    if (options?.collection) {
      docs = docs.filter((d) => d.collection === options.collection);
    }

    if (options?.filters) {
      const whitelist = this.resolveFilters(options.filters);
      if (whitelist) {
        docs = docs.filter((d) => whitelist.has(d.doc_id));
      }
    }

    if (options?.query) {
      const q = options.query.toLowerCase();
      docs = docs.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          d.file_path.toLowerCase().includes(q)
      );
    }

    // Build facet counts from the filtered set
    // (Pagefind updates available filters based on current result set)
    const facet_counts: FacetCounts = {};
    for (const doc of docs) {
      for (const [key, values] of Object.entries(doc.facets)) {
        if (!facet_counts[key]) facet_counts[key] = {};
        for (const val of values) {
          facet_counts[key][val] = (facet_counts[key][val] || 0) + 1;
        }
      }
      // Include tags in facet counts
      for (const tag of doc.tags) {
        if (!facet_counts["tags"]) facet_counts["tags"] = {};
        facet_counts["tags"][tag] = (facet_counts["tags"][tag] || 0) + 1;
      }
      // Include collection
      if (!facet_counts["collection"]) facet_counts["collection"] = {};
      facet_counts["collection"][doc.collection] =
        (facet_counts["collection"][doc.collection] || 0) + 1;
    }

    docs.sort((a, b) => a.title.localeCompare(b.title));

    const total = docs.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || 50;

    return {
      total,
      documents: docs.slice(offset, offset + limit),
      facet_counts,
    };
  }

  // ── Tree operations (PageIndex-inspired tools) ──────────────────

  getTree(doc_id: string): TreeOutline | null {
    const doc = this.docs.get(doc_id);
    if (!doc) return null;

    return {
      doc_id: doc.meta.doc_id,
      title: doc.meta.title,
      nodes: doc.tree.map((n) => ({
        node_id: n.node_id,
        title: n.title,
        level: n.level,
        children: n.children,
        word_count: n.word_count,
        summary: n.summary,
      })),
    };
  }

  getNodeContent(
    doc_id: string,
    node_ids: string[]
  ): { doc_id: string; nodes: TreeNode[] } | null {
    const doc = this.docs.get(doc_id);
    if (!doc) return null;

    const nodes = node_ids
      .map((id) => doc.tree.find((n) => n.node_id === id))
      .filter(Boolean) as TreeNode[];

    return { doc_id, nodes };
  }

  getSubtree(
    doc_id: string,
    node_id: string
  ): { doc_id: string; nodes: TreeNode[] } | null {
    const doc = this.docs.get(doc_id);
    if (!doc) return null;

    const rootNode = doc.tree.find((n) => n.node_id === node_id);
    if (!rootNode) return null;

    const result: TreeNode[] = [rootNode];
    const queue = [...rootNode.children];

    while (queue.length > 0) {
      const childId = queue.shift()!;
      const child = doc.tree.find((n) => n.node_id === childId);
      if (child) {
        result.push(child);
        queue.push(...child.children);
      }
    }

    return { doc_id, nodes: result };
  }

  // ── Auto-glossary extraction ────────────────────────────────────

  private buildAutoGlossary(documents: IndexedDocument[]): void {
    const autoEntries: Record<string, string[]> = {};

    for (const doc of documents) {
      for (const node of doc.tree) {
        const nodeEntries = extractGlossaryEntries(node.content);
        for (const [acronym, expansions] of Object.entries(nodeEntries)) {
          if (!autoEntries[acronym]) autoEntries[acronym] = [];
          for (const exp of expansions) {
            if (!autoEntries[acronym].includes(exp)) {
              autoEntries[acronym].push(exp);
            }
          }
        }
      }
      const metaEntries = extractGlossaryEntries(
        `${doc.meta.title} ${doc.meta.description}`
      );
      for (const [acronym, expansions] of Object.entries(metaEntries)) {
        if (!autoEntries[acronym]) autoEntries[acronym] = [];
        for (const exp of expansions) {
          if (!autoEntries[acronym].includes(exp)) {
            autoEntries[acronym].push(exp);
          }
        }
      }
    }

    // Merge auto-entries into the glossary without overwriting explicit entries.
    // Bidirectional: also add reverse mappings (expansion → acronym) so that
    // searching for the long form also matches docs that use the short form.
    let added = 0;
    for (const [key, expansions] of Object.entries(autoEntries)) {
      const normalizedKey = key.toLowerCase();
      for (const expansion of expansions) {
        // Forward: acronym → expansion
        if (!this.glossary.has(normalizedKey)) {
          this.glossary.set(normalizedKey, [expansion]);
          added++;
        } else {
          const existing = this.glossary.get(normalizedKey)!;
          if (!existing.includes(expansion)) {
            existing.push(expansion);
            added++;
          }
        }
        // Reverse: expansion terms → acronym
        const expTokens = expansion.toLowerCase();
        if (!this.glossary.has(expTokens)) {
          this.glossary.set(expTokens, [normalizedKey]);
        } else {
          const existing = this.glossary.get(expTokens)!;
          if (!existing.includes(normalizedKey)) {
            existing.push(normalizedKey);
          }
        }
      }
    }

    if (added > 0) {
      console.log(`Auto-glossary: extracted ${added} entries from content`);
    }
  }

  // ── Row index for structured data ──────────────────────────────────

  private buildRowIndex(): void {
    this.rowIndex.clear();
    for (const doc of this.docs.values()) {
      const format = doc.meta.facets?.format;
      if (!format || (!format.includes("csv") && !format.includes("jsonl"))) continue;

      for (const node of doc.tree) {
        if (node.level < 2) continue;
        // Extract key: everything before " — " in the title
        const dashIdx = node.title.indexOf(" — ");
        const key = (dashIdx !== -1 ? node.title.slice(0, dashIdx) : node.title).trim().toUpperCase();
        if (key && !this.rowIndex.has(key)) {
          this.rowIndex.set(key, { doc_id: doc.meta.doc_id, node_id: node.node_id });
        }
      }
    }
    if (this.rowIndex.size > 0) {
      console.log(`Row index: ${this.rowIndex.size} keys from structured data`);
    }
  }

  lookupRow(key: string, docId?: string): { doc_id: string; node: TreeNode; facets: Record<string, string[]> } | null {
    const normalizedKey = key.trim().toUpperCase();
    const entry = this.rowIndex.get(normalizedKey);
    if (!entry) return null;
    if (docId && entry.doc_id !== docId) return null;

    const doc = this.docs.get(entry.doc_id);
    if (!doc) return null;

    const node = doc.tree.find(n => n.node_id === entry.node_id);
    if (!node) return null;

    return { doc_id: entry.doc_id, node, facets: doc.meta.facets };
  }

  // ── Literal / regex scan over indexed content ─────────────────────
  //
  // Complement to searchDocuments (BM25). Use when the agent has an
  // exact string, symbol, or regex to locate and doesn't want stemming
  // or glossary expansion interfering.
  //
  // ReDoS guard: the scan honors a wall-clock budget and a per-line
  // match cap. A malicious or pathological pattern cannot hang the
  // server — it simply returns early with aborted=true.

  grepDocuments(opts: GrepOptions): GrepOutcome {
    const timeBudget = opts.time_budget_ms ?? 500;
    const limit = opts.limit ?? 50;
    const context = Math.max(0, Math.min(5, opts.context ?? 1));
    const deadline = Date.now() + timeBudget;

    const re = compileGrepRegex(opts);
    const globMatcher = opts.path_glob ? new Bun.Glob(opts.path_glob) : null;
    const filterWhitelist = opts.filters && Object.keys(opts.filters).length > 0
      ? this.resolveFilters(opts.filters)
      : null;

    const hits: GrepHit[] = [];
    let docsScanned = 0;
    let nodesScanned = 0;
    let aborted = false;
    let truncated = false;
    const CLOCK_CHECK_EVERY = 256; // amortize Date.now() calls
    let linesSinceCheck = 0;

    outer: for (const doc of this.docs.values()) {
      if (opts.doc_id && doc.meta.doc_id !== opts.doc_id) continue;
      if (filterWhitelist && !filterWhitelist.has(doc.meta.doc_id)) continue;
      if (globMatcher && !globMatcher.match(doc.meta.file_path)) continue;
      docsScanned++;

      for (const node of doc.tree) {
        nodesScanned++;
        if (!node.content) continue;
        const lines = node.content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (++linesSinceCheck >= CLOCK_CHECK_EVERY) {
            linesSinceCheck = 0;
            if (Date.now() > deadline) {
              aborted = true;
              break outer;
            }
          }

          if (!re.test(lines[i])) continue;

          hits.push({
            doc_id: doc.meta.doc_id,
            file_path: doc.meta.file_path,
            node_id: node.node_id,
            node_title: node.title,
            // node.line_start is the heading line; content begins on the next
            line_no: node.line_start + 1 + i,
            line: lines[i],
            context_before: lines.slice(Math.max(0, i - context), i),
            context_after: lines.slice(i + 1, i + 1 + context),
          });

          if (hits.length >= limit) {
            truncated = true;
            break outer;
          }
        }
      }
    }

    return { hits, truncated, aborted, docs_scanned: docsScanned, nodes_scanned: nodesScanned };
  }

  // ── Reference map ─────────────────────────────────────────────────

  private buildRefMap(): void {
    this.refMap.clear();
    for (const doc of this.docs.values()) {
      const basename =
        doc.meta.file_path.split("/").pop() ?? doc.meta.file_path;
      this.refMap.set(basename, { doc_id: doc.meta.doc_id, tree: doc.tree });
    }
  }

  // ── Public reference / meta methods ───────────────────────────────

  resolveRef(path: string): { doc_id: string; node_id?: string } | null {
    const [filePart, fragment] = path.split("#");
    const basename = filePart.split("/").pop() ?? filePart;
    const entry = this.refMap.get(basename);
    if (!entry) return null;

    if (!fragment) return { doc_id: entry.doc_id };

    const slug = fragment
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const node = entry.tree.find((n) => {
      const nodeSlug = n.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      return nodeSlug === slug || n.node_id === fragment;
    });

    return { doc_id: entry.doc_id, node_id: node?.node_id };
  }

  getDocMeta(doc_id: string): DocumentMeta | null {
    return this.docs.get(doc_id)?.meta ?? null;
  }

  /**
   * Partition the loaded collections by source kind for compile_context.
   * A collection is "code" when its documents carry the content_type=code
   * facet (set by the code indexer); everything else is "docs". This keeps
   * source routing correct for custom CODE_COLLECTION names and for
   * multi-root DOCS_ROOTS setups.
   */
  getSourceCollections(): { docs: string[]; code: string[] } {
    const code = new Set<string>();
    const all = new Set<string>();
    for (const doc of this.docs.values()) {
      all.add(doc.meta.collection);
      if (doc.meta.facets["content_type"]?.includes("code")) {
        code.add(doc.meta.collection);
      }
    }
    return {
      docs: [...all].filter((c) => !code.has(c)),
      code: [...code],
    };
  }

  getGlossaryTerms(): string[] {
    return [...this.glossary.keys()];
  }

  // ── Stats ───────────────────────────────────────────────────────

  getStats(): {
    document_count: number;
    total_nodes: number;
    total_words: number;
    indexed_terms: number;
    avg_node_length: number;
    facet_keys: string[];
    collections: string[];
  } {
    let total_words = 0;
    for (const doc of this.docs.values()) {
      total_words += doc.meta.word_count;
    }

    return {
      document_count: this.docs.size,
      total_nodes: this.totalNodes,
      total_words,
      indexed_terms: this.index.size,
      avg_node_length: Math.round(this.avgNodeLength),
      facet_keys: [...this.filters.keys()],
      collections: [...(this.filters.get("collection")?.keys() ?? [])],
    };
  }

  /**
   * Get available facets with value counts.
   * Equivalent to Pagefind's filter UI showing available filter options.
   */
  getFacets(): FacetCounts {
    const counts: FacetCounts = {};
    for (const [key, valueMap] of this.filters) {
      counts[key] = {};
      for (const [val, docSet] of valueMap) {
        counts[key][val] = docSet.size;
      }
    }
    return counts;
  }

  hasDocument(doc_id: string): boolean {
    return this.docs.has(doc_id);
  }
}

// ── Grep regex compilation ──────────────────────────────────────────
//
// Wraps RegExp construction so the caller gets a clear error for invalid
// patterns and so we can apply cheap static guards before running the
// regex against the corpus.

// Cheap static guards against the most common catastrophic-backtracking shapes.
// Not exhaustive (static ReDoS detection is undecidable in general), but blocks
// the patterns most likely to hang the scan: lookarounds and a group that
// contains a quantifier and is itself quantified, e.g. (a+)+ or (a*b)+.
const DANGEROUS_PATTERN =
  /(\(\?[=!])|(\(\?<[=!])|(\([^)]*[*+?}][^)]*\)\s*[*+{?])/;

function compileGrepRegex(opts: GrepOptions): RegExp {
  const src = opts.regex ? opts.pattern : escapeRegex(opts.pattern);
  if (opts.regex && DANGEROUS_PATTERN.test(opts.pattern)) {
    throw new Error(
      "Pattern contains constructs that can cause catastrophic backtracking (nested quantifiers or lookarounds). Use a simpler regex, or pass regex=false for literal matching."
    );
  }
  try {
    return new RegExp(src, opts.case_insensitive ? "i" : "");
  } catch (err: any) {
    throw new Error(`Invalid regex: ${err.message}`);
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Window-density helper for long-node ranking signal ─────────────
//
// Sliding-window scan over sorted match positions. Returns the highest
// density (matches-per-window-token) seen, where a window is a contiguous
// span of `windowSize` token positions. A focused cluster of 5 matches in
// a 30-token window scores 5/30 = 0.167; the same 5 matches scattered over
// 200 tokens score 1/30 = 0.033.

const WINDOW_DENSITY_SIZE = 30;

function bestWindowDensity(positions: number[], windowSize: number): number {
  if (positions.length === 0 || windowSize <= 0) return 0;
  const sorted = [...positions].sort((a, b) => a - b);
  let bestCount = 1;
  let left = 0;
  for (let right = 0; right < sorted.length; right++) {
    while (sorted[right] - sorted[left] >= windowSize) left++;
    const count = right - left + 1;
    if (count > bestCount) bestCount = count;
  }
  return bestCount / windowSize;
}

// ── Query-shape detection (Semble-inspired adaptive weighting) ──────
//
// Returns true if the raw query string looks like an identifier rather
// than natural-language prose. Triggered by:
//   - camelCase transition: a lowercase-then-uppercase sequence
//     (`parseConfig`, `getUserById`)
//   - snake_case / kebab-case: contains `_` or `-`
//   - all-caps run ≥2 chars (`URL`, `BM25`, `URLParser`)
// Plain words and PascalCase single words ("Hello") are NOT shape-detected.
function isSymbolShapedQuery(query: string): boolean {
  return /[a-z][A-Z]/.test(query) || /_/.test(query) || /[A-Z]{2,}/.test(query);
}

// ── Subtoken extraction (Semble-inspired identifier-stem matching) ──
//
// Operates on raw (un-lowercased) text so camelCase splits remain visible.
// Three layers of splitting:
//   1. Word boundary: `[A-Za-z0-9_-]+` runs are extracted as candidates.
//   2. Snake/kebab-case: each candidate split on `_` and `-`.
//   3. CamelCase / digit-runs: `/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|[0-9]+/g`
//      catches `parseFrontmatter` → [parse, Frontmatter] and
//      `URLParser` → [URL, Parser].
// Returns lowercased subtokens, or [] if the identifier has fewer than 2
// distinct subtokens (i.e. it's a plain single word).

const IDENTIFIER_REGEX = /[A-Za-z0-9_-]{2,}/g;
const CAMEL_OR_DIGIT_REGEX = /[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|[0-9]+/g;

function extractIdentifiers(text: string): string[] {
  return text.match(IDENTIFIER_REGEX) ?? [];
}

function identifierSubtokens(identifier: string): string[] {
  const subs: string[] = [];
  for (const piece of identifier.split(/[_-]/)) {
    if (!piece) continue;
    const matches = piece.match(CAMEL_OR_DIGIT_REGEX);
    if (matches) subs.push(...matches);
  }
  // Need at least 2 subtokens to qualify (otherwise it's the same as the
  // already-indexed exact token — would be double-counted).
  if (subs.length < 2) return [];
  const lowered = subs.map((s) => s.toLowerCase());
  // Filter: drop subtokens identical to the full identifier (defensive —
  // shouldn't happen given the < 2 check above, but covers edge cases like
  // numeric-only identifiers).
  const idLower = identifier.toLowerCase();
  return lowered.filter((s) => s.length >= 2 && s !== idLower);
}

// ── Definition-kind check for definition_boost ──────────────────────
//
// A node qualifies for definition_boost when:
//   1. its symbol_kind is one of the definition-kinds (excludes "import")
//   2. its symbol_name (after lowercasing) matches one of the raw query terms
//      OR one of the stemmed query terms OR one of the tokenized expansions
//      from the glossary.
//
// We deliberately compare against the *raw* query terms (pre-stem), the
// stemmed terms, and the lowercased symbol_name pre-stem. This covers
// camelCase symbol names that don't survive stemming intact.

const DEFINITION_KINDS = new Set([
  "class",
  "function",
  "interface",
  "method",
  "type",
  "enum",
  "struct",
  "trait",
  "enum_variant",
]);

function isDefinitionMatch(
  node: TreeNode,
  rawQueryTerms: string[],
  glossary: Map<string, string[]>,
): boolean {
  if (!node.symbol_kind || !node.symbol_name) return false;
  if (!DEFINITION_KINDS.has(node.symbol_kind)) return false;

  const name = node.symbol_name.toLowerCase();
  const stemmedName = stem(name);

  for (const term of rawQueryTerms) {
    const lc = term.toLowerCase();
    if (lc === name || stem(lc) === stemmedName) return true;

    // Check glossary expansions for this term too — if the user typed an
    // abbreviation that expands to the symbol name, treat it as a match.
    const expansions = glossary.get(lc);
    if (expansions) {
      for (const exp of expansions) {
        if (exp === name || stem(exp) === stemmedName) return true;
      }
    }
  }
  return false;
}

// ── Tokenization ─────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\.\/]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function extractCodeTokens(content: string): Set<string> {
  const codeTokens = new Set<string>();
  const codeBlockRegex = /\[code:\w*\]\s*([\s\S]*?)(?=\[code:|\n\n|$)/g;
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const tokens = tokenize(match[1]);
    for (const t of tokens) codeTokens.add(t);
  }
  return codeTokens;
}

// ── Stemming ─────────────────────────────────────────────────────────
//
// Lightweight Porter-style suffix stripping. Pagefind does stemming at
// index time (in Rust) and then stems the query to match. We do the same.

function stem(word: string): string {
  if (word.length < 4) return word;
  return word
    .replace(/ies$/, "y")
    .replace(/ied$/, "y")
    .replace(/(s|es)$/, "")
    .replace(/ing$/, (_, offset) => (word.length - offset > 4 ? "" : "ing"))
    .replace(/tion$/, "t")
    .replace(/ment$/, "")
    .replace(/ness$/, "")
    .replace(/able$/, "")
    .replace(/ible$/, "")
    .replace(/ally$/, "")
    .replace(/ful$/, "")
    .replace(/ous$/, "")
    .replace(/ive$/, "")
    .replace(/ly$/, "");
}

// ── Density-based snippet extraction ─────────────────────────────────
//
// Inspired by Pagefind's excerpt generation: find the region with the
// highest density of matching terms and extract a snippet centered there.

function buildDensitySnippet(
  content: string,
  matchPositions: number[],
  nodeTitle: string,
  maxLen: number
): string {
  if (!content || matchPositions.length === 0) {
    const text = content || nodeTitle;
    return text.slice(0, maxLen) + (text.length > maxLen ? "…" : "");
  }

  const words = content.split(/\s+/);
  if (words.length === 0) return content.slice(0, maxLen);

  const validPositions = matchPositions
    .filter((p) => p >= 0 && p < words.length)
    .sort((a, b) => a - b);

  if (validPositions.length === 0) {
    return content.slice(0, maxLen) + (content.length > maxLen ? "…" : "");
  }

  // Sliding window for highest match density
  const windowWords = Math.max(10, Math.floor(maxLen / 6));
  let bestStart = 0;
  let bestCount = 0;

  for (
    let start = 0;
    start <= Math.max(0, words.length - windowWords);
    start++
  ) {
    const end = start + windowWords;
    const count = validPositions.filter((p) => p >= start && p < end).length;
    if (count > bestCount) {
      bestCount = count;
      bestStart = start;
    }
  }

  const snippetWords = words.slice(bestStart, bestStart + windowWords);
  let snippet = snippetWords.join(" ");

  if (snippet.length > maxLen) {
    snippet = snippet.slice(0, maxLen);
    const lastSpace = snippet.lastIndexOf(" ");
    if (lastSpace > maxLen * 0.7) snippet = snippet.slice(0, lastSpace);
  }

  if (bestStart > 0) snippet = "…" + snippet;
  if (bestStart + windowWords < words.length) snippet = snippet + "…";

  return snippet;
}
