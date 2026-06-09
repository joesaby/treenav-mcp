# treenav

**A local search backend for code, docs, and structured data that AI agents can navigate.**

BM25 search, literal/regex grep, AST-based tree navigation, and O(1) row lookup — over markdown documentation, source code, and CSV/JSONL data. Code parsers cover TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Scala, C, C++, C#, Ruby, Swift, PHP, and more. Use it as an MCP server, an HTTP service, or a library you embed in your own MCP. No vector DB, no embeddings, no LLM calls at index or query time.

**Works with:** [Claude Code](https://claude.com/claude-code), [Claude Desktop](https://claude.ai), [Cursor](https://cursor.sh), [Cline](https://github.com/cline/cline), [Continue](https://continue.dev), [Goose](https://github.com/block/goose), or any MCP-compatible client. Also runnable as a standalone HTTP service, as a TypeScript library imported into your own MCP server, or via `bunx treenav init` to wire treenav into a host's MCP config in one command.

## Why not just grep or RAG?

**vs grep/glob:** Grep tells you *where* a symbol is defined. treenav tells the agent *what a file contains* — its full class hierarchy and method list — before reading a line of code. That outline costs ~200 tokens. Reading the whole file costs 6,000.

**vs vector RAG:** RAG hands agents a bag of loosely relevant paragraphs. treenav hands them a structured table of contents they can navigate the way a developer would — search to find candidates, read the outline, pull exactly the section that matters.

## How it works

The same toolset works identically on markdown docs, source code, and structured data:

**Navigating documentation:**

```
search_documents("auth token refresh")
  → [docs:auth:middleware] Token Lifecycle (score 0.0442)
  → [docs:auth:service]   Authentication Flow (score 0.0381)

get_tree("docs:auth:middleware")
  [n3] ## Token Lifecycle
    [n4] ### Refresh Flow (180 words)
      [n5] #### Automatic Refresh (90 words)
      [n6] #### Manual Refresh API (150 words)
    [n7] ### Error Handling (200 words)

get_node_content("docs:auth:middleware", ["n4"], include_descendants=true)
  → full text of n4 + n5 + n6 only (420 words, not the whole doc)
```

**Navigating source code:**

```
find_symbol("authenticate", kind="function")
  → function AuthService::authenticate  [code:src:auth:service_cc]
  → function validateToken              [code:src:auth:token_ts]

get_tree("code:src:auth:service_h")
  [n1] class AuthService
    [n2]   method constructor (12 words)
    [n3]   method authenticate (28 words)
    [n4]   method refreshToken (35 words)
  [n5] class TokenStore

get_node_content("code:src:auth:service_h", ["n3"])
  → just the authenticate method signature — not the whole 800-line file
```

**One-call retrieval (compile_context):**

```
compile_context({ intent: "auth token refresh", sources: ["all"] })
  ## Hits — docs (2 of 8)
  1. [docs:auth:middleware → n4] Auth Middleware › Refresh Flow  (score 0.0421)
     auth/middleware.md
     Snippet: Rotate the JWT signing key, then redeploy the auth service.

  ## Hits — code (1 of 3)
  1. [code:src:auth:service_ts → c1] AuthService › refreshToken  (score 0.0387)
     src/auth/service.ts
     Signature: refreshToken() { return this.signer.rotate(); }

  ## Outlines (top 1)
  ▸ docs:auth:middleware — Auth Middleware
    [n0] # Auth Middleware (412 words)
      [n1]   ## Token Lifecycle (180 words)
```

Context budget: **2K–8K tokens** of precise content, vs 4K–20K tokens of noisy chunks from vector RAG.

## Quick Start

```bash
# Install Bun if you don't have it
curl -fsSL https://bun.com/install | bash

# Docs + source code (recommended)
DOCS_ROOT=./docs CODE_ROOT=./src bunx treenav

# Docs only
DOCS_ROOT=/path/to/your/docs bunx treenav

# Source code only
CODE_ROOT=./src bunx treenav
```

### Claude Desktop / Claude Code Configuration

```json
{
  "mcpServers": {
    "treenav": {
      "command": "bunx",
      "args": ["treenav"],
      "env": {
        "DOCS_ROOT": "/path/to/your/docs",
        "CODE_ROOT": "/path/to/your/source"
      }
    }
  }
}
```

### Run from source

```bash
git clone https://github.com/joesaby/treenav.git
cd treenav
bun install
DOCS_ROOT=./docs CODE_ROOT=./src bun run serve       # stdio
DOCS_ROOT=./docs bun run serve:http                  # HTTP (port 3100)
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `compile_context` | **Start here.** Single-call composed retrieval: ranked hits per source + outline trees for top hits. Replaces the typical `search → tree → content` loop |
| `search_documents` | BM25 keyword search with facet filters, collection scoping, and glossary expansion |
| `grep_documents` | Literal/regex match across indexed content — the `grep -n` of the index |
| `get_tree` | Hierarchical outline — structure and word counts, no content |
| `get_node_content` | Retrieve full text of specific sections by node ID; `include_descendants=true` returns whole subtrees |
| `lookup_row` | O(1) key→row lookup for indexed CSV/JSONL data |
| `find_symbol` | Search code symbols by name, kind, and language (requires `CODE_ROOT`) |
| `list_documents` | Browse the catalog and discover available facets (returns facet counts) |
| `refresh_index` | Re-scan the roots and reload the index if files changed on disk |
| `navigate_tree` | *Deprecated* — alias of `get_node_content` with `include_descendants=true` |

## Supported Languages

**Code navigation** (AST-based symbol extraction):

| Language | Parser | Symbols extracted |
|----------|--------|------------------|
| TypeScript / JavaScript | Dedicated (regex AST) | classes, interfaces, functions, types, enums, methods, properties |
| Python | Dedicated (indentation-aware) | classes, functions, methods, constants |
| Go | Dedicated (receiver-aware) | structs, interfaces, type aliases, functions, receiver methods |
| Rust | Dedicated (impl-aware) | structs, enums, traits, impl methods, functions, consts |
| Java | Dedicated | classes, interfaces, enums, records, methods |
| Kotlin, Scala, C, C++, C#, Ruby, Swift, PHP, Lua, Shell | Generic fallback | classes, functions (C++: `ClassName::method()` impls) |

**Markdown indexing:** any `.md` file, heading levels 1–6.

## Configuration

```bash
DOCS_ROOT=./docs          # markdown root (required unless CODE_ROOT set)
DOCS_ROOTS=./docs:1.0,./rfcs:0.5  # multiple weighted roots (overrides DOCS_ROOT)
CODE_ROOT=./src           # source code root (optional, enables code nav)
DOCS_GLOB=**/*.md         # file glob for markdown
CODE_GLOB=**/*.{ts,py}    # file glob for code (default: all supported)
CODE_WEIGHT=1.0           # BM25 weight for code vs docs results
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for multiple collections, ranking tuning, frontmatter best practices, and glossary setup.

## Performance

| Operation | Time | LLM tokens |
|-----------|------|------------|
| Index 900 markdown docs | 2–5s | 0 |
| Index 1,500 C++ files (e.g. Envoy core) | ~0.15s | 0 |
| Incremental re-index (5 changed files) | ~50ms | 0 |
| Search | 5–30ms | ~300–1K |
| Tree outline | <1ms | ~200–800 |

Memory: ~25–50MB for 900 docs; ~10–20MB for 1,500 code files with full positional index.

## Docs

- [Architecture & Design](docs/DESIGN.md) — BM25 engine, tree model, code indexer, Pagefind/PageIndex attribution
- [Configuration Reference](docs/CONFIGURATION.md) — env vars, frontmatter, ranking tuning, glossary
- [Competitive Analysis](docs/COMPETITIVE-ANALYSIS.md) — comparison with PageIndex, QMD, GitMCP, Code-Index-MCP, and others
- [Retrieval Variants](docs/RETRIEVAL-VARIANTS.md) — comparison of BM25 baseline vs. semantic vs. compile_context, with decision framework

## Standing on Shoulders

treenav builds on direct ideas from [PageIndex](https://pageindex.ai), [Pagefind](https://pagefind.app), [Semble](https://github.com/MinishLab/semble), and [Model2Vec](https://github.com/MinishLab/model2vec). The full record — what we borrowed, from whom, where it lives in the code — is in [`docs/ACKNOWLEDGEMENTS.md`](docs/ACKNOWLEDGEMENTS.md).

## License

MIT
