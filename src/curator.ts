/**
 * Wiki Curation — write-side companion to the read-only index.
 *
 * Implements the MVP toolset defined in docs/wiki-curation-spec.md:
 *
 *   1. findSimilar     — BM25 dedupe check for prospective content
 *   2. draftWikiEntry  — structural scaffold (no write)
 *   3. writeWikiEntry  — validated write + incremental re-index
 *
 * Guiding principle: treenav is the library infrastructure; the calling
 * agent is the librarian. This module performs ZERO LLM calls — every
 * output is a deterministic function of the current index state. The
 * calling agent uses its own LLM to actually author the markdown body.
 *
 * See docs/adr/0001-llm-curated-wiki.md for the decision record.
 */

import { mkdir, stat as fsStat } from "node:fs/promises";
import { dirname, normalize, resolve, sep } from "node:path";
import { DocumentStore } from "./store";
import { indexFile, inferTypeFromPath } from "./indexer";

// ── Options & types ─────────────────────────────────────────────────

/**
 * Runtime configuration for the curation toolset.
 * Constructed once at server startup from WIKI_WRITE / WIKI_ROOT /
 * WIKI_DUPLICATE_THRESHOLD environment variables.
 */
export interface WikiOptions {
  /** Absolute filesystem path of the wiki root (writes are confined here) */
  root: string;
  /** Collection name used when re-indexing new entries. Defaults to "docs". */
  collectionName?: string;
  /**
   * Overlap ratio above which writes emit a duplicate warning and require
   * `allow_duplicate=true` to proceed. Range 0..1. Default 0.35.
   */
  duplicateThreshold?: number;
}

/** Similarity match as reported by find_similar. */
export interface SimilarityMatch {
  node_id: string;
  doc_id: string;
  path: string;
  title: string;
  score: number;
  /** Fraction of unique query terms found in this node. Range 0..1. */
  overlap: number;
  snippet: string;
}

export interface FindSimilarResult {
  matches: SimilarityMatch[];
  tokens_analyzed: number;
  /** True when any match's overlap exceeds the configured duplicate threshold. */
  suggest_merge: boolean;
}

export interface WikiBacklink {
  node_id: string;
  doc_id: string;
  title: string;
  score: number;
  reason: "bm25" | "shared_tag" | "shared_category";
}

export interface WikiDraft {
  suggested_path: string;
  frontmatter: {
    title: string;
    description?: string;
    type?: string;
    category?: string;
    tags: string[];
    source_url?: string;
    captured_at: string;
  };
  backlinks: WikiBacklink[];
  glossary_hits: string[];
  duplicate_warning?: {
    doc_id: string;
    overlap: number;
  };
}

export interface WriteWikiInput {
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
  dry_run?: boolean;
  allow_duplicate?: boolean;
  overwrite?: boolean;
}

export interface WriteWikiResult {
  written: boolean;
  path: string;
  absolute_path: string;
  doc_id?: string;
  root_node_id?: string;
  bytes: number;
  reindex_ms: number;
  duplicate_warning?: {
    doc_id: string;
    overlap: number;
  };
  validation: {
    frontmatter_ok: boolean;
    reserved_keys_ok: boolean;
    path_ok: boolean;
  };
}

export class CuratorError extends Error {
  constructor(
    public readonly code:
      | "PATH_ESCAPE"
      | "PATH_INVALID"
      | "EXISTS"
      | "FRONTMATTER_INVALID"
      | "DUPLICATE"
      | "WRITE_FAILED",
    message: string
  ) {
    super(message);
    this.name = "CuratorError";
  }
}

// ── Constants ───────────────────────────────────────────────────────

/**
 * Reserved frontmatter keys specific to curated entries. Not used as
 * search facets. Joins the existing reserved set (title, description,
 * layout, permalink, slug, draft, date) from indexer.ts.
 */
export const WIKI_RESERVED_FRONTMATTER_KEYS = [
  "source_url",
  "source_title",
  "captured_at",
  "curator",
] as const;

const DEFAULT_DUPLICATE_THRESHOLD = 0.35;
const DEFAULT_COLLECTION_NAME = "docs";
const DRAFT_BACKLINK_LIMIT = 5;

// ── 1. findSimilar ──────────────────────────────────────────────────

/**
 * Run arbitrary text through the existing BM25 engine and report the
 * top-N overlapping nodes. Used as a dedupe check before drafting or
 * writing a new entry.
 */
