# CLAUDE.md — treenav

## Project Overview

treenav is a local search backend for code, docs, and structured data that AI agents can navigate. Available as an MCP server (`treenav serve`), an HTTP service (`treenav serve:http`), or a TypeScript library you import into your own MCP server. It provides BM25 search, literal/regex grep, hierarchical tree navigation, and O(1) row lookup over markdown documentation, source code, and CSV/JSONL data. Agents get a table of contents they can reason over — for docs, code, and tabular data — then retrieve only the sections, symbols, or rows they need. Supports AST-based code navigation for TypeScript, Python, Go, Rust, Java, C/C++, and more. No vector DB, no embeddings, no LLM calls at index or retrieval time.

## Architecture

```
src/
├── indexer.ts        # Markdown / CSV / JSONL → tree nodes + facets + content hash
├── code-indexer.ts   # Source code → tree nodes via AST parsing
├── parsers/
│   ├── typescript.ts # TS/JS regex-based AST extraction
│   ├── python.ts     # Python indentation-based symbol extraction
│   ├── go.ts         # Go symbol extraction
│   ├── rust.ts       # Rust symbol extraction
│   ├── java.ts       # Java symbol extraction
│   └── generic.ts    # Fallback for C, C++, Ruby, and other languages
├── store.ts          # In-memory BM25 + grep engine, facets, glossary, row index
├── types.ts          # All TypeScript interfaces and ranking defaults
├── tools.ts          # Shared MCP tool registration
├── compile-context.ts # Composed retrieval (search + grep + lookup + symbol → unified output)
├── search-formatter.ts # Result formatting for search/grep/compile-context output
├── prompts.ts        # MCP prompts for doc-read / doc-grep workflows
├── server.ts         # MCP stdio server (9 read tools)
├── server-http.ts    # MCP HTTP/Streamable HTTP server variant
├── cli-index.ts      # CLI debugging tool for inspecting indexed output
└── cli-init.ts       # `bunx treenav init` — wires up host MCP config
```

### Key Design Decisions

- **Bun-native**: Uses `Bun.markdown.render()` for parsing, `Bun.hash()` for content hashing, `Bun.Glob` for file discovery. Falls back to regex parser if Bun.markdown unavailable (< 1.3.8).
- **PageIndex-inspired tree navigation**: Agents read an outline, reason about it, then retrieve specific branches. This is more token-efficient than RAG's bag-of-chunks.
- **Pagefind-inspired search**: Positional inverted index with BM25 scoring, density-based snippets, filter facets from frontmatter, content hashing for incremental re-indexing, multisite collection weights.
- **Zero LLM calls**: All indexing and retrieval is deterministic search — no embedding models needed.
- **Code navigation**: AST-based parsing maps source files into the same TreeNode model — classes, functions, and interfaces become tree nodes. The existing BM25 engine, facet filters, and all MCP tools work on code without modification.

### Data Flow

1. **Indexing (markdown)**: `indexer.ts` scans markdown files → parses frontmatter + heading tree → extracts facets (including auto-inferred `type` from directory structure) → computes content hash
2. **Indexing (code)**: `code-indexer.ts` scans source files → language-specific parsers extract symbols (class, function, interface, etc.) → maps to TreeNode hierarchy → adds language/symbol_kind facets
3. **Loading**: `store.ts` builds positional inverted index (term → postings with word positions and weights), filter facet index (key → value → doc_id set), and per-node stats for BM25 normalization
4. **Searching**: Tokenize + stem query → expand via glossary → apply facet filters → compute BM25 scores → apply co-occurrence bonuses + collection weights → generate density-based snippets
5. **Navigation**: Agent calls `get_tree` → compact outline → `get_node_content` or `navigate_tree` for precise retrieval

## Development

```bash
bun install              # Install dependencies
bun test                 # Run test suite
bun run serve            # Start stdio MCP server
bun run serve:http       # Start HTTP MCP server (port 3100)
DOCS_ROOT=./path bun run index  # Debug: inspect indexed output
```

### Releases

Versioning is automated via semantic-release on every push to `main`. Commit messages drive version bumps:

