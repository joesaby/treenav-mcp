# Configuration Reference

## Environment Variables

### Markdown / structured-data indexing

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCS_ROOT` | `./docs` | Path to markdown repository root |
| `DOCS_ROOTS` | *(unset)* | Multiple weighted roots, e.g. `./docs:1.0,./rfcs:0.5` — see [Multiple Collections](#multiple-collections). Overrides `DOCS_ROOT`. |
| `DOCS_GLOB` | `**/*.md` | File glob (comma-separated for multi-glob, e.g. `**/*.md,**/*.csv,**/*.jsonl`). Applies to every docs collection. |
| `CSV_MAX_TEXT_LENGTH` | `2000` | Max chars indexed per text field in CSV/JSONL rows |
| `MAX_DEPTH` | `6` | Max heading depth to index (1–6) |
| `SUMMARY_LENGTH` | `200` | Characters in node summaries |
| `PORT` | `3100` | HTTP server port (`serve:http` only) |
| `GLOSSARY_PATH` | `$DOCS_ROOT/glossary.json` | Path to abbreviation glossary |

### Code navigation (AST-based)

Set `CODE_ROOT` to enable AST-based code indexing alongside markdown docs.

| Variable | Default | Description |
|----------|---------|-------------|
| `CODE_ROOT` | *(disabled)* | Path to source code root. Set this to enable code indexing. |
| `CODE_COLLECTION` | `code` | Name for the code collection |
| `CODE_WEIGHT` | `1.0` | BM25 weight multiplier for code results vs docs |
| `CODE_GLOB` | all supported extensions | Glob pattern for code files |

**Supported languages:** TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Scala, C, C++, C#, Ruby, Swift, PHP, Lua, Shell

**How it works:** Source files are parsed into the same tree structure used for markdown. Classes, functions, interfaces, and types become tree nodes with parent-child relationships (e.g., class → methods). All existing tools (`search_documents`, `get_tree`, `get_node_content`) work on code files unchanged. The `find_symbol` tool provides code-specific filtering by symbol kind and language.

**Auto-generated facets for code:**

| Facet | Values | Description |
|-------|--------|-------------|
| `language` | `typescript`, `python`, `go`, etc. | Detected from file extension |
| `content_type` | `code` | Distinguishes code from markdown docs |
| `symbol_kind` | `class`, `function`, `interface`, `type`, `enum`, `method`, `variable` | Symbol types found in the file |

**Examples:**

```bash
# Docs only (default)
DOCS_ROOT=./docs bun run serve

# Docs + code
DOCS_ROOT=./docs CODE_ROOT=./src bun run serve

# Code only
DOCS_ROOT=/dev/null CODE_ROOT=./src bun run serve

# Code with custom glob (TypeScript only)
CODE_ROOT=./src CODE_GLOB="**/*.{ts,tsx}" bun run serve

