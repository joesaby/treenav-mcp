# Competitive Landscape Research — Claude (May 2026)

> Research artifact captured verbatim. This is the Claude research draft
> received on 2026-05-07. Terminology (`treenav-mcp`, "five-tool workflow")
> reflects the source draft and is **not** synced with the authored
> [`COMPETITIVE-ANALYSIS.md`](../COMPETITIVE-ANALYSIS.md), which uses the
> current `treenav` name and 9-tool surface. Preserved as-is per the
> "document the research as it stands" directive.

---

# treenav-mcp — Competitive Landscape Analysis

_Last updated: May 2026 (graphify and semble added; other entries verified February 2026)_

This document positions treenav-mcp against the MCP document retrieval and
code navigation ecosystem. For architecture and attribution details, see
DESIGN.md.

## The Landscape

### Documentation retrieval

| Project | Approach | Stars | Local/Cloud | LLM at Index | LLM at Query |
|---------|----------|-------|-------------|--------------|--------------|
| treenav-mcp | BM25 + tree navigation | Early stage | Local | No | No |
| PageIndex (VectifyAI) | LLM tree search | 15K (lib) / 209 (MCP) | Both | Yes | Yes |
| QMD (Tobi Lütke) | BM25 + vectors + LLM reranker | — | Local | Yes (embeddings) | Yes (reranker) |
| graphify (safishamsi) | Knowledge graph + Leiden clustering | 41.6K | Local code, API for docs | Yes (docs/PDFs/images) | No |
| GitMCP (idosal) | GitHub proxy | 7.6K | Cloud | No | No |
| docs-mcp-server (arabold) | General indexer + optional embeddings | — | Local | Optional | Optional |
| MCP-Markdown-RAG (Zackriya) | Vector RAG over markdown (Milvus) | — | Local | Yes (embeddings) | No |
| Context7 (Upstash) | Pre-indexed OSS library docs | 45.7K | Cloud | — | — |

### Code navigation

| Project | Approach | Parser | BM25? | Tree nav? |
|---------|----------|--------|-------|-----------|
| treenav-mcp | Symbol index + BM25 + tree nav | Regex/indent AST | Yes | Yes |
| Code-Index-MCP (ViperJuice) | Symbol index + BM25 | tree-sitter (48 langs) | Yes (SQLite FTS5) | No |
| mcp-server-tree-sitter (wrale) | Live AST queries | tree-sitter (100+ langs) | No | No |
| Serena (oraios) | Symbol search + LSP integration | tree-sitter + LSP | No | No |
| ast-grep-mcp | Structural pattern matching | tree-sitter | No | No |
| graphify (safishamsi) | AST graph + LLM extraction + Leiden | tree-sitter (25 langs) | No | No (graph) |
| semble (MinishLab) | BM25 + static Model2Vec embeddings + RRF | Chonkie chunking | Yes | No |

treenav-mcp is the only tool in either table that covers both markdown documentation
and source code in a single BM25-indexed, tree-navigable corpus.

---

## Head-to-Head Comparisons

### 1. PageIndex — Closest Philosophical Cousin

**Repo:** VectifyAI/PageIndex (15,094 stars), VectifyAI/pageindex-mcp (209 stars)

PageIndex pioneered the tree navigation concept that treenav-mcp adopts.
Its Mafin 2.5 system achieved 98.7% accuracy on FinanceBench (VentureBeat),
a benchmark involving multi-hop queries over financial documents with
internal cross-references.

**How the architectures diverge:**

PageIndex uses LLM calls at both index time (GPT-4o builds tree structures
from PDFs, generates node summaries) and retrieval time (the LLM navigates
the tree to find relevant sections). treenav-mcp uses zero LLM calls at
either stage — markdown headings provide the tree for free, and BM25
handles ranking.

PageIndex offers three deployment modes: cloud API, cloud OAuth, and local
via npx. It is not cloud-only, but its recommended path involves API keys
and hosted infrastructure.

**Where PageIndex wins:**

- Complex multi-hop queries on professional documents with heavy
  cross-referencing (financial reports, legal contracts). The LLM reasons
  within the retrieval pipeline, following breadcrumbs across sections.
- PDF documents where structure must be inferred rather than parsed.

**Where treenav-mcp wins:**

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

**Repo:** tobi/qmd — by Tobias Lütke (Shopify CEO)

QMD runs a three-stage hybrid pipeline locally: BM25 via SQLite FTS5,
vector semantic search via embeddings, and LLM re-ranking via a fine-tuned
Qwen reranker. All models run locally via node-llama-cpp with GGUF files
(~2GB total: 300MB embeddings, 640MB reranker, 1.1GB query expansion).
Supports both stdio and HTTP MCP transports.