| Prefix | Effect |
|--------|--------|
| `feat:` | Minor bump (0.x.0) |
| `fix:` | Patch bump (0.0.x) |
| `feat!:` / `BREAKING CHANGE:` | Major bump (x.0.0) |
| `chore:`, `docs:`, `ci:`, `test:` | No release |

A GitHub Release is created automatically with generated release notes. Docker Hub is updated with both `:latest` and `:<version>` tags only when a release is published.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCS_ROOT` | `./docs` | Path to markdown repository |
| `DOCS_GLOB` | `**/*.md` | File glob (comma-separated for multi-glob, e.g. `**/*.md,**/*.csv,**/*.jsonl`) |
| `CSV_MAX_TEXT_LENGTH` | `2000` | Max chars indexed per text field in CSV/JSONL rows |
| `MAX_DEPTH` | `6` | Max heading depth to index |
| `SUMMARY_LENGTH` | `200` | Characters in node summaries |
| `PORT` | `3100` | HTTP server port |
| `GLOSSARY_PATH` | `$DOCS_ROOT/glossary.json` | Path to abbreviation glossary |
| `CODE_ROOT` | *(disabled)* | Path to source code root (enables code indexing) |
| `CODE_COLLECTION` | `code` | Name for the code collection |
| `CODE_WEIGHT` | `1.0` | BM25 weight multiplier for code results |
| `CODE_GLOB` | all supported extensions | Glob pattern for code files |

### Glossary File Format

Place a `glossary.json` in the docs root (or set `GLOSSARY_PATH`):

```json
{
  "CLI": ["command line interface"],
  "K8s": ["kubernetes"],
  "TLS": ["transport layer security"]
}
```

This enables bidirectional query expansion: searching "CLI" also matches "command line interface" and vice versa.

## MCP Tools

1. **`list_documents`** — Browse catalog with tag/keyword filtering, returns facet counts
2. **`search_documents`** — BM25 keyword search with facet filters and glossary expansion
3. **`grep_documents`** — Literal or regex match across indexed content (the `grep -n` of the index). Use when you know the exact symbol/error/CLI flag and don't want stemming or glossary expansion.
4. **`get_tree`** — Hierarchical outline (no content) for agent reasoning
5. **`get_node_content`** — Retrieve full text of specific sections by node ID
6. **`navigate_tree`** — Get a section and all descendants in one call
7. **`lookup_row`** — O(1) key→row lookup for indexed CSV/JSONL data (e.g. `PROJ-44`, `ITEM-1234`)
8. **`find_symbol`** — Search code symbols by name, kind (`class`/`function`/`interface`/etc.), and language (requires `CODE_ROOT`)
9. **`compile_context`** — Composed retrieval. Single call returns ranked hits partitioned by source (docs/code/rows) plus outline trees for the top hits. Replaces the typical `search → get_tree → get_node_content` loop with one call. `mode='auto'` picks the right primitive (search / grep / lookup / symbol) from the intent shape.

### CLI Wrapper

`treenav init` — interactive wiring of host MCP config (Claude Code, Claude Desktop, Cursor, OpenCode, Codex). Run via `bunx treenav init` or via the published bin.

## Code Conventions

- TypeScript with strict mode, ESNext target, bundler module resolution
- No classes in indexer (functional), class-based store (`DocumentStore`)
- Bun test runner (`bun test`) with `.test.ts` files in `tests/`
- Comments reference design influences: PageIndex, Pagefind, Bun.markdown
- Reserved frontmatter keys (not used as facets): title, description, layout, permalink, slug, draft, date, source_url, source_title, captured_at

## Frontmatter Best Practices for Indexed Docs

For best search quality, markdown files should include:

```yaml
---
title: "Descriptive Title"
description: "One-line summary for search ranking"
tags: [relevant, terms, here]
type: runbook  # or: guide, reference, procedure, architecture, tutorial
category: auth  # any domain-specific grouping
---
```

When frontmatter is missing:
- **title**: Falls back to first H1, then filename. Generic titles ("Introduction", "index") are auto-prefixed with parent directory name.
- **description**: Falls back to first paragraph summary (first 200 chars).
- **type**: Auto-inferred from directory structure (e.g., `runbooks/` → `runbook`, `guides/` → `guide`).
- **tags**: No auto-generation — must be explicit in frontmatter.
