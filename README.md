# treenav-mcp

BM25 search + hierarchical tree navigation over documentation and source code, via MCP.

Give an AI agent a table of contents it can reason over — for your markdown docs and codebase alike. It searches with BM25, reads the outline, decides which sections matter, and retrieves only what it needs. No vector DB, no embeddings, no LLM calls at index time.

## Why not just grep or RAG?

**vs grep/glob:** Grep tells you *where* a symbol is defined. treenav tells the agent *what a file contains* — its full class hierarchy and method list — before reading a line of code. That outline costs ~200 tokens. Reading the whole file costs 6,000.

**vs vector RAG:** RAG hands agents a bag of loosely relevant paragraphs. treenav hands them a structured table of contents they can navigate the way a developer would — search to find candidates, read the outline, pull exactly the section that matters.

## How it works

The same six tools work identically on markdown docs and source code:

**Navigating documentation:**

```
search_documents("auth token refresh")
  → [docs:auth:middleware] Token Lifecycle (score 44.2)
  → [docs:auth:service]   Authentication Flow (score 38.1)

get_tree("docs:auth:middleware")
  [n3] ## Token Lifecycle
    [n4] ### Refresh Flow (180 words)
      [n5] #### Automatic Refresh (90 words)
      [n6] #### Manual Refresh API (150 words)
    [n7] ### Error Handling (200 words)

navigate_tree("docs:auth:middleware", "n4")
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

Context budget: **2K–8K tokens** of precise content, vs 4K–20K tokens of noisy chunks from vector RAG.

## Quick Start

```bash
# Install Bun if you don't have it
curl -fsSL https://bun.com/install | bash

# Docs + source code (recommended)
DOCS_ROOT=./docs CODE_ROOT=./src bunx treenav-mcp

# Docs only
DOCS_ROOT=/path/to/your/docs bunx treenav-mcp

# Source code only
CODE_ROOT=./src bunx treenav-mcp
```

### Claude Desktop / Claude Code Configuration

```json
{
  "mcpServers": {
    "treenav": {
      "command": "bunx",
      "args": ["treenav-mcp"],
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
git clone https://github.com/joesaby/treenav-mcp.git
cd treenav-mcp
bun install
DOCS_ROOT=./docs CODE_ROOT=./src bun run serve       # stdio
DOCS_ROOT=./docs bun run serve:http                  # HTTP (port 3100)
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_documents` | Browse catalog with tag/keyword filtering and facet counts |
| `search_documents` | BM25 keyword search with facet filters and glossary expansion |
| `get_tree` | Hierarchical outline — structure and word counts, no content |
| `get_node_content` | Retrieve full text of specific sections by node ID |
| `navigate_tree` | Get a section and all its descendants in one call |
| `find_symbol` | Search code symbols by name, kind, and language (requires `CODE_ROOT`) |

## Supported Languages

**Code navigation** (AST-based symbol extraction):

| Language | Parser | Symbols extracted |
|----------|--------|------------------|
| TypeScript / JavaScript | Regex AST | classes, interfaces, functions, types, enums |
| Python | Indentation-aware | classes, functions, methods |
| Go, Rust, Java, Kotlin, Scala | Generic | structs/classes, functions, interfaces, enums |
| C, C++ | Generic + `ClassName::method()` | classes, method implementations |
| C#, Ruby, Swift, PHP, Lua, Shell | Generic | classes, functions |

**Markdown indexing:** any `.md` file, heading levels 1–6.

## Configuration

```bash
DOCS_ROOT=./docs          # markdown root (required unless CODE_ROOT set)
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

## Standing on Shoulders

- **[PageIndex](https://pageindex.ai)** — Hierarchical tree navigation and the agent reasoning workflow: search → outline → retrieve.
- **[Pagefind](https://pagefind.app)** by **[CloudCannon](https://cloudcannon.com)** — BM25 scoring, positional index, filter facets, density excerpts, stemming, content hashing, multisite weighting. Full attribution in [DESIGN.md](docs/DESIGN.md).

## License

MIT