export function findSimilar(
  store: DocumentStore,
  content: string,
  options?: {
    limit?: number;
    threshold?: number;
    collection?: string;
    duplicateThreshold?: number;
  }
): FindSimilarResult {
  const limit = options?.limit ?? 5;
  const minScore = options?.threshold ?? 0.1;
  const dupThreshold = options?.duplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD;

  const tokens = tokenizeForQuery(content);
  if (tokens.length === 0) {
    return { matches: [], tokens_analyzed: 0, suggest_merge: false };
  }

  // Cap query length for performance: BM25 lookup is linear per term and
  // raw article text can be many thousands of tokens. A few hundred
  // distinctive tokens is plenty for dedupe signal.
  const uniqueTokens = [...new Set(tokens)].slice(0, 200);
  const query = uniqueTokens.join(" ");

  const results = store.searchDocuments(query, {
    limit: Math.max(limit * 3, 15),
    collection: options?.collection,
  });

  let suggest_merge = false;
  const matches: SimilarityMatch[] = results
    .map((r) => {
      // Overlap = fraction of distinctive query terms the node matched.
      // This is an approximate Jaccard lower bound — it ignores the
      // node's own vocabulary size but is robust to document length
      // and maps cleanly to a human notion of "coverage".
      const overlap = Math.min(1, r.matched_terms.length / uniqueTokens.length);
      if (overlap >= dupThreshold) suggest_merge = true;
      return {
        node_id: r.node_id,
        doc_id: r.doc_id,
        path: r.file_path,
        title: r.node_title,
        score: r.score,
        overlap,
        snippet: r.snippet,
      };
    })
    .filter((m) => m.score >= minScore)
    .slice(0, limit);

  return {
    matches,
    tokens_analyzed: uniqueTokens.length,
    suggest_merge,
  };
}

// ── 2. draftWikiEntry ───────────────────────────────────────────────

/**
 * Produce a structural scaffold for a new entry. Does NOT write
 * anything. The calling agent fills in the body using its own LLM,
 * then calls writeWikiEntry.
 */
