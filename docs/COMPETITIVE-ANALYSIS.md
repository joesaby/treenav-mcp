# treenav — Competitive Landscape Analysis

_Last verified: May 2026_

This document positions treenav against the MCP document retrieval and
code navigation ecosystem. For architecture and attribution details, see
[DESIGN.md](./DESIGN.md).

---

## The Landscape

### Documentation retrieval

| Project | Approach | Stars | Local/Cloud | LLM at Index | LLM at Query |
|---------|----------|-------|-------------|--------------|--------------|
| **treenav** | BM25 + tree navigation | Early stage | Local | No | No |
| **PageIndex** (VectifyAI) | LLM tree search | 15K (lib) / 209 (MCP) | Both | Yes | Yes |
| **QMD** (Tobi Lütke) | BM25 + vectors + LLM reranker | — | Local | Yes (embeddings) | Yes (reranker) |
| **GitMCP** (idosal) | GitHub proxy | 7.6K | Cloud | No | No |
| **docs-mcp-server** (arabold) | General indexer + optional embeddings | — | Local | Optional | Optional |
| **MCP-Markdown-RAG** (Zackriya) | Vector RAG over markdown (Milvus) | — | Local | Yes (embeddings) | No |
| **Context7** (Upstash) | Pre-indexed OSS library docs | 45.7K | Cloud | — | — |

### Code navigation

| Project | Approach | Parser | BM25? | Tree nav? |
|---------|----------|--------|-------|-----------|
| **treenav** | Symbol index + BM25 + tree nav | Regex/indent AST | Yes | Yes |
| **Code-Index-MCP** (ViperJuice) | Symbol index + BM25 | tree-sitter (48 langs) | Yes (SQLite FTS5) | No |
| **mcp-server-tree-sitter** (wrale) | Live AST queries | tree-sitter (100+ langs) | No | No |
| **Serena** (oraios) | Symbol search + LSP integration | tree-sitter + LSP | No | No |
| **ast-grep-mcp** | Structural pattern matching | tree-sitter | No | No |

treenav is the only tool in either table that covers both markdown documentation
and source code in a single BM25-indexed, tree-navigable corpus.

---

## Head-to-Head Comparisons

### 1. PageIndex — Closest Philosophical Cousin