**Where QMD wins:**

- Semantic matching. A search for "how to handle expired credentials" will
  find docs about "token refresh flow" because vector similarity bridges
  the vocabulary gap. treenav-mcp's BM25 with stemming and prefix matching
  will partially bridge this, but cannot make the semantic leap.
- Single-query precision. The BM25 + vector + reranker pipeline gives QMD
  the best accuracy on any individual question.

**Where treenav-mcp wins:**

- No model downloads. QMD requires ~2GB of GGUF models on first run.
  treenav-mcp has two npm dependencies.
- No GPU/CPU inference overhead. QMD loads models into memory (hundreds of
  MB to GB). treenav-mcp uses ~25-50MB for 900 docs.
- Structure awareness. QMD returns ranked chunks — the agent gets answers
  but cannot browse document structure, reason about section hierarchy, or
  selectively retrieve branches. For multi-step reasoning over a document's
  architecture, tree navigation outperforms flat chunk retrieval.
- Speed. QMD's hybrid pipeline involves model inference at query time.
  treenav-mcp returns in 5-30ms.

**Honest assessment:** QMD has better search recall for fuzzy/semantic
queries. treenav-mcp has better agent workflow support via tree navigation.
They optimize for different things — if your docs use consistent
terminology, BM25 is sufficient and the tree navigation advantage matters
more. If your queries frequently use different vocabulary than your docs,
QMD's semantic search is genuinely valuable.

---

### 3. GitMCP — Zero-Friction OSS Access

**Repo:** idosal/git-mcp (7,600 stars)

GitMCP is a cloud-hosted MCP server on Cloudflare Workers at gitmcp.io.
Paste a URL into your MCP config and it works immediately — no cloning,
no indexing, no installation. It fetches docs from any public GitHub repo
on the fly, prioritizing llms.txt (falling back to README and GitHub
Pages content). Has four tools including search_code via GitHub's
code search API.

**Where GitMCP wins:**

- Zero setup. Unbeatable time-to-value for quick questions about any
  OSS project.
- Breadth. Works on any public GitHub repo instantly. The generic endpoint
  (gitmcp.io/docs) lets the agent pick the repo dynamically.
- No local clone needed. GitMCP works directly against the GitHub API.

**Where treenav-mcp wins:**