export function draftWikiEntry(
  store: DocumentStore,
  wiki: WikiOptions,
  input: {
    topic: string;
    raw_content: string;
    suggested_path?: string;
    source_url?: string;
  }
): WikiDraft {
  const { topic, raw_content, suggested_path, source_url } = input;
  const collectionName = wiki.collectionName ?? DEFAULT_COLLECTION_NAME;

  // 1. Dedupe check
  const similar = findSimilar(store, raw_content, {
    limit: DRAFT_BACKLINK_LIMIT,
    duplicateThreshold: wiki.duplicateThreshold,
  });

  // 2. Resolve suggested path
  let relativePath: string;
  if (suggested_path) {
    // Validate without writing
    const validated = validateRelativePath(suggested_path, wiki.root);
    if (!validated.ok) {
      throw new CuratorError(
        "PATH_INVALID",
        `suggested_path invalid: ${validated.error}`
      );
    }
    relativePath = validated.relative;
  } else {
    // Synthesize from topic slug, placed under inferred type directory
    relativePath = synthesizePathFromTopic(topic);
  }

  // 3. Infer type/category/tags by aggregating facets of related docs
  const inferredType = inferTypeFromPath(relativePath) ?? undefined;
  const { category, tags } = aggregateFacetsFromMatches(store, similar.matches);

  // 4. Glossary hits — known abbreviations appearing in the raw content
  const glossaryTerms = store.getGlossaryTerms();
  const lowerContent = raw_content.toLowerCase();
  const glossary_hits = glossaryTerms.filter((term) => {
    if (term.length < 2) return false;
    // Word-boundary check for single-word terms; substring for phrases
    if (/\s/.test(term)) return lowerContent.includes(term);
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`);
    return re.test(lowerContent);
  });

  // 5. Build backlinks (deduped per doc_id so we don't link to 3 sections
  // of the same file)
  const seenDocs = new Set<string>();
  const backlinks: WikiBacklink[] = [];
  for (const m of similar.matches) {
    if (seenDocs.has(m.doc_id)) continue;
    seenDocs.add(m.doc_id);
    backlinks.push({
      node_id: m.node_id,
      doc_id: m.doc_id,
      title: m.title,
      score: m.score,
      reason: "bm25",
    });
  }

  // 6. Duplicate warning
  const topMatch = similar.matches[0];
  const dupThreshold = wiki.duplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD;
  const duplicate_warning =
    topMatch && topMatch.overlap >= dupThreshold
      ? { doc_id: topMatch.doc_id, overlap: topMatch.overlap }
      : undefined;

  // 7. Build the frontmatter scaffold
  const title = topicToTitle(topic);
  return {
    suggested_path: relativePath,
    frontmatter: {
      title,
      type: inferredType,
      category,
      tags,
      source_url,
      captured_at: new Date().toISOString(),
    },
    backlinks,
    glossary_hits,
    duplicate_warning,
  };
}

// ── 3. writeWikiEntry ───────────────────────────────────────────────

/**
 * Validate and write a curated entry to disk, then trigger incremental
 * re-index via indexFile + store.addDocument. Returns the new doc_id so
 * the agent can immediately call get_tree / get_node_content.
 *
 * Fail-fast validation order:
 *   1. Path containment  (PATH_ESCAPE / PATH_INVALID)
 *   2. Extension         (PATH_INVALID)
 *   3. Existence         (EXISTS unless overwrite=true)
 *   4. Frontmatter shape (FRONTMATTER_INVALID)
 *   5. Duplicate check   (DUPLICATE unless allow_duplicate=true)
 *   6. Dry-run shortcut  (returns without writing)
 *   7. Write + re-index
 */
export async function writeWikiEntry(
  store: DocumentStore,
  wiki: WikiOptions,
  input: WriteWikiInput
): Promise<WriteWikiResult> {
  const collectionName = wiki.collectionName ?? DEFAULT_COLLECTION_NAME;

  // 1 + 2. Path validation
  const validation = validateRelativePath(input.path, wiki.root);
  if (!validation.ok) {
    const code = validation.error.includes("escape") ? "PATH_ESCAPE" : "PATH_INVALID";
    throw new CuratorError(code, validation.error);
  }
  const { absolute, relative } = validation;

  // 3. Existence check
  const exists = await fileExists(absolute);
  if (exists && !input.overwrite) {
    throw new CuratorError(
      "EXISTS",
      `file already exists at ${relative}; pass overwrite=true to replace`
    );
  }

  // 4. Frontmatter validation
  const fmCheck = validateFrontmatter(input.frontmatter);
  if (!fmCheck.ok) {
    throw new CuratorError("FRONTMATTER_INVALID", fmCheck.error);
  }

  // 5. Duplicate check (skipped on overwrite, since overwriting the
  // same file will naturally show itself as a near-perfect match)
  let duplicate_warning: WriteWikiResult["duplicate_warning"];
  if (!input.overwrite) {
    const dup = findSimilar(store, input.content, {
      limit: 1,
      duplicateThreshold: wiki.duplicateThreshold,
    });
    const top = dup.matches[0];
    const threshold = wiki.duplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD;
    if (top && top.overlap >= threshold) {
      duplicate_warning = { doc_id: top.doc_id, overlap: top.overlap };
      if (!input.allow_duplicate) {
        throw new CuratorError(
          "DUPLICATE",
          `content overlaps ${(top.overlap * 100).toFixed(0)}% with ${top.doc_id}; pass allow_duplicate=true to override`
        );
      }
    }
  }

  const validationReport = {
    frontmatter_ok: true,
    reserved_keys_ok: true,
    path_ok: true,
  };

  // Serialize the file contents now so dry-run can report exact bytes
  const serialized = serializeMarkdown(input.frontmatter, input.content);
  const bytes = Buffer.byteLength(serialized, "utf8");

  // 6. Dry run short-circuit
  if (input.dry_run) {
    return {
      written: false,
      path: relative,
      absolute_path: absolute,
      bytes,
      reindex_ms: 0,
      duplicate_warning,
      validation: validationReport,
    };
  }

  // 7. Write + re-index
  try {
    await mkdir(dirname(absolute), { recursive: true });
    await Bun.write(absolute, serialized);
  } catch (err: any) {
    throw new CuratorError("WRITE_FAILED", `write failed: ${err.message}`);
  }

  const reindexStart = Date.now();
  const indexed = await indexFile(absolute, wiki.root, collectionName);
  store.addDocument(indexed);
  const reindex_ms = Date.now() - reindexStart;

  return {
    written: true,
    path: relative,
    absolute_path: absolute,
    doc_id: indexed.meta.doc_id,
    root_node_id: indexed.tree[0]?.node_id,
    bytes,
    reindex_ms,
    duplicate_warning,
    validation: validationReport,
  };
}

// ── Path validation ─────────────────────────────────────────────────

function validateRelativePath(
  input: string,
  wikiRoot: string
):
  | { ok: true; absolute: string; relative: string }
  | { ok: false; error: string } {
  if (!input || typeof input !== "string") {
    return { ok: false, error: "path must be a non-empty string" };
  }
  if (!input.endsWith(".md")) {
    return { ok: false, error: "path must end in .md" };
  }
  // Reject absolute paths (POSIX and Windows drive letters)
  if (input.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(input)) {
    return { ok: false, error: "path must be relative to the wiki root" };
  }

  const absRoot = resolve(wikiRoot);
  const absPath = resolve(absRoot, normalize(input));

  // Containment: absPath must be exactly absRoot or nested under it
  if (absPath !== absRoot && !absPath.startsWith(absRoot + sep)) {
    return { ok: false, error: "path escapes the wiki root" };
  }
  if (absPath === absRoot) {
    return { ok: false, error: "path cannot be the wiki root itself" };
  }

  // Normalized relative path (always POSIX-ish inside DOCS_ROOT)
  const rel = absPath.slice(absRoot.length + 1).split(sep).join("/");
  return { ok: true, absolute: absPath, relative: rel };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fsStat(path);
    return true;
  } catch {
    return false;
  }
}

// ── Frontmatter validation & serialization ──────────────────────────

function validateFrontmatter(
  fm: unknown
): { ok: true } | { ok: false; error: string } {
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) {
    return { ok: false, error: "frontmatter must be an object" };
  }
  for (const [key, value] of Object.entries(fm as Record<string, unknown>)) {
    if (!/^[a-zA-Z][\w-]*$/.test(key)) {
      return { ok: false, error: `invalid frontmatter key: ${key}` };
    }
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item !== "string" && typeof item !== "number") {
          return {
            ok: false,
            error: `frontmatter array ${key} must contain only strings/numbers`,
          };
        }
        if (typeof item === "string" && /[\n\r]/.test(item)) {
          return { ok: false, error: `frontmatter value in ${key} contains newline` };
        }
      }
      continue;
    }
    if (typeof value === "string") {
      if (/[\n\r]/.test(value)) {
        return { ok: false, error: `frontmatter value for ${key} contains newline` };
      }
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") continue;
    return {
      ok: false,
      error: `frontmatter value for ${key} must be string/number/boolean/array`,
    };
  }
  return { ok: true };
}

/**
 * Serialize frontmatter + body into a single markdown file string.
 *
 * Emits the same simple YAML shape that indexer.ts's extractFrontmatter
 * can parse round-trip: `key: value` and `key: [a, b, c]`. Values are
 * only quoted when they contain characters that would confuse the
 * regex parser.
 */
function serializeMarkdown(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const items = value.map((v) => String(v).trim()).join(", ");
      lines.push(`${key}: [${items}]`);
    } else if (typeof value === "string") {
      lines.push(`${key}: ${formatYamlScalar(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  lines.push(""); // blank line separating frontmatter from body
  // Ensure body ends with a single newline
  const trimmedBody = body.replace(/\s+$/, "");
  lines.push(trimmedBody);
  lines.push("");
  return lines.join("\n");
}

function formatYamlScalar(value: string): string {
  // Quote if the value would be ambiguous to the simple indexer regex
  // (leading bracket, contains quotes, contains # which some parsers treat as comment)
  if (/^[\[\]]/.test(value) || /["']/.test(value) || /#/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

// ── Facet aggregation helpers ───────────────────────────────────────

function aggregateFacetsFromMatches(
  store: DocumentStore,
  matches: SimilarityMatch[]
): { category?: string; tags: string[] } {
  const tagCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  for (const m of matches) {
    const meta = store.getDocMeta(m.doc_id);
    if (!meta) continue;
    for (const tag of meta.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    for (const cat of meta.facets.category ?? []) {
      categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
    }
  }

  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  const topCategory = [...categoryCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  )[0];

  return {
    category: topCategory?.[0],
    tags,
  };
}

// ── Topic → path / title helpers ────────────────────────────────────

function synthesizePathFromTopic(topic: string): string {
  const slug = topicToSlug(topic);
  return `${slug}.md`;
}

function topicToSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

function topicToTitle(topic: string): string {
  const cleaned = topic.replace(/[-_]+/g, " ").trim();
  if (!cleaned) return "Untitled";
  return cleaned
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Tokenization for find_similar ───────────────────────────────────

/**
 * Lightweight tokenizer for the find_similar dedupe path.
 * Matches the shape of store.ts's private tokenize() closely enough
 * for BM25 to see the same term distribution.
 */
function tokenizeForQuery(text: string): string[] {
  if (!text) return [];
  // Strip frontmatter if present so dedupe sees only the body
  const stripped = text.replace(/^---[\s\S]*?\n---\n/, "");
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9_\-\.\/]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