# Weight docs higher than code in unified search results
CODE_ROOT=./src CODE_WEIGHT=0.8 bun run serve
```

---

## compile_context

Single composed-retrieval tool. Use this to collapse the typical
`search_documents → get_tree → get_node_content` loop into one call.

Inputs (all optional except `intent`):
- `intent` — the query (NL, literal, regex, key, or symbol).
- `mode` — `auto` (default), `search`, `grep`, `lookup`, or `symbol`.
- `sources` — array of `docs`, `code`, `rows`, or `all` (default).
- `filters` — same facet filters as `search_documents`.
- `output.top_k_per_source` — default 3, max 10.
- `output.include_outlines_for_top` — default 2 (set 0 to disable).
- `output.include_full_content_for_top` — default 0 (opt-in).
- `output.max_tokens` — default 2000, max 8000.

Returns a single text block with ranked hits per source, bundled outline
trees for the top hits, a budget summary, and follow-up hints.

See `docs/superpowers/specs/2026-05-06-compile-context-design.md` and
`docs/adr/0002-multi-intent-out-of-scope.md` for the full design and
rejected alternatives.

---

## Multiple Collections

Index multiple doc folders as weighted collections (Pagefind multisite style):

```bash
# .env
DOCS_ROOTS=./docs:1.0,./api-specs:0.8,./rfcs:0.5
```

Each collection is named from its folder basename (duplicate basenames get a
numeric suffix: `docs`, `docs-2`). The weight is optional and defaults to
`1.0`. The weight multiplier is applied to scores at query time, so a result
from `docs` (weight 1.0) will outrank an equally relevant result from `rfcs`
(weight 0.5). An automatic `collection` filter facet is added to every
document, so searches can be scoped with `filters: { "collection": "rfcs" }`.

When `DOCS_ROOTS` is set it replaces `DOCS_ROOT`. `DOCS_GLOB` applies to all
listed roots, and the default glossary location becomes
`<first root>/glossary.json`.

---

## Ranking Tuning

BM25 ranking parameters and field weights are tunable, but **only via the
`DocumentStore.setRanking()` API at library-embed time**, not via
environment variables. The defaults below work well for most documentation
corpora. For per-knob descriptions and corpus-type recommendations see
[DESIGN.md](./DESIGN.md#scoring-tuning-guide).

Since the Tier 3 RRF (Reciprocal Rank Fusion) rework, fused scores live in
roughly `[0, 0.05]`, so the additive bonus defaults are two orders of
magnitude smaller than in older releases.

| Parameter | Default | Effect |
|-----------|---------|--------|
| `bm25_k1` | `1.2` | TF saturation — lower means repeated terms matter less |
| `bm25_b` | `0.75` | Length normalization — higher promotes shorter sections |
| `title_weight` | `3.0` | Boost for matches in headings |
| `code_weight` | `1.5` | Boost for matches in code blocks |
| `description_weight` | `2.0` | Boost for matches in frontmatter description |
| `term_proximity_bonus` | `0.01` | Co-occurrence reward for multi-term queries |
| `full_coverage_bonus` | `0.05` | All-terms-present reward |
| `prefix_penalty` | `0.5` | RRF weight for the prefix signal (legacy fallback for `signal_weights.bm25_prefix`) |
| `rrf_k` | `60` | RRF rank-curve constant — lower makes top hits dominate more |
| `signal_weights` | `{}` | Per-signal RRF weights (`bm25_exact`, `bm25_prefix`, `subtoken`); missing keys fall back to legacy knobs |
| `definition_boost` | `2.0` | Multiplier when a query term matches a code symbol's definition |
| `subtoken_weight` | `0.5` | Weight for camelCase/snake_case subtoken matches in code |
| `file_coherence_bonus` | `0.05` | Lift for files with multiple matching sections |
| `file_lead_bonus` | `0.05` | Extra lift for the leading node of a multi-hit file |
| `window_density_bonus` | `0.005` | Reward for tightly clustered matches in long sections |
| `symbol_query_definition_boost_multiplier` | `1.5` | Extra definition boost for identifier-shaped queries |
| `symbol_query_exact_boost` | `1.3` | Extra exact-signal weight for identifier-shaped queries |
| `symbol_query_subtoken_dampener` | `0.5` | Subtoken-signal dampening for identifier-shaped queries |

See `src/types.ts` (`RankingParams` / `DEFAULT_RANKING`) for the authoritative
per-knob documentation.

> **Note:** the only ranking-related env var honored at runtime is
> `CODE_WEIGHT` (multiplier on the *code collection*'s BM25 results, see
> the Code navigation table above). It is not the same as the per-field
> `code_weight` in this table.

---

## Glossary (Query Expansion)

Place a `glossary.json` in your docs root to enable bidirectional query expansion. Searching for either the abbreviation or the full form will match both.

```json
{
  "CLI": ["command line interface"],
  "TLS": ["transport layer security"],
  "JWT": ["json web token"],
  "K8s": ["kubernetes"]
}
```

Override the default path:

```bash
GLOSSARY_PATH=/path/to/glossary.json
```

---

## Frontmatter Best Practices

For best search quality, add structured metadata to your markdown files:

```yaml
---
title: "Descriptive Title (not 'Introduction')"
description: "One-line summary — gets a 2x weight boost in search ranking"
tags: [relevant, terms, here]
type: runbook        # or: guide, reference, procedure, tutorial, architecture
category: auth       # any domain-specific grouping
---
```

### Fallbacks when frontmatter is missing

| Field | Fallback | Notes |
|-------|----------|-------|
| `title` | First H1, then filename | Generic titles ("Introduction", "index") are auto-prefixed with the parent directory name |
| `description` | First 200 chars of first section | Explicit descriptions rank 2x better |
| `type` | Auto-inferred from directory structure | See table below |
| `tags` | None | Must be explicit — no auto-generation |

### Reserved frontmatter keys

These are used internally and not exposed as filter facets: `title`, `description`, `layout`, `permalink`, `slug`, `draft`, `date`, `source_url`, `source_title`, `captured_at`.

### Auto-inferred `type` from directory structure

| Directory pattern | Inferred type |
|------------------|---------------|
| `runbooks/`, `runbook/` | `runbook` |
| `guides/`, `guide/` | `guide` |
| `tutorials/` | `tutorial` |
| `reference/` | `reference` |
| `api-docs/`, `apidocs/` | `api-reference` |
| `architecture/` | `architecture` |
| `adrs/`, `adr/` | `adr` |
| `rfcs/` | `rfc` |
| `procedures/` | `procedure` |
| `playbooks/` | `playbook` |
| `troubleshoot*/` | `troubleshooting` |
| `ops/` | `operations` |
| `deploy/` | `deployment` |
| `pipeline/` | `pipeline` |
| `onboard*/` | `onboarding` |
| `postmortem/` | `postmortem` |

If a file is in none of the above directories, `type` is only set if declared explicitly in frontmatter.