- Retrieval quality. GitMCP has no inverted index, no relevance scoring,
  no ranking. If a project lacks llms.txt (most don't), the agent gets
  a README blob. treenav-mcp builds a proper BM25-scored index with
  positional data and density-based snippets.
- Structure. GitMCP has no concept of heading hierarchy or section-level
  retrieval. It delivers flat content — "here's the doc." treenav-mcp lets
  the agent see [n4] ## Token Refresh Flow (180 words) and decide
  whether to pull it.
- Token efficiency. GitMCP often dumps full pages into context (10-20K+
  tokens of unfiltered content). treenav-mcp lets the agent budget tokens
  by picking exact sections (2-8K tokens of precise content).
- **Private and enterprise docs.** GitMCP explicitly states it "only
  accesses content that is already publicly available." No authentication,
  no support for GitHub Enterprise Server behind VPN/firewall. treenav-mcp
  works entirely offline on any markdown on disk.
- Latency. 5-30ms local vs network round-trips to GitHub's API, subject
  to rate limits.

**Honest assessment:** These aren't really competing for the same user.
GitMCP solves discovery (quickly get context on any OSS project).
treenav-mcp solves precision retrieval (navigate and extract exactly what
you need from a known corpus). An engineer might use GitMCP to explore a
new library, then switch to treenav-mcp once that library's docs become
part of their daily workflow.

---

### 4. docs-mcp-server — General-Purpose Doc Indexer

**Repo:** arabold/docs-mcp-server

Self-described "open-source alternative to Context7, Nia, and Ref.Tools."
Indexes websites, GitHub repos, local folders. Supports HTML, Markdown,
PDF, Word, Excel, PowerPoint, and source code. Optionally uses embeddings
(OpenAI, Ollama, Gemini, Azure, Bedrock) for semantic search.

**Where docs-mcp-server wins:**

- Format breadth. Handles PDF, Word, Excel, PowerPoint, remote URLs, and
  GitHub repos — treenav-mcp covers markdown and source code files.
- Optional semantic search via configurable embedding providers.

**Where treenav-mcp wins:**

- Tree navigation. docs-mcp-server is traditional RAG via MCP — chunks
  and retrieval, no heading hierarchy or structural reasoning.
- Zero external dependencies. docs-mcp-server's semantic search requires
  an embedding provider (API keys, model configuration). Without
  embeddings, its search quality drops significantly.
- Purpose-built vs general-purpose. treenav-mcp's five-tool workflow is
  designed specifically for how agents reason over documentation structure.

---

### 5. MCP-Markdown-RAG — Classic Vector RAG Baseline

**Repo:** Zackriya-Solutions/MCP-Markdown-RAG

Standard vector-based semantic search over markdown files using a
file-based Milvus vector database. Chunks documents, computes embeddings
(~50MB model downloaded on first run), stores in Milvus, retrieves by
cosine similarity.

This represents the "standard RAG" approach that treenav-mcp explicitly
contrasts against. The trade-off is straightforward: MCP-Markdown-RAG
gets semantic matching (vocabulary-independent similarity) at the cost
of chunking artifacts (losing document structure), embedding overhead,
and a vector database dependency. treenav-mcp gets structural awareness
and zero-dependency speed at the cost of keyword-only matching.

---

### 6. Context7 — Pre-Indexed OSS Library Docs

**Repo:** upstash/context7 (45,700 stars, #3 MCP server globally)

Cloud-hosted, community-contributed registry of pre-indexed open-source
library documentation (Next.js, MongoDB, Supabase, etc.). Completely
different use case — Context7 solves "give me the latest framework docs"
while treenav-mcp solves "let an agent navigate my documentation."

Context7 cannot index private or internal documentation. Its backend
(API, parsing, crawling) is proprietary and not open source. It is
complementary rather than competitive.

---

## Cross-Cutting Analysis

### Agentic Query Performance

How each system performs across different query patterns:

| Query Type | Best | Runner-up | Notes |
|------------|------|-----------|-------|
| Well-structured markdown docs | treenav-mcp ≈ PageIndex | QMD | Tree navigation compensates for BM25-only search |
| Complex PDFs with cross-references | PageIndex ≈ graphify | treenav-mcp | LLM reasoning follows breadcrumbs across sections |
| Fuzzy/semantic queries (code) | semble | QMD | Static embeddings on CPU vs full hybrid pipeline |
| Fuzzy/semantic queries (docs) | QMD | PageIndex | Vector search bridges vocabulary gaps |
| Agent autonomy (browsing + deciding) | treenav-mcp ≈ PageIndex | graphify | QMD/GitMCP/semble lack tree navigation entirely |
| Multi-step workflow (10+ tool calls) | treenav-mcp ≈ semble | PageIndex | 5-30ms vs LLM inference latency per call |
| Architectural overview ("god nodes", concept maps) | graphify | — | Graph + community detection is uniquely suited here |

### The BM25 Limitation — An Honest Acknowledgment

BM25-only search is treenav-mcp's main vulnerability. If someone searches
"how to handle expired credentials" but the docs say "token refresh flow,"
BM25 with stemming and prefix matching will partially bridge the gap but
cannot make the semantic connection that QMD's vector search would.

This matters less than it might seem for the target use case (structured
markdown docs that the user controls), because:

1. Documentation authors tend to use consistent terminology
2. The agent can browse the tree to discover sections by title
3. Prefix matching catches many partial-term overlaps
4. The five-tool workflow lets the agent iterate (search → browse → refine)

But for corpora with inconsistent terminology or natural-language queries
from users unfamiliar with the docs' vocabulary, this is a real gap.

semble's static Model2Vec embeddings represent an interesting middle path
on this axis: semantic matching at CPU-only cost, no GPU and no transformer
forward pass at query time. The treenav-mcp design could in principle
adopt a similar static-embedding signal as a side index without giving up
the tree navigation, BM25 ranking, or zero-model-download properties — at
the cost of one ~16M-parameter model file (~60MB on disk). This is noted
as a possible future direction, not a current capability.

### Large Volume Scaling

| System | 900 docs | 5,000 docs (est.) | 10,000+ docs (est.) |
|--------|----------|-------------------|---------------------|
| treenav-mcp | 2-5s, 0 LLM tokens | ~15-25s (linear) | ~30-50s |
| semble | <1s (CPU only) | ~few seconds | Linear, CPU-bound |
| PageIndex | Minutes (LLM calls per doc) | Expensive | Impractical without caching |
| QMD | Minutes (model loading + embedding) | 10-30 min | Scales with model inference |
| graphify | Minutes-hours (LLM calls per non-code file) | Expensive on first run; cached after | Cache-dominated |
| docs-mcp-server | Varies (depends on embedding provider) | Varies | Varies |

treenav-mcp's zero-LLM, zero-embedding indexing is among the most scalable
of the group, alongside semble's static-embedding approach. The known
boundary: the positional inverted index lives entirely in memory. At
10,000+ documents with hundreds of thousands of sections, this could grow
to several hundred MB. The scaling path
(see DESIGN.md) acknowledges this and maps
tiers from in-memory to SQLite FTS5 to chunked indexes.

### Token Efficiency

For the same retrieval task, total tokens consumed (index + retrieval):

| System | Index tokens | Per-query tokens | Agent workflow (10 calls) |
|--------|--------------|------------------|---------------------------|
| treenav-mcp | 0 | ~300-1K | ~3K-10K |
| semble | 0 (CPU embeddings) | 0 (CPU embeddings) | 0 (CPU embeddings) |
| PageIndex | Thousands per doc | Hundreds-thousands (LLM reasoning) | ~10K-50K+ |
| QMD | 0 (local models) | 0 (local models) | 0 (local models) |
| graphify | Thousands per non-code file (first run only, cached after) | 0 (graph traversal) | Index-time cost only |
| GitMCP | 0 | ~10K-20K (full pages dumped) | ~100K-200K |

QMD and semble both win on token cost since they use local models with
zero API tokens, but at the cost of model files on disk (~2GB for QMD,
~60MB for semble). treenav-mcp is the most token-efficient system that
doesn't require downloading any ML models at all. graphify amortizes
its index-time LLM cost: expensive once, free after caching.

### The Enterprise Blind Spot

Most popular MCP doc servers assume public access:

| System | Private repos | Enterprise GitHub | Offline | No data leaves perimeter |
|--------|---------------|-------------------|---------|--------------------------|
| treenav-mcp | Yes | Yes | Yes | Yes |
| semble | Yes | Yes | Yes | Yes |
| QMD | Yes | Yes | Yes | Yes |
| PageIndex | Via local mode | Via local mode | Via local mode | Via local mode |
| graphify | Yes (code-only) | Yes (code-only) | Code yes; docs require API call | No (docs/PDFs/images go to your AI provider) |
| GitMCP | No | No | No | No |
| docs-mcp-server | Local mode only | Local mode only | Local mode only | Depends on config |
| Context7 | No | No | No | No |

For regulated industries (telecom, finance, healthcare) where documentation
cannot leave the network perimeter, the options narrow to systems that run
entirely locally with no external calls. treenav-mcp, semble, and QMD all
qualify. treenav-mcp additionally makes no network calls of any kind — not
even to download models. graphify is an interesting partial case: code is
extracted locally with tree-sitter, but doc/PDF/image extraction uses your
configured AI provider, which means the prose layer leaves the perimeter
even though the code does not.

---

### 7. Code Navigation Competitors

treenav-mcp's code navigation competes with a set of MCP servers purpose-built
for source code. Key comparisons:

**vs Code-Index-MCP (ViperJuice):** The most architecturally similar code-only
tool. Uses SQLite FTS5 (BM25-based) and tree-sitter for 48 languages, with
optional Voyage AI embeddings. Richer language coverage and call-graph
tracking; no hierarchical tree navigation model, code-only (no markdown docs).

**vs mcp-server-tree-sitter (wrale):** Richest AST navigation — exposes raw
tree-sitter CSTs, symbol extraction, cyclomatic complexity, and dependency
analysis for 100+ languages. No BM25 ranking; agents can't search "rate limit
implementation" and get scored results. Complementary for deep structural
queries; treenav-mcp is better for relevance-ranked keyword search.

**vs Serena (oraios):** Best-in-class for language-server integration
(tree-sitter + optional LSP semantic data). Purpose-built for interactive
code editing assistance. No persistent BM25 index; no markdown doc support.

**vs ast-grep-mcp:** Structural pattern matching (find all X.method() calls
matching a shape) rather than keyword relevance ranking. Complementary —
use ast-grep-mcp for refactoring patterns, treenav-mcp for content search.

**The key differentiator:** treenav-mcp is the only tool that provides
BM25-ranked search and hierarchical tree navigation across both markdown
docs and source code in a single unified index. An agent searching "rate
limit" gets hits from your runbook docs, your API reference, and your
RateLimitPolicyImpl class implementation, all scored together.

---

### 8. mcp-server-filesystem — The "Do Nothing" Baseline

**Repo:** modelcontextprotocol/servers — src/filesystem
(official Anthropic reference server)

The official filesystem MCP server is what an agent gets when no retrieval
layer is installed at all. It exposes file-level primitives —
read_text_file, read_multiple_files, list_directory, directory_tree,
search_files (glob-only filename matching), plus write operations like
edit_file and write_file. There is no inverted index, no BM25 ranking,
no AST, no heading extraction. The agent must know the path it wants, or
walk the directory tree and read files speculatively to find content.

**vs treenav:**

- **Indexing model.** Filesystem MCP has none. treenav builds a positional
  inverted index plus a heading/symbol tree at startup.
- **Query model.** Filesystem MCP offers glob filename matching (*.md,
  auth/**/*.ts) and full-file reads. treenav offers BM25 keyword search,
  literal/regex grep over the indexed content, faceted filtering, and
  section-precise retrieval via get_node_content.
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
  dependencies (@modelcontextprotocol/sdk, zod).

**When to pick which.** Filesystem MCP is correct when an agent needs to
manipulate files by path — create, rename, edit by line range — and the
corpus is small enough that targeted reads don't waste context. treenav is
correct when the agent needs to find content by meaning rather than path,
or when retrieval precision matters across hundreds of files.

---

### 9. mcp-ripgrep / mcp-grep — Fast, Structureless Search

**Repos:** mcollina/mcp-ripgrep, 247arjun/mcp-grep, and several similar wrappers.

These servers expose the local grep or ripgrep binary as MCP tools
(grep_files, pattern + path + regex flags). Output mirrors rg -n:
a list of path:line:matched-text entries. There is no scoring, no
relevance ranking, no document or symbol model — every match is equally
weighted, returned in file order.

**vs treenav:**

- **Indexing model.** ripgrep wrappers have none — every query re-scans
  the filesystem. treenav indexes once at startup and holds a positional
  inverted index in memory.
- **Query model.** ripgrep wrappers offer literal and regex matching.
  treenav offers literal/regex grep (grep_documents — the same shape as
  rg -n) and BM25 ranked search on the same indexed content. Use grep
  when you know the exact symbol, error string, or CLI flag; use BM25
  when you want stemming, glossary expansion, and relevance ranking.
- **Embeddings.** Neither uses them.
- **Code/docs scope.** ripgrep wrappers treat all files as text and have
  no symbol/heading model. treenav builds heading trees for markdown,
  symbol trees for source code, and exposes both via get_tree,
  find_symbol, and navigate_tree.
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

**Repo / product:** Sourcegraph Cody, Cody docs

Cody is Sourcegraph's enterprise AI coding assistant. It pairs a hosted
or self-hosted Sourcegraph instance (the indexer + search backend) with
LLM-powered chat and edit. Historically Cody used vector embeddings for
context retrieval; Cody Enterprise has now retired embeddings in favor
of Sourcegraph's classic Search API. Cody supports cloud, self-hosted,
and air-gapped deployments, and can itself call MCP servers during
agentic context gathering.

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
- **MCP support.** Cody can act as an MCP client (it calls MCP servers
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

**Reference:** aider.chat — Repository map, Building a better repo map with tree-sitter

Aider's repo map is not an MCP server — it is a feature inside the
Aider coding assistant. At each turn, Aider parses the project with
tree-sitter, builds a graph of symbol definitions and references, runs
personalized PageRank seeded with the files currently in the chat (and
any identifiers the user mentioned), then renders the top-ranked
definitions as elided "skeleton" code that fits inside a token budget
(default ~1k tokens via --map-tokens). The output is a compact, ranked
outline of the codebase that gets prepended to the prompt.

**vs treenav:**

- **Indexing model.** Both parse code into a symbol graph. Aider ranks
  symbols by PageRank against the live conversation context and re-ranks
  every turn. treenav indexes symbols once and ranks per-query via BM25
  against the user's keywords.
- **Query model.** Aider has no user-facing query — the "query" is
  implicit in what's open in chat. treenav exposes explicit
  search_documents, find_symbol, and grep_documents calls.
- **Embeddings.** Neither uses them.
- **Code/docs scope.** Aider's repo map is code-only. treenav covers
  markdown docs, source code, and structured data in one index.
- **MCP support.** Aider is a standalone agent, not an MCP server.
  Treenav is an MCP server (and a library).
- **Library use.** Aider's repo map logic has been ported into
  third-party libraries and MCP wrappers (RepoMapper, repomap-mcp) but
  the upstream is part of Aider itself. treenav is published as an
  importable TypeScript library.
- **Latency.** Aider rebuilds the map every turn; the cost scales with
  graph size and PageRank iterations. treenav's per-query latency
  (5-30ms) is independent of corpus changes between queries.
- **Install footprint.** Aider pulls in tree-sitter for many languages,
  scipy/networkx for PageRank, and the rest of the Aider toolchain.
  treenav uses regex/indent-based parsers and has two npm dependencies.

**When to pick which.** Aider's repo map is the right design when the
goal is prompt construction — give the model a budgeted, conversation-
aware overview of the whole codebase before it asks a question. treenav
is the right design when the goal is agentic retrieval — let the agent
ask explicit questions ("find handlers that touch the rate limiter"),
get ranked answers with snippets, and pull only the sections it needs.
The two are complementary: an agent could feed an Aider-style overview
once, then use treenav for follow-up retrieval.

---

### 12. LlamaIndex TreeIndex — Tree Navigation in a Different Stack

**Reference:** LlamaIndex Tree index API, How each index works

LlamaIndex's TreeIndex is one of the original tree-shaped retrieval
indexes. At index time it chunks the corpus, then recursively asks an
LLM to summarize children into parents until a single root remains.
At query time it traverses from the root downward, choosing one child
per level (child_branch_factor=1) or a fixed-width fan-out, with the
LLM picking the next branch. It is a Python library (LlamaIndex), not
an MCP server.

**vs treenav:**

- **Indexing model.** TreeIndex builds a summarization tree where every
  parent node is an LLM-generated summary of its children. treenav uses
  the structural tree that already exists in the corpus — markdown
  headings and code symbols — and computes no summaries. No LLM calls
  at any stage.
- **Query model.** TreeIndex routes by asking the LLM to pick the most
  relevant child at each level, descending until it hits a leaf.
  treenav routes by BM25 score: the agent (or a downstream LLM) sees a
  ranked outline and decides what to expand via get_node_content.
- **Embeddings.** TreeIndex doesn't require them but pairs with them
  in the broader LlamaIndex toolkit. treenav uses none.
- **Code/docs scope.** TreeIndex is corpus-agnostic but optimized for
  text documents. treenav covers markdown, code, and structured data.
- **MCP support.** TreeIndex has none — it is a Python library called
  inside an application. treenav is an MCP server and a library.
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
is the value — you want the LLM to compose a hierarchical answer from
many leaves, and you accept LLM cost at both index and query time.
treenav is the right choice when the corpus already has structure
(headings, classes, functions), and the goal is to let the agent
navigate that structure cheaply rather than have an LLM re-derive it.
TreeIndex is the philosophical predecessor to the tree-navigation idea
in a heavier, LLM-driven stack; treenav is what falls out when you keep
the tree-navigation insight and remove the LLM from indexing and routing.

---

### 13. graphify — Graph Navigation, Not Tree Navigation

**Repo:** safishamsi/graphify (41,600 stars), graphify.net, PyPI: graphifyy

Graphify is the most prominent project in the adjacent "give the agent a
map of the codebase" space. It runs as a slash-command skill inside AI
coding assistants (/graphify . in Claude Code, Codex, Cursor, OpenCode,
and many others), but also exposes an MCP stdio server (--mcp flag, or
python -m graphify.serve graphify-out/graph.json) with the tools
query_graph, get_node, get_neighbors, and shortest_path.

The pipeline has two passes. Pass 1 is local: tree-sitter parses 25
languages into AST nodes (functions, classes, imports, calls) with no
LLM and no network call — these edges carry the EXTRACTED confidence
tag. Pass 2 sends docs, PDFs, images, and (with extras) audio/video
transcripts through the configured LLM for semantic concept extraction —
these edges carry INFERRED or AMBIGUOUS tags. Pass 3 runs Leiden
community detection over the merged graph and produces a GRAPH_REPORT.md
highlighting "god nodes" (most-connected concepts), "surprising
connections" (cross-module links), and design rationale extracted from
# WHY: / # NOTE: comments and docstrings.

**vs treenav:**

- **Indexing model.** Graphify builds a graph (node/edge with confidence
  tags), partitioned into Leiden communities. treenav builds a tree
  (heading hierarchy for markdown, symbol hierarchy for source) plus a
  flat positional inverted index for BM25.
- **Query model.** Graphify answers via graph traversal: shortest path
  between two nodes, neighbors of a node, communities a node belongs to,
  natural-language queries that the assistant translates into graph walks.
  treenav answers via BM25-ranked search, structural tree navigation, and
  literal/regex grep — no graph traversal.
- **Embeddings.** Neither tool uses vector embeddings as a retrieval
  signal. Graphify's "semantic" layer is LLM-extracted relationships,
  not embeddings; treenav's matching is BM25 + stemming + prefix.
- **Code/docs scope.** Both span code and docs, but graphify also handles
  PDFs, images (via vision models), and transcribed audio/video. treenav
  covers markdown, source code, and CSV/JSONL.
- **MCP support.** Both are MCP servers. Graphify's tools are graph
  primitives; treenav's are search/navigate primitives.
- **Library use.** Both are also importable libraries (graphify in
  Python, treenav in TypeScript).
- **Latency.** Graphify's index build cost is dominated by the LLM pass
  on non-code files (minutes to hours on first run for a doc-heavy repo,
  cached afterward). At query time graph traversal is local and fast.
  treenav indexes in 2-5s for ~900 docs with zero LLM calls and queries
  in 5-30ms.
- **Privacy.** Graphify's code stays local (tree-sitter); its non-code
  extraction sends doc/PDF/image content to your configured AI provider
  using your API key. treenav makes zero network calls of any kind.
- **Install footprint.** Graphify pulls in Python 3.10+, tree-sitter for
  25 languages, NetworkX, Leiden clustering, faster-whisper for audio,
  and (with extras) office/PDF/video parsers. treenav has two npm
  dependencies and a Bun runtime.

**Honest assessment:** These tools answer different questions. Graphify
is at its best when you ask "what does this codebase look like" — it
produces a navigable map with surprising cross-module connections,
extracted design rationale, and community structure that an agent
(or human) can browse top-down. treenav is at its best when the agent
already has a question ("where do we handle expired tokens") and needs
ranked, section-precise answers cheaply and offline. The two are
complementary in the sense that an agent could load graphify's
GRAPH_REPORT.md once for orientation and then use treenav for the
fast retrieval loop — graphify's own issue #146 discusses exactly this
kind of layered usage.

The honest disadvantage of graphify for treenav's target user: the
non-code LLM pass means cost, latency, and a network egress on first
ingest, and the graph model offers no relevance-ranked keyword search.
The honest disadvantage of treenav for graphify's target user: no
explicit cross-module relationship modeling, no community structure,
no insight into why code was written that way.

---

### 14. semble — Static Embeddings on CPU

**Repo:** MinishLab/semble (4 stars, v0.1.0 released April 2026), PyPI: semble

Semble is the closest direct architectural cousin to treenav-mcp on the
code-search axis. It runs as an MCP server with two tools — search
and find_related — and indexes either a local path or a remote git URL
(cloned on demand, indexes cached for the session). The pitch is "QMD-like
hybrid retrieval, but on CPU with no transformer at query time."

The retrieval stack: code-aware chunking via Chonkie, then two parallel
scorers — BM25 over identifiers and tokens (via bm25s), and static
Model2Vec embeddings using the code-specialized potion-code-16M model
for semantic similarity. The two ranked lists are fused with Reciprocal
Rank Fusion (RRF), then reranked with code-aware signals: adaptive
weighting that shifts toward lexical for symbol-like queries (Foo::bar,
_private, getUserById) and balanced for natural-language queries;
definition boosts (a def/class/func of the queried symbol outranks
references); identifier-stem matching (parse config boosts parseConfig,
ConfigParser, config_parser); file coherence boosts when multiple
chunks from one file match; noise penalties for test/legacy/example/.d.ts
files. The published benchmark over 1,250 queries on 63 repos in 19
languages: 0.854 NDCG@10, 263 ms cold index, 1.5 ms median query — claimed
99% of a 137M-parameter code-specialized transformer's quality at 218×
faster indexing and 11× faster queries.

**vs treenav:**

- **Indexing model.** Semble chunks files with Chonkie and builds a
  parallel BM25 + static-embedding index, fused at query time with RRF.
  treenav builds a positional inverted index plus a heading/symbol tree.
  Semble has no symbol or heading hierarchy; treenav has no embedding
  layer.
- **Query model.** Both expose BM25-style keyword scoring. Semble adds
  static embedding similarity (semantic matching that bridges vocabulary
  gaps) and a code-aware reranker. treenav adds tree navigation,
  faceted filters, and section-precise retrieval via get_node_content.
- **Embeddings.** Semble uses ~16M-parameter static embeddings (~60MB
  on disk, no transformer forward pass at query time). treenav uses none.
- **Code/docs scope.** Semble is code-only. treenav covers markdown
  docs, source code, and CSV/JSONL in one index.
- **MCP support.** Both are MCP servers. Semble's tools are search and
  find_related; treenav exposes a five-tool workflow.
- **Library use.** Both are also importable libraries (semble in Python,
  treenav in TypeScript).
- **Latency.** Both target sub-second indexing for moderate corpora and
  single-digit-millisecond queries. Semble's published numbers are 263ms
  cold index and 1.5ms p50 query; treenav's are 2-5s for ~900 docs and
  5-30ms per query. Semble is faster on small corpora; the curves likely
  cross somewhere depending on corpus shape.
- **Install footprint.** Semble pulls in Python, Chonkie, model2vec, the
  potion-code-16M model file, bm25s, and a git binary for remote URLs.
  treenav has two npm dependencies and a Bun runtime.

**Honest assessment:** Semble is the strongest existing argument that the
"BM25 + cheap semantic" sweet spot can be reached without a GPU, an API
key, or a 2GB model download. On code-only search, semble plausibly beats
treenav-mcp's BM25-only matching whenever the query and the docs use
different vocabulary — and its published NDCG@10 of 0.854 is a credible
quality bar to compare against.

Where treenav-mcp still wins on code: the heading/symbol tree lets the
agent browse a file's structure, expand a class to see its methods, and
pull a specific section without re-querying. Semble returns ranked chunks
with find_related for follow-up exploration, which is a different
interaction model. And critically, treenav-mcp ranks markdown docs and
source code in the same index — semble does not index docs at all, so
a "rate limit" search returns code chunks only, never the runbook.

If treenav-mcp ever adopts a static-embedding side index (see "The BM25
Limitation" above), semble's potion-code-16M and the Model2Vec family
are the obvious reference points.

---

## Positioning

treenav-mcp occupies a specific niche: structured local-first navigation
over both documentation and source code, with zero external dependencies.

It trades:

- GitMCP's convenience for retrieval precision and offline capability
- PageIndex's LLM reasoning for zero-cost speed and simplicity
- QMD's semantic matching for zero-model-download operation
- Code-Index-MCP's tree-sitter precision for unified docs+code search
- Vector RAG's vocabulary independence for structural awareness
- graphify's knowledge-graph richness for ranked keyword search and
  zero-LLM-at-index-time operation
- semble's static-embedding semantic matching for tree navigation and
  unified docs+code coverage

The 90% case — structured markdown docs and source code that agents need to
navigate efficiently — gets comparable retrieval quality at a fraction
of the cost, latency, and complexity.

The 10% where alternatives win: complex PDFs with cross-references
(PageIndex), semantic fuzzy matching across inconsistent terminology in
docs (QMD), zero-setup access to any OSS project (GitMCP), deep
language-server semantics for code editing (Serena), architectural
overviews and "surprising connections" across a multi-modal codebase
(graphify), code-only fuzzy matching at CPU speeds (semble).

---

## Where to List treenav-mcp

Registries for MCP server visibility:

1. GitHub MCP Registry — github.com/mcp — Official GitHub-hosted registry
2. mcpservers.org — Submit at mcpservers.org/submit (wong2/awesome-mcp-servers web directory)
3. punkpeye/awesome-mcp-servers — github.com/punkpeye/awesome-mcp-servers
4. appcypher/awesome-mcp-servers — github.com/appcypher/awesome-mcp-servers — "Knowledge & Memory" category
5. PulseMCP — pulsemcp.com
6. Glama.ai — glama.ai/mcp/servers

---

## Methodology

All claims in this document were independently verified against source
repositories, README files, and published articles. Star counts, feature
claims, and architectural details were cross-checked against actual code
and documentation. Original entries (sections 1-12) were verified in
February 2026; sections 13 (graphify) and 14 (semble) were added and
verified in May 2026. Corrections from initial research:

- PageIndex main repo has 15,094 stars (not ~136 as initially reported;
  the MCP wrapper repo has 209)
- PageIndex offers local deployment via npx, not cloud-only
- GitMCP prioritizes llms.txt but falls back gracefully to README
  (not solely dependent on llms.txt)
- Context7 is community-contributed, not strictly curated
- Graphify's PyPI package is graphifyy (double-y); CLI command is
  graphify. Code extraction is fully local via tree-sitter, but doc/
  PDF/image semantic extraction calls the user's configured AI provider —
  graphify is "local for code, online for prose"
- Semble's published benchmark is on 1,250 queries across 63 repositories
  in 19 languages; the cited 0.854 NDCG@10 is at the project's own
  evaluation, not an independent third-party benchmark