**Repo:** [VectifyAI/PageIndex](https://github.com/VectifyAI/PageIndex) (15,094 stars),
[VectifyAI/pageindex-mcp](https://github.com/VectifyAI/pageindex-mcp) (209 stars)

PageIndex pioneered the tree navigation concept that treenav adopts.
Its Mafin 2.5 system achieved 98.7% accuracy on FinanceBench
([VentureBeat](https://venturebeat.com/infrastructure/this-tree-search-framework-hits-98-7-on-documents-where-vector-search-fails/)),
a benchmark involving multi-hop queries over financial documents with
internal cross-references.

**How the architectures diverge:**

PageIndex uses LLM calls at both index time (GPT-4o builds tree structures
from PDFs, generates node summaries) and retrieval time (the LLM navigates
the tree to find relevant sections). treenav uses zero LLM calls at
either stage — markdown headings provide the tree for free, and BM25
handles ranking.

PageIndex offers three deployment modes: cloud API, cloud OAuth, and local
via `npx`. It is not cloud-only, but its recommended path involves API keys
and hosted infrastructure.

**Where PageIndex wins:**

- Complex multi-hop queries on professional documents with heavy
  cross-referencing (financial reports, legal contracts). The LLM reasons
  *within* the retrieval pipeline, following breadcrumbs across sections.
- PDF documents where structure must be inferred rather than parsed.

**Where treenav wins:**

- Speed: 5-30ms queries with zero LLM tokens vs hundreds of milliseconds
  minimum (LLM inference floor). For an agent making 10-15 retrieval calls,
  this compounds.
- Cost: Zero API spend at any volume. PageIndex's LLM calls at both index
  and retrieval make large-scale use expensive.
- Simplicity: `bun run serve` with a path to markdown. No API keys, no
  model configuration, no cloud dependency.

**Honest assessment:** For well-structured markdown docs, the two deliver
comparable retrieval quality. For complex PDFs with cross-references,
PageIndex will outperform because it can reason across section boundaries
during retrieval — something BM25 fundamentally cannot do.

---

### 2. QMD — Best Single-Query Precision

**Repo:** [tobi/qmd](https://github.com/tobi/qmd) — by Tobias Lütke (Shopify CEO)

QMD runs a three-stage hybrid pipeline locally: BM25 via SQLite FTS5,
vector semantic search via embeddings, and LLM re-ranking via a fine-tuned
Qwen reranker. All models run locally via node-llama-cpp with GGUF files
(~2GB total: 300MB embeddings, 640MB reranker, 1.1GB query expansion).
Supports both stdio and HTTP MCP transports.

**Where QMD wins:**

- Semantic matching. A search for "how to handle expired credentials" will
  find docs about "token refresh flow" because vector similarity bridges
  the vocabulary gap. treenav's BM25 with stemming and prefix matching
  will partially bridge this, but cannot make the semantic leap.
- Single-query precision. The BM25 + vector + reranker pipeline gives QMD
  the best accuracy on any individual question.

**Where treenav wins:**

- No model downloads. QMD requires ~2GB of GGUF models on first run.
  treenav has two npm dependencies.
- No GPU/CPU inference overhead. QMD loads models into memory (hundreds of
  MB to GB). treenav uses ~25-50MB for 900 docs.
- Structure awareness. QMD returns ranked chunks — the agent gets answers
  but cannot browse document structure, reason about section hierarchy, or
  selectively retrieve branches. For multi-step reasoning over a document's
  architecture, tree navigation outperforms flat chunk retrieval.
- Speed. QMD's hybrid pipeline involves model inference at query time.
  treenav returns in 5-30ms.

**Honest assessment:** QMD has better search recall for fuzzy/semantic
queries. treenav has better agent workflow support via tree navigation.
They optimize for different things — if your docs use consistent
terminology, BM25 is sufficient and the tree navigation advantage matters
more. If your queries frequently use different vocabulary than your docs,
QMD's semantic search is genuinely valuable.

---

### 3. GitMCP — Zero-Friction OSS Access

**Repo:** [idosal/git-mcp](https://github.com/idosal/git-mcp) (7,600 stars)

GitMCP is a cloud-hosted MCP server on Cloudflare Workers at `gitmcp.io`.
Paste a URL into your MCP config and it works immediately — no cloning,
no indexing, no installation. It fetches docs from any public GitHub repo
on the fly, prioritizing `llms.txt` (falling back to README and GitHub
Pages content). Has four tools including `search_code` via GitHub's
code search API.

**Where GitMCP wins:**

- Zero setup. Unbeatable time-to-value for quick questions about any
  OSS project.
- Breadth. Works on any public GitHub repo instantly. The generic endpoint
  (`gitmcp.io/docs`) lets the agent pick the repo dynamically.
- No local clone needed. GitMCP works directly against the GitHub API.

**Where treenav wins:**

- Retrieval quality. GitMCP has no inverted index, no relevance scoring,
  no ranking. If a project lacks `llms.txt` (most don't), the agent gets
  a README blob. treenav builds a proper BM25-scored index with
  positional data and density-based snippets.
- Structure. GitMCP has no concept of heading hierarchy or section-level
  retrieval. It delivers flat content — "here's the doc." treenav lets
  the agent see `[n4] ## Token Refresh Flow (180 words)` and decide
  whether to pull it.
- Token efficiency. GitMCP often dumps full pages into context (10-20K+
  tokens of unfiltered content). treenav lets the agent budget tokens
  by picking exact sections (2-8K tokens of precise content).
- **Private and enterprise docs.** GitMCP explicitly states it "only
  accesses content that is already publicly available." No authentication,
  no support for GitHub Enterprise Server behind VPN/firewall. treenav
  works entirely offline on any markdown on disk.
- Latency. 5-30ms local vs network round-trips to GitHub's API, subject
  to rate limits.

**Honest assessment:** These aren't really competing for the same user.
GitMCP solves discovery (quickly get context on any OSS project).
treenav solves precision retrieval (navigate and extract exactly what
you need from a known corpus). An engineer might use GitMCP to explore a
new library, then switch to treenav once that library's docs become
part of their daily workflow.

---

### 4. docs-mcp-server — General-Purpose Doc Indexer

**Repo:** [arabold/docs-mcp-server](https://github.com/arabold/docs-mcp-server)

Self-described "open-source alternative to Context7, Nia, and Ref.Tools."
Indexes websites, GitHub repos, local folders. Supports HTML, Markdown,
PDF, Word, Excel, PowerPoint, and source code. Optionally uses embeddings
(OpenAI, Ollama, Gemini, Azure, Bedrock) for semantic search.

**Where docs-mcp-server wins:**

- Format breadth. Handles PDF, Word, Excel, PowerPoint, remote URLs, and
  GitHub repos — treenav covers markdown and source code files.
- Optional semantic search via configurable embedding providers.

**Where treenav wins:**

- Tree navigation. docs-mcp-server is traditional RAG via MCP — chunks
  and retrieval, no heading hierarchy or structural reasoning.
- Zero external dependencies. docs-mcp-server's semantic search requires
  an embedding provider (API keys, model configuration). Without
  embeddings, its search quality drops significantly.
- Purpose-built vs general-purpose. treenav's nine-tool MCP surface
  (`list_documents`, `search_documents`, `grep_documents`, `get_tree`,
  `get_node_content`, `navigate_tree`, `lookup_row`, `find_symbol`,
  `compile_context`) is designed specifically for how agents reason over
  documentation structure — including a single composed-retrieval call
  that collapses the search → tree → content loop.

---

### 5. MCP-Markdown-RAG — Classic Vector RAG Baseline

**Repo:** [Zackriya-Solutions/MCP-Markdown-RAG](https://github.com/Zackriya-Solutions/MCP-Markdown-RAG)

Standard vector-based semantic search over markdown files using a
file-based Milvus vector database. Chunks documents, computes embeddings
(~50MB model downloaded on first run), stores in Milvus, retrieves by
cosine similarity.

This represents the "standard RAG" approach that treenav explicitly
contrasts against. The trade-off is straightforward: MCP-Markdown-RAG
gets semantic matching (vocabulary-independent similarity) at the cost
of chunking artifacts (losing document structure), embedding overhead,
and a vector database dependency. treenav gets structural awareness
and zero-dependency speed at the cost of keyword-only matching.

---

### 6. Context7 — Pre-Indexed OSS Library Docs

**Repo:** [upstash/context7](https://github.com/upstash/context7) (45,700 stars, #3 MCP server globally)

Cloud-hosted, community-contributed registry of pre-indexed open-source
library documentation (Next.js, MongoDB, Supabase, etc.). Completely
different use case — Context7 solves "give me the latest framework docs"
while treenav solves "let an agent navigate my documentation."

Context7 cannot index private or internal documentation. Its backend
(API, parsing, crawling) is proprietary and not open source. It is
complementary rather than competitive.

---

## Cross-Cutting Analysis

### Agentic Query Performance

How each system performs across different query patterns:

| Query Type | Best | Runner-up | Notes |
|-----------|------|-----------|-------|
| Well-structured markdown docs | treenav ≈ PageIndex | QMD | Tree navigation compensates for BM25-only search |
| Complex PDFs with cross-references | PageIndex | treenav | LLM reasoning follows breadcrumbs across sections |
| Fuzzy/semantic queries | QMD | PageIndex | Vector search bridges vocabulary gaps |
| Agent autonomy (browsing + deciding) | treenav ≈ PageIndex | — | QMD/GitMCP lack tree navigation entirely |
| Multi-step workflow (10+ tool calls) | treenav | PageIndex | 5-30ms vs LLM inference latency per call |

### The BM25 Limitation — An Honest Acknowledgment

BM25-only search is treenav's main vulnerability. If someone searches
"how to handle expired credentials" but the docs say "token refresh flow,"
BM25 with stemming and prefix matching will partially bridge the gap but
cannot make the semantic connection that QMD's vector search would.

This matters less than it might seem for the target use case (structured
markdown docs that the user controls), because:

1. Documentation authors tend to use consistent terminology
2. The agent can browse the tree to discover sections by title
3. Prefix matching catches many partial-term overlaps
4. The multi-tool workflow lets the agent iterate (search → browse →
   refine), and `compile_context` does this in a single call

But for corpora with inconsistent terminology or natural-language queries
from users unfamiliar with the docs' vocabulary, this is a real gap.

### Large Volume Scaling

| System | 900 docs | 5,000 docs (est.) | 10,000+ docs (est.) |
|--------|----------|-------------------|----------------------|
| **treenav** | 2-5s, 0 LLM tokens | ~15-25s (linear) | ~30-50s |
| **PageIndex** | Minutes (LLM calls per doc) | Expensive | Impractical without caching |
| **QMD** | Minutes (model loading + embedding) | 10-30 min | Scales with model inference |
| **docs-mcp-server** | Varies (depends on embedding provider) | Varies | Varies |

treenav's zero-LLM, zero-embedding indexing is the most scalable of
the group. The known boundary: the positional inverted index lives entirely
in memory. At 10,000+ documents with hundreds of thousands of sections,
this could grow to several hundred MB. The scaling path
(see [DESIGN.md](./DESIGN.md#scaling-path)) acknowledges this and maps
tiers from in-memory to SQLite FTS5 to chunked indexes.

### Token Efficiency

For the same retrieval task, total tokens consumed (index + retrieval):

| System | Index tokens | Per-query tokens | Agent workflow (10 calls) |
|--------|-------------|------------------|--------------------------|
| **treenav** | 0 | ~300-1K | ~3K-10K |
| **PageIndex** | Thousands per doc | Hundreds-thousands (LLM reasoning) | ~10K-50K+ |
| **QMD** | 0 (local models) | 0 (local models) | 0 (local models) |
| **GitMCP** | 0 | ~10K-20K (full pages dumped) | ~100K-200K |

QMD technically wins here since it uses local models with zero API tokens,
but at the cost of ~2GB of local model files and GPU/CPU inference.
treenav is the most token-efficient system that doesn't require
downloading ML models.

### The Enterprise Blind Spot

Most popular MCP doc servers assume public access:

| System | Private repos | Enterprise GitHub | Offline | No data leaves perimeter |
|--------|--------------|-------------------|---------|------------------------|
| **treenav** | Yes | Yes | Yes | Yes |
| **PageIndex** | Via local mode | Via local mode | Via local mode | Via local mode |
| **QMD** | Yes | Yes | Yes | Yes |
| **GitMCP** | No | No | No | No |
| **docs-mcp-server** | Local mode only | Local mode only | Local mode only | Depends on config |
| **Context7** | No | No | No | No |

For regulated industries (telecom, finance, healthcare) where documentation
cannot leave the network perimeter, the options narrow to systems that run
entirely locally with no external calls. treenav and QMD both qualify.
treenav additionally makes no network calls of any kind — not even to
download models.

---

### 7. Code Navigation Competitors

treenav's code navigation competes with a set of MCP servers purpose-built
for source code. Key comparisons:

**vs Code-Index-MCP (ViperJuice):** The most architecturally similar code-only
tool. Uses SQLite FTS5 (BM25-based) and tree-sitter for 48 languages, with
optional Voyage AI embeddings. Richer language coverage and call-graph
tracking; no hierarchical tree navigation model, code-only (no markdown docs).

**vs mcp-server-tree-sitter (wrale):** Richest AST navigation — exposes raw
tree-sitter CSTs, symbol extraction, cyclomatic complexity, and dependency
analysis for 100+ languages. No BM25 ranking; agents can't search "rate limit
implementation" and get scored results. Complementary for deep structural
queries; treenav is better for relevance-ranked keyword search.

**vs Serena (oraios):** Best-in-class for language-server integration
(tree-sitter + optional LSP semantic data). Purpose-built for interactive
code editing assistance. No persistent BM25 index; no markdown doc support.

**vs ast-grep-mcp:** Structural *pattern* matching (find all `X.method()` calls
matching a shape) rather than keyword relevance ranking. Complementary —
use ast-grep-mcp for refactoring patterns, treenav for content search.

**The key differentiator:** treenav is the only tool that provides
BM25-ranked search *and* hierarchical tree navigation *across both markdown
docs and source code* in a single unified index. An agent searching "rate
limit" gets hits from your runbook docs, your API reference, and your
`RateLimitPolicyImpl` class implementation, all scored together — and via
`compile_context` it gets ranked hits partitioned by source (docs / code /
rows) plus outline trees for the top hits in a *single* tool call,
collapsing the typical search → tree → content loop.

---

### 8. mcp-server-filesystem — The "Do Nothing" Baseline

**Repo:** [modelcontextprotocol/servers — `src/filesystem`](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)
(official Anthropic reference server)

The official filesystem MCP server is what an agent gets when no retrieval
layer is installed at all. It exposes file-level primitives —
`read_text_file`, `read_multiple_files`, `list_directory`, `directory_tree`,
`search_files` (glob-only filename matching), plus write operations like
`edit_file` and `write_file`. There is no inverted index, no BM25 ranking,
no AST, no heading extraction. The agent must know the path it wants, or
walk the directory tree and read files speculatively to find content.

**vs treenav:**

- **Indexing model.** Filesystem MCP has none. treenav builds a positional
  inverted index plus a heading/symbol tree at startup.
- **Query model.** Filesystem MCP offers glob filename matching (`*.md`,
  `auth/**/*.ts`) and full-file reads. treenav offers BM25 keyword search,
  literal/regex grep over the indexed content, faceted filtering, and
  section-precise retrieval via `get_node_content`.
- **Embeddings.** Neither uses them.
- **Code/docs scope.** Filesystem MCP is content-agnostic — bytes are bytes.
  treenav understands markdown headings, source-code symbols (class,
  function, interface, etc.), and CSV/JSONL row keys.
- **MCP support.** Both are MCP servers. Filesystem MCP also exposes write
  tools by default; treenav is read-only.
- **Library use.** Filesystem MCP is server-only. treenav is also importable
  as a TypeScript library.
- **Latency.** Comparable for any single operation — both are local I/O.
  The difference shows up over a workflow: filesystem MCP forces the agent
  to read whole files (or guess), so a 10-call session burns far more tokens
  pulling unrelated content into context.
- **Install footprint.** Filesystem MCP is the lightest possible option
  (Node + the reference server). treenav requires Bun ≥ 1.3.8 and two npm
  dependencies (`@modelcontextprotocol/sdk`, `zod`).

**When to pick which.** Filesystem MCP is correct when an agent needs to
manipulate files by path — create, rename, edit by line range — and the
corpus is small enough that targeted reads don't waste context. treenav is
correct when the agent needs to *find* content by meaning rather than path,
or when retrieval precision matters across hundreds of files.

---

### 9. mcp-ripgrep / mcp-grep — Fast, Structureless Search

**Repos:** [mcollina/mcp-ripgrep](https://github.com/mcollina/mcp-ripgrep),
[247arjun/mcp-grep](https://github.com/247arjun/mcp-grep), and several
similar wrappers.

These servers expose the local `grep` or `ripgrep` binary as MCP tools
(`grep_files`, pattern + path + regex flags). Output mirrors `rg -n`:
a list of `path:line:matched-text` entries. There is no scoring, no
relevance ranking, no document or symbol model — every match is equally
weighted, returned in file order.

**vs treenav:**

- **Indexing model.** ripgrep wrappers have none — every query re-scans
  the filesystem. treenav indexes once at startup and holds a positional
  inverted index in memory.
- **Query model.** ripgrep wrappers offer literal and regex matching.
  treenav offers literal/regex grep (`grep_documents` — the same shape as
  `rg -n`) *and* BM25 ranked search on the same indexed content. Use grep
  when you know the exact symbol, error string, or CLI flag; use BM25
  when you want stemming, glossary expansion, and relevance ranking.
- **Embeddings.** Neither uses them.
- **Code/docs scope.** ripgrep wrappers treat all files as text and have
  no symbol/heading model. treenav builds heading trees for markdown,
  symbol trees for source code, and exposes both via `get_tree`,
  `find_symbol`, and `navigate_tree`.
- **MCP support.** Both are MCP servers.
- **Library use.** ripgrep wrappers are typically server-only.
  treenav is also importable as a library.
- **Latency.** ripgrep is famously fast on the cold filesystem; on a
  warmed-up cache, treenav's in-memory positional index returns ranked
  hits with snippets in 5-30ms without re-reading any file.
- **Install footprint.** ripgrep wrappers add ripgrep itself as an
  external dependency. treenav has two npm dependencies and a Bun runtime.

**When to pick which.** ripgrep MCP is the right tool when you want
literal-only matching, no index warm-up, and you're happy with file-order
results. treenav is the right tool when relevance ranking, structural
navigation, or unified docs+code search matter — and when you also want
literal grep available in the same server, treenav already includes it.

---

### 10. Sourcegraph Cody — The Industrial RAG Comparison

**Repo / product:** [Sourcegraph Cody](https://sourcegraph.com/cody),
[Cody docs](https://sourcegraph.com/docs/cody)

Cody is Sourcegraph's enterprise AI coding assistant. It pairs a hosted
or self-hosted Sourcegraph instance (the indexer + search backend) with
LLM-powered chat and edit. Historically Cody used vector embeddings for
context retrieval; Cody Enterprise has now [retired embeddings in favor
of Sourcegraph's classic Search API](https://sourcegraph.com/docs/cody/faq).
Cody supports cloud, self-hosted, and air-gapped deployments, and can
itself [call MCP servers](https://sourcegraph.com/changelog/mcp-context-gathering)
during agentic context gathering.

**vs treenav:**

- **Indexing model.** Cody relies on Sourcegraph's indexer, which builds
  a multi-repo code search index plus (optionally) embeddings. treenav
  builds an in-memory positional inverted index plus a heading/symbol
  tree, scoped to one configured root.
- **Query model.** Cody's pipeline mixes Sourcegraph's structural code
  search (regex, structural, lang-aware), embedding similarity (where
  enabled), LLM rewriting, and re-ranking. treenav uses BM25 + glossary
  expansion + facet filters, deterministically.
- **Embeddings.** Cody supports them on non-Enterprise tiers. treenav
  performs zero embedding work and downloads no models.
- **Code/docs scope.** Cody is code-first across many repos; docs come
  in via OpenCtx adapters or external systems. treenav is single-corpus
  (one tree), spanning markdown docs, source code, and CSV/JSONL in the
  same index.
- **MCP support.** Cody can act as an *MCP client* (it calls MCP servers
  including, in principle, treenav). It is not itself an MCP server.
- **Library use.** Cody is a product, not a library. treenav is both an
  MCP server and a TypeScript library.
- **Latency.** treenav is local and returns hits in 5-30ms. Cody's
  pipeline involves Sourcegraph backend search plus LLM inference; the
  per-call latency is dominated by the model.
- **Install footprint.** Cody requires a Sourcegraph deployment
  (cloud, self-hosted, or air-gapped) and a Cody license for enterprise
  features. treenav requires Bun and two npm dependencies.

**When to pick which.** Cody is the right answer for a multi-repo
enterprise that already wants the editor-integrated chat-and-edit flow,
SOC 2 / ISO 27001 procurement story, and is willing to operate a
Sourcegraph backend. treenav is the right answer for a single-repo or
single-corpus retrieval layer that should be fast, deterministic, and
free of model downloads — including, plausibly, as a local MCP tool that
Cody itself calls.

---

### 11. Aider's Repo Map — Token-Budget Codebase Summarization

**Reference:** [aider.chat — Repository map](https://aider.chat/docs/repomap.html),
[Building a better repo map with tree-sitter](https://aider.chat/2023/10/22/repomap.html)

Aider's repo map is not an MCP server — it is a feature inside the
[Aider](https://aider.chat) coding assistant. At each turn, Aider parses
the project with tree-sitter, builds a graph of symbol definitions and
references, runs personalized PageRank seeded with the files currently
in the chat (and any identifiers the user mentioned), then renders the
top-ranked definitions as elided "skeleton" code that fits inside a
token budget (default ~1k tokens via `--map-tokens`). The output is a
compact, ranked outline of the codebase that gets prepended to the prompt.

**vs treenav:**

- **Indexing model.** Both parse code into a symbol graph. Aider ranks
  symbols by PageRank against the live conversation context and re-ranks
  every turn. treenav indexes symbols once and ranks per-query via BM25
  against the user's keywords.
- **Query model.** Aider has no user-facing query — the "query" is
  implicit in what's open in chat. treenav exposes explicit
  `search_documents`, `find_symbol`, and `grep_documents` calls.
- **Embeddings.** Neither uses them.
- **Code/docs scope.** Aider's repo map is code-only. treenav covers
  markdown docs, source code, and structured data in one index.
- **MCP support.** Aider is a standalone agent, not an MCP server.
  Treenav is an MCP server (and a library).
- **Library use.** Aider's repo map logic has been ported into
  third-party libraries and MCP wrappers
  ([RepoMapper](https://github.com/pdavis68/RepoMapper),
  [repomap-mcp](https://lobehub.com/mcp/fl0w1nd-repomap-mcp)) but the
  upstream is part of Aider itself. treenav is published as an
  importable TypeScript library.
- **Latency.** Aider rebuilds the map every turn; the cost scales with
  graph size and PageRank iterations. treenav's per-query latency
  (5-30ms) is independent of corpus changes between queries.
- **Install footprint.** Aider pulls in tree-sitter for many languages,
  scipy/networkx for PageRank, and the rest of the Aider toolchain.
  treenav uses regex/indent-based parsers and has two npm dependencies.

**When to pick which.** Aider's repo map is the right design when the
goal is *prompt construction* — give the model a budgeted, conversation-
aware overview of the whole codebase before it asks a question. treenav
is the right design when the goal is *agentic retrieval* — let the agent
ask explicit questions ("find handlers that touch the rate limiter"),
get ranked answers with snippets, and pull only the sections it needs.
The two are complementary: an agent could feed an Aider-style overview
once, then use treenav for follow-up retrieval.

---

### 12. LlamaIndex TreeIndex — Tree Navigation in a Different Stack

**Reference:** [LlamaIndex Tree index API](https://docs.llamaindex.ai/en/stable/api_reference/indices/tree/),
[How each index works](https://docs.llamaindex.ai/en/stable/module_guides/indexing/index_guide/)

LlamaIndex's TreeIndex is one of the original tree-shaped retrieval
indexes. At index time it chunks the corpus, then recursively asks an
LLM to summarize children into parents until a single root remains.
At query time it traverses from the root downward, choosing one child
per level (`child_branch_factor=1`) or a fixed-width fan-out, with the
LLM picking the next branch. It is a Python library (LlamaIndex), not
an MCP server.

**vs treenav:**

- **Indexing model.** TreeIndex builds a *summarization* tree where
  every parent node is an LLM-generated summary of its children.
  treenav uses the *structural* tree that already exists in the
  corpus — markdown headings and code symbols — and computes no
  summaries. No LLM calls at any stage.
- **Query model.** TreeIndex routes by asking the LLM to pick the most
  relevant child at each level, descending until it hits a leaf.
  treenav routes by BM25 score: the agent (or a downstream LLM) sees a
  ranked outline and decides what to expand via `get_node_content`.
- **Embeddings.** TreeIndex doesn't require them but pairs with them
  in the broader LlamaIndex toolkit. treenav uses none.
- **Code/docs scope.** TreeIndex is corpus-agnostic but optimized for
  text documents. treenav covers markdown, code, and structured data.
- **MCP support.** TreeIndex has none — it is a Python library called
  inside an application. treenav is an MCP server *and* a library.
- **Library use.** Both are usable as libraries; LlamaIndex is Python,
  treenav is TypeScript.
- **Latency.** TreeIndex traversal cost is dominated by LLM calls per
  level (one model call per descent step). treenav navigation is local
  data-structure traversal in microseconds; the BM25 query that seeds
  it is 5-30ms.
- **Install footprint.** LlamaIndex is a large Python toolkit with many
  optional sub-packages. treenav has two npm dependencies and one Bun
  runtime.

**When to pick which.** TreeIndex is the right choice when summarization
*is* the value — you want the LLM to compose a hierarchical answer from
many leaves, and you accept LLM cost at both index and query time.
treenav is the right choice when the corpus already has structure
(headings, classes, functions), and the goal is to let the agent
*navigate* that structure cheaply rather than have an LLM re-derive it.
TreeIndex is the philosophical predecessor to the tree-navigation idea
in a heavier, LLM-driven stack; treenav is what falls out when you keep
the tree-navigation insight and remove the LLM from indexing and routing.

---

## Positioning

treenav occupies a specific niche: **structured local-first navigation
over documentation, source code, and structured row data (CSV/JSONL) in
a single index, with zero external dependencies.** It exposes a 9-tool
MCP surface — including a composed `compile_context` tool that returns
ranked hits partitioned by source plus outline trees in one call.

It trades:
- GitMCP's convenience for retrieval precision and offline capability
- PageIndex's LLM reasoning for zero-cost speed and simplicity
- QMD's semantic matching for zero-model-download operation
- Code-Index-MCP's tree-sitter precision for unified docs+code search
- Vector RAG's vocabulary independence for structural awareness

The 90% case — structured markdown docs and source code that agents need to
navigate efficiently — gets comparable retrieval quality at a fraction
of the cost, latency, and complexity.

The 10% where alternatives win: complex PDFs with cross-references
(PageIndex), semantic fuzzy matching across inconsistent terminology (QMD),
zero-setup access to any OSS project (GitMCP), deep language-server
semantics for code editing (Serena).

---

## Where to List treenav

Registries for MCP server visibility:

1. **GitHub MCP Registry** — [github.com/mcp](https://github.com/mcp) — Official GitHub-hosted registry
2. **mcpservers.org** — Submit at mcpservers.org/submit (wong2/awesome-mcp-servers web directory)
3. **punkpeye/awesome-mcp-servers** — [github.com/punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)
4. **appcypher/awesome-mcp-servers** — [github.com/appcypher/awesome-mcp-servers](https://github.com/appcypher/awesome-mcp-servers) — "Knowledge & Memory" category
5. **PulseMCP** — [pulsemcp.com](https://pulsemcp.com)
6. **Glama.ai** — [glama.ai/mcp/servers](https://glama.ai/mcp/servers)

---

## Methodology

All claims in this document were independently verified against source
repositories, README files, and published articles as of February 2026.
Star counts, feature claims, and architectural details were cross-checked
against actual code and documentation. Corrections from initial research:

- PageIndex main repo has 15,094 stars (not ~136 as initially reported;
  the MCP wrapper repo has 209)
- PageIndex offers local deployment via `npx`, not cloud-only
- GitMCP prioritizes `llms.txt` but falls back gracefully to README
  (not solely dependent on `llms.txt`)
- Context7 is community-contributed, not strictly curated
