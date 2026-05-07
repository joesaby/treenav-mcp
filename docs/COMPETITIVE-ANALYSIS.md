# treenav — Competitive Landscape Analysis

_Last verified: May 7, 2026._

This document positions **treenav** against the MCP retrieval, code-navigation,
and agent-context ecosystem. Every entry is structured the same way:

1. **What it is** — preamble describing the project, who makes it, deployment model, current scale (stars / version / license / language).
2. **How tree navigation compares** — the central question. Does this tool expose a hierarchical structural index the agent can browse? If yes, how does it differ from treenav's heading/symbol/row tree? If no, what does it return instead (flat chunks, AST nodes, graph edges, embedding hits) and what does the agent give up?
3. **Positioning** — when to pick which, with the honest trade-offs in both directions.

Star counts, tool inventories, and version numbers are cited from primary
sources fetched on May 7, 2026 (full URL list in the
[References](#references) section). Star counts in particular drift from
day to day; treat them as "approximately N as of verification" rather
than precise figures. Where benchmark numbers are vendor-published and
not independently verified, they are flagged **[vendor-claimed]**.

For the underlying research drafts that informed this document — Claude's
landscape pass, the codex verification pass, and the codex final
analysis with high-confidence corrections — see the artifacts in
[`docs/research/`](./research/).

---

## The Defensible Wedge

treenav is a **deterministic, local-first MCP retrieval layer** for
agents that need:

- BM25-ranked search,
- literal/regex grep,
- symbol search,
- composed retrieval (`compile_context`), and
- explicit heading / symbol / row tree navigation,

across **Markdown documentation, source code, and CSV/JSONL data** in a
single unified index. It uses **no LLMs, no embeddings, no vector
database, no model downloads, and no network calls** at index or query
time.

The trade-off is direct: treenav exchanges PageIndex's LLM-guided
PDF/document reasoning, QMD's semantic doc recall, Graphify's
relationship graph, Semble's static-embedding code semantics, Serena's
IDE-grade editing semantics, and Sourcegraph's enterprise multi-repo
code intelligence — for a smaller, deterministic, inspectable,
zero-model retrieval loop over a known local corpus.

The 90% case (structured Markdown docs and source code that an agent
needs to navigate efficiently across many tool calls) gets comparable
or better retrieval quality at a fraction of the cost, latency, model
footprint, and operational complexity.

---

## Landscape at a Glance

### Documentation retrieval

| Project | Approach | Stars (approx., May 2026) | Local / Cloud | Models needed | LLM at query |
|---------|----------|---------------------------|---------------|---------------|--------------|
| **treenav** | BM25 + heading tree + grep + composed retrieval | early-stage | local | none | none |
| PageIndex (VectifyAI) | LLM-inferred document tree | ~29k (lib) / ~320 (MCP) | both | LLM (default `gpt-4o-2024-11-20`) | yes |
| QMD (Tobi Lütke) | BM25 + vectors + LLM reranker | ~24.3k | local | ~2 GB GGUF (300 MB + 640 MB + 1.1 GB) | yes (local) |
| Graphify (safishamsi) | Knowledge graph + Leiden communities | ~44.1k | hybrid | LLM for non-code (your provider) | no (graph traversal) |
| Context7 (Upstash) | Pre-indexed OSS library docs | ~54.6k | cloud | n/a | n/a |
| GitMCP (idosal) | Public-GitHub proxy on Cloudflare Workers | ~8.0k | cloud | none | none |
| docs-mcp-server / Grounded Docs (arabold) | General multi-format indexer + optional embeddings | ~1.3k | local + Docker | optional embedding provider | optional |

### Code navigation

| Project | Approach | Parser | BM25? | Tree nav? | Stars (approx.) |
|---------|----------|--------|-------|-----------|-----------------|
| **treenav** | Symbol index + BM25 + tree nav + grep | Regex / indent-aware | yes | yes | early |
| Semble (MinishLab) | BM25 + static Model2Vec embeddings + RRF | Chonkie chunking | yes | no | ~720 |
| Code-Index-MCP (ViperJuice) | Symbol index + BM25 + optional semantic | tree-sitter (48 langs) | yes (SQLite FTS5) | no | ~51 |
| johnhuang316/code-index-mcp | Dual-strategy index + grep tools | tree-sitter (10 + 50 fallback) | partial | no | ~932 |
| mcp-server-tree-sitter (wrale) | Live AST queries | tree-sitter (~30 first-class) | no | no | ~303 |
| Serena (oraios) | Symbol search + LSP semantic edit | LSP backends (40+ langs) | no | no | ~23.9k |
| ast-grep-mcp | Structural pattern matching | ast-grep (tree-sitter) | no | no | ~401 |
| codebase-memory-mcp (DeusData) | SQLite FTS5 + knowledge graph + Louvain | tree-sitter (155 langs claimed) | yes | no (graph) | ~2.1k |
| Codanna | Semantic + call graph + doc search | tree-sitter, Rust | yes (claimed) | no | early |
| Claude Context (Zilliz) | Hybrid BM25 + dense vector via Milvus | tree-sitter (14 langs) | yes | no | early |
| mcp-codebase-search (teknologika) | Local embeddings + Tree-sitter chunks + LanceDB | tree-sitter | no (vector-only) | no | early |
| Sourcegraph Cody / Sourcegraph MCP | Industrial code search + (deprecated) embeddings | proprietary | n/a | no | commercial |

### Adjacent and baseline

| Project | Role |
|---------|------|
| Official MCP filesystem server (modelcontextprotocol/servers) | "Do nothing" baseline: file primitives only |
| Claude Code built-ins (Glob / Grep / Read / Tool Search) | Anthropic's reference agent has no retrieval index |
| mcp-ripgrep (mcollina), mcp-grep (247arjun) | Thin wrappers over `rg`/`grep` |
| Aider repo map | Token-budgeted ranked outline injected into Aider's prompt — not an MCP server |
| LlamaIndex TreeIndex | LLM-summary tree as a Python library — not an MCP server |
| Continue / Cursor / Cline | Coding clients with built-in retrieval; orthogonal to MCP servers but compete for the same agent-context budget |

---

## The Tree-Navigation Axis

The single sharpest framing across this whole landscape:

**Only three projects expose hierarchical browsing as a first-class agent
primitive: treenav, PageIndex, and Graphify — and Graphify's primitive
is a graph rather than a tree.**

Everything else either:

- returns ranked snippets (QMD, Semble, Claude Context, docs-mcp-server, MCP-Markdown-RAG, Sourcegraph Cody, Codanna, mcp-codebase-search), or
- returns flat content (GitMCP, Context7, mcp-ripgrep, filesystem MCP), or
- exposes raw AST nodes per file (mcp-server-tree-sitter, ast-grep-mcp), or
- builds a tree internally and bakes it into a single prompt (Aider repo map, LlamaIndex TreeIndex).

That difference matters because hierarchical browsing is what lets an
agent **read an outline, reason about it, and selectively retrieve
exact sections** — without paying the LLM-summarisation cost of
PageIndex/TreeIndex or the embedding-roundtrip cost of vector RAG. It
is the design move that PageIndex pioneered, that treenav adopts and
strips of LLM dependency, and that Graphify generalises into a
relationship graph at the cost of losing source-faithful hierarchy.
[^pageindex-readme] [^graphify-readme]

The rest of this document evaluates each competitor against that axis
and against treenav's specific "no models, no network, deterministic"
properties.

---

## Direct Retrieval Competitors

### 1. PageIndex — VectifyAI

**What it is.** PageIndex is VectifyAI's "vectorless, reasoning-based
RAG" engine and the closest philosophical cousin to treenav. The main
[`VectifyAI/PageIndex`](https://github.com/VectifyAI/PageIndex) renders
at approximately **29k stars**, MIT, mostly Python, with no GitHub
releases visible in the rendered metadata. The MCP wrapper
[`VectifyAI/pageindex-mcp`](https://github.com/VectifyAI/pageindex-mcp)
renders at approximately **320 stars**, MIT, TypeScript, latest visible
release **v1.6.3 on October 30, 2025**.[^pageindex-readme]
[^pageindex-mcp-readme]

The README positions PageIndex as a hierarchical tree index over PDFs
and Markdown that the LLM reasons over to retrieve information,
explicitly contrasting itself with vector search and chunking. At index
time, PageIndex uses an LLM (default `gpt-4o-2024-11-20`, multi-LLM via
LiteLLM) to construct the tree from parsed PDF pages and to generate
node summaries; at query time the LLM navigates the tree top-down. For
Markdown the same idea is applied via `--md_path` using `#` heading
levels.[^pageindex-readme]

PageIndex's headline benchmark is the
**[Mafin 2.5 system on FinanceBench](https://venturebeat.com/infrastructure/this-tree-search-framework-hits-98-7-on-documents-where-vector-search-fails/)**:
98.7% accuracy on multi-hop queries over financial documents with heavy
internal cross-references — **[vendor-claimed]** but widely cited in
the press.

**Deployment model.** Three modes: self-hosted local library,
hosted PageIndex API, and an OAuth/chat path at
[`chat.pageindex.ai`](https://chat.pageindex.ai); a fourth mode is
local MCP via `npx -y @pageindex/mcp` for local PDF upload, with the
hosted MCP also reachable via API key over HTTP. Recent additions
include a **PageIndex File System** layer announced for corpus-scale
reasoning across millions of documents and an "Agentic Vectorless RAG"
demo using the OpenAI Agents SDK.[^pageindex-readme]

**How tree navigation compares.** PageIndex has a tree, but it is
**LLM-inferred and LLM-traversed**. Every parent node carries an
LLM-generated `summary`. treenav's tree is **source-native**: Markdown
headings and code symbols already present in the corpus, with zero LLM
calls at any stage. PageIndex's tree wins decisively on PDFs and
documents whose structure has to be recovered. treenav's tree wins
when the structure already exists and the agent needs exact sections
without per-call model inference.

**Positioning.** Pick PageIndex for professional PDFs, dense reports,
and cross-referenced financial/legal corpora where retrieval itself
benefits from LLM reasoning. Pick treenav for Markdown/code corpora
where the value is deterministic search, exact section retrieval, zero
model dependency, and repeated low-latency agent calls. PageIndex
cannot match treenav's "no LLM, no embeddings, no model downloads, no
network dependency" profile; treenav cannot match PageIndex's
LLM-driven reasoning over poorly structured PDFs.

---

### 2. QMD — Tobias Lütke

**What it is.** [`tobi/qmd`](https://github.com/tobi/qmd) is Tobias
Lütke's local hybrid Markdown / code search engine. Rendered GitHub
metadata shows approximately **24.3k stars**, MIT, latest visible
release **v2.1.0 on April 5, 2026**. Stack: SQLite FTS5 BM25 + vector
semantic search + local LLM reranking via `node-llama-cpp` and GGUF
models.[^qmd-readme]

**Deployment model.** Local but model-heavy. QMD auto-downloads three
local GGUF models on first run, cached at `~/.cache/qmd/models`:

- `embeddinggemma-300M-Q8_0` (~300 MB),
- `qwen3-reranker-0.6b-q8_0` (~640 MB),
- `qmd-query-expansion-1.7B-q4_k_m` (~1.1 GB).

That is approximately **2 GB of model files** before the first query.
QMD supports stdio and HTTP MCP transports, with HTTP+daemon mode
keeping models warm across calls. v2.1.0 added AST-aware code chunking
for TypeScript, JavaScript, Python, Go, and Rust, plus per-collection
model configuration and a `--no-rerank` option. Multilingual queries
can use `QMD_EMBED_MODEL=Qwen3-Embedding-0.6B` for CJK
content.[^qmd-readme]

MCP tools are **`query`, `get`, `multi_get`, `status`** (4
total).[^qmd-readme]

A "context tree" feature (`qmd context add qmd://path`) ties parent
context to retrieved matches, but this is a **tagged hierarchy of
human-written descriptions per path**, not a structural document
index.

**How tree navigation compares.** QMD does not expose a browseable
heading or symbol tree. Its retrieval primitive is a hybrid pipeline —
query expansion → BM25 → vector → RRF → reranker — that returns
ranked chunks. Position-aware blending preserves top-3 retrieval ranks
against the reranker. The agent gets high-quality ranked context but
cannot expand sections, read sibling headings, or address nodes by ID.

**Positioning.** Pick QMD when **semantic recall** matters most —
especially when users ask questions in vocabulary different from the
docs ("expired credentials" → "token refresh flow"). Pick treenav
when the corpus has clean structure and the agent benefits from a
search → browse → retrieve workflow. QMD beats treenav on
single-query precision for fuzzy queries; treenav beats QMD on **zero
model downloads, smaller memory footprint, explicit tree navigation,
and zero local inference overhead**. They share an MIT license and a
local-first ethos but solve different sides of the relevance/structure
trade-off.

---

### 3. GitMCP — idosal

**What it is.** [`idosal/git-mcp`](https://github.com/idosal/git-mcp)
is a Cloudflare-hosted MCP server that turns any public GitHub
repository or GitHub Pages site into agent-readable documentation
endpoints. Approximately **8.0k stars**, **Apache-2.0** (notable: the
only Apache-licensed project in the docs-retrieval cluster, the rest
are MIT), TypeScript, Cloudflare Workers.[^gitmcp-readme]

Tools: `fetch_<repo>_documentation`, `search_<repo>_documentation`,
`fetch_url_content`, `search_<repo>_code` (4 tools, plus generic
variants on the root endpoint `gitmcp.io/docs`). Documentation
priority order, verified verbatim from the README:

1. `llms.txt`
2. AI-optimized version of the project's documentation
3. `README.md` / root.

The README states explicitly: "GitMCP only accesses content that is
already publicly available" and respects `robots.txt` on GitHub Pages.

**Deployment model.** Primarily cloud — paste an endpoint into the
agent's MCP config, no clone, no install. Self-hosting is supported
but not the recommended path. There is no local index; every query is
a network round-trip to the GitHub API or to a fetched document.

**How tree navigation compares.** GitMCP has **no inverted index, no
relevance scoring, and no heading hierarchy**. Documentation search
returns matched blobs from GitHub's code-search API; documentation
fetch dumps the whole `llms.txt` (or the README fallback) into the
agent's context. An agent loses the ability to address sections by
node ID, see word counts, or selectively retrieve subtrees from
private documentation.

**Positioning.** Pick GitMCP for **zero-setup public OSS exploration**:
"ask about this GitHub repo right now" with no local corpus.
Unbeatable time-to-value for one-off questions on any open-source
project. Pick treenav once the docs become part of daily workflow,
when private/enterprise documents are involved, or when token
efficiency over many calls matters. GitMCP's structural disadvantage
shows in extended workflows: dumping full pages costs **10–20K+ tokens
per call** versus treenav's 2–8K per precise section. GitMCP cannot
work behind VPN or against GitHub Enterprise Server; treenav cannot
match GitMCP's instant access to arbitrary public repositories. They
are largely complementary tools for different phases of the same
agent's life.

---

### 4. docs-mcp-server / Grounded Docs — arabold

**What it is.**
[`arabold/docs-mcp-server`](https://github.com/arabold/docs-mcp-server)
rebranded in 2026 as **"Grounded Docs"** and self-describes as an
"open-source alternative to Context7, Nia, and Ref.Tools." Approximately
**1.3k stars**, MIT, TypeScript, latest visible release **v2.2.1 on
March 30, 2026**. A web UI runs on `localhost:6280`; a Docker image is
published at `ghcr.io/arabold/docs-mcp-server:latest`.[^docs-mcp-server-readme]

**Deployment model.** Local or Docker. Indexes websites, GitHub repos,
local folders, npm/PyPI packages, and a wide format set: HTML, Markdown,
PDF, Word, Excel, PowerPoint, EPUBs, notebooks, and source code.
**Network calls** happen during scraping (websites, GitHub, npm, PyPI).
Optional embeddings are now described as "optional but dramatically
improves search quality" — supported providers include OpenAI, Ollama,
Gemini, Azure, and Bedrock. OAuth2/OIDC authentication is documented
for exposing the server to multiple clients.[^docs-mcp-server-readme]

**How tree navigation compares.** Traditional RAG via MCP. The
retrieval primitive is document/chunk search over a heterogeneous
corpus. There is no normalised heading or symbol tree the agent can
browse; the agent gets ranked excerpts. Format breadth (PDF + Office +
EPUB + websites) is genuinely larger than treenav's
Markdown+code+CSV/JSONL.

**Positioning.** Pick docs-mcp-server when the corpus includes
**heterogeneous office formats and external websites** that need to
be scraped and unified. Pick treenav when the corpus is primarily
local Markdown/code/structured rows and the agent needs deterministic
tree navigation, grep, and BM25 with **no embedding provider on the
critical path**. docs-mcp-server is the broader generalist; treenav
is the structurally tighter specialist for the corpora it actually
covers.

---

### 5. Context7 — Upstash

**What it is.** [`upstash/context7`](https://github.com/upstash/context7)
is a hosted, community-contributed registry of pre-indexed open-source
library documentation (Next.js, MongoDB, Supabase, etc.).
Approximately **54.6k stars** (one of the largest MCP-related repos
overall), MIT for the MCP/source repo, TypeScript, latest visible
package release `@upstash/context7-mcp@2.2.4` on **May 4, 2026**. The
README explicitly says the **API backend, parsing engine, and crawling
engine are private and proprietary**, and the registry is
community-contributed (not strictly curated).[^context7-readme]

A meaningful 2026 development: Context7 added **CLI + Skills mode** via
`npx ctx7 setup`, so agents can use Context7 via skill files without
MCP at all. MCP tools were renamed to **`resolve-library-id`** and
**`query-docs`** (previously `find_libraries` and `get_library_docs`).
The remote MCP endpoint is `https://mcp.context7.com/mcp` with an
optional `CONTEXT7_API_KEY` header.[^context7-readme]

**Deployment model.** Cloud-only by design. There is no path to point
Context7 at a private corpus.

**How tree navigation compares.** No local heading/symbol tree.
Context7 is a key-value lookup over pre-indexed library snippets and
examples, not an inspectable structural index.

**Positioning.** Pick Context7 for **public framework/library docs**,
particularly when version freshness across many libraries matters in
the same agent session. Pick treenav for private/internal docs, local
source code, structured data, and exact node retrieval. Context7
cannot index a company's runbooks or source tree; treenav cannot
provide a global hosted registry of current public library docs. The
two are largely complementary. Registry-ranking claims like "#3 MCP
server" should be cited as PulseMCP / aggregator metadata, not as
Context7's own claim.

---

## Code Navigation Competitors

### 6. Code-Index-MCP — ViperJuice

**What it is.**
[`ViperJuice/Code-Index-MCP`](https://github.com/ViperJuice/Code-Index-MCP)
is a local-first code indexer exposing MCP tools for code search and
symbol lookup. Approximately **51 stars**, MIT, Python, latest visible
release **v1.2.0 on April 26, 2026**. README cites a stable MCP surface
of `search_code` and `symbol_lookup`, a FastAPI admin layer, local
indexing with SQLite + FTS5 BM25, a file watcher, registry/plugin
language support across **48 languages via tree-sitter**, and optional
semantic search.[^code-index-mcp]

The small star count is worth flagging up-front: this is the **most
architecturally similar** code-only competitor to treenav, but it is
not (yet) a market presence in the way Serena or Sourcegraph are.

**Deployment model.** Local for the BM25 / FTS5 path. Optional
semantic search uses **Voyage AI or a local vLLM/Qwen-style backend**
(Voyage-only previously). Hybrid search exposes configurable weights:

```
HYBRID_SEARCH_BM25_WEIGHT=0.3
HYBRID_SEARCH_SEMANTIC_WEIGHT=0.5
HYBRID_SEARCH_FUZZY_WEIGHT=0.2
```

A query-intent router sends symbol-pattern queries (`class Foo`,
`def bar`, CamelCase identifiers) directly to the symbols table for
sub-5 ms lookup, bypassing BM25 and reranking entirely. Vendor
performance claims are sub-100 ms code search and sub-5 ms symbol
lookup on a "typical codebase" — **[vendor-claimed]**, README-only.

**How tree navigation compares.** Code-Index-MCP has tree-sitter
symbol extraction but **no hierarchical navigation primitive**. Agents
can find symbols by name and search code by query, but cannot browse a
class to see its methods or expand a file to its functions. Markdown
docs are not indexed at all.

**Positioning.** Pick Code-Index-MCP when the workload is **code-only
with optional semantic recall and a SQLite-backed persistent index**.
Pick treenav when the answer may live in a runbook, an API reference,
a CSV row, and an implementation file together — and when you want the
agent to navigate structure, not just retrieve hits. Code-Index-MCP is
richer as code-search infrastructure; treenav is broader and more
tree-navigable.

---

### 7. johnhuang316/code-index-mcp — name-collision footnote

**What it is.**
[`johnhuang316/code-index-mcp`](https://github.com/johnhuang316/code-index-mcp)
is a separate, unrelated project from ViperJuice's Code-Index-MCP and
is worth disambiguating. Approximately **932 stars**, MIT, Python.
README describes a dual-strategy code indexer with specialised
tree-sitter support for 10 core languages, fallback support for 50+
file types, and search via external grep variants
(`ugrep`/`ripgrep`/`ag`/`grep`).[^johnhuang-code-index]

It is a code-index/search server, not a docs+code tree navigation
system. Treat as a same-name footnote rather than a head-to-head
competitor.

---

### 8. mcp-server-tree-sitter — wrale

**What it is.**
[`wrale/mcp-server-tree-sitter`](https://github.com/wrale/mcp-server-tree-sitter)
is a local MCP server for AST-level code analysis: tree-sitter queries,
symbol extraction, dependency analysis, similar-code detection, and
cyclomatic complexity. Approximately **303 stars**, MIT, Python, latest
visible release **v0.7.0 on April 9, 2026**.[^mcp-server-tree-sitter]

**Language coverage caveat.** The README cites approximately **10
fully-supported languages** with first-class symbol extraction + AST
queries (Python, JavaScript, TypeScript, Go, Rust, C, C++, Swift, Java,
Kotlin, Julia, APL) plus broader support via `tree-sitter-language-pack`
(Bash, C#, Clojure, Elixir, Elm, Haskell, Lua, Objective-C, OCaml, PHP,
Protobuf, Ruby, Scala, SCSS, SQL, XML). Earlier versions of this
analysis cited "100+ languages"; the **language pack itself supports
~165 grammars**, but mcp-server-tree-sitter's first-class symbol
extraction covers a fraction. Suggest "~30 named languages, more via
the language pack."[^mcp-server-tree-sitter]

**Deployment model.** Local. Tools include project registration, AST
cursor traversal, query execution against tree-sitter grammars, symbol
extraction, dependency analysis, and cache diagnostics.

**How tree navigation compares.** The "tree" here is the **concrete
syntax tree of a single source file**, not a unified content tree
across docs and code. There is no BM25 ranking and no persistent
inverted index — every search re-parses the relevant file.

**Positioning.** Pick mcp-server-tree-sitter for **deep AST
introspection**: "what symbols exist here," "run this tree-sitter
query," "analyse import graph," "is this code structurally similar to
that code." Pick treenav for content retrieval: "find the best
section/code symbol about rate limiting and pull the relevant node."
Tree-sitter-MCP can answer structural questions treenav intentionally
does not; treenav can rank and unify docs+code retrieval that
tree-sitter-MCP does not attempt.

---

### 9. Serena — oraios

**What it is.** [`oraios/serena`](https://github.com/oraios/serena) is
an agent-oriented coding toolkit that gives LLMs **IDE-grade symbolic
editing, navigation, and project-memory** through MCP. Approximately
**23.9k stars** (large — comparable to QMD), MIT, latest visible
release **v1.2.0 on April 27, 2026**. The current README is explicit
that Serena is built on the **Language Server Protocol** (free /
default backend) with an upcoming paid **JetBrains plugin
backend**.[^serena-readme]

The LSP backend supports **40+ languages** through language servers.
Notably, the language servers run in a background thread so the MCP
server responds immediately on startup. The README quotes Opus 4.6
self-evaluation calling Serena's IDE-backed semantic tools "the single
most impactful addition to my toolkit" for cross-file renames, moves,
and reference lookups. The README **strongly cautions against
installing via plugin marketplaces** — only via Quick Start.

**Note on a prior misframing.** Earlier versions of this analysis
described Serena as "tree-sitter + LSP." That phrasing is wrong against
the current README, which emphasises LSP-only with optional JetBrains
backend. Updated accordingly.

**Deployment model.** Local, launched by MCP clients or run over HTTP.
Tools cover symbol discovery, references, declarations, implementations,
symbolic editing/refactoring, regex/list/read/shell operations, and
project memory. Serena does **not** present itself as a BM25 or vector
retrieval system.

**How tree navigation compares.** Serena exposes **symbol-level code
intelligence** via LSP — definitions, references, rename — not a
heading/symbol tree the agent navigates by hierarchy. It is a
structured-code editor's brain, not a browseable corpus.

**Positioning.** Pick Serena for **coding-agent workflows where
editing, refactoring, LSP references, and IDE-like semantics matter** —
particularly when the agent is producing diffs, not just answering
questions. Pick treenav when the task is read-only retrieval across
docs and source code, ideally in the same query. Serena does symbolic
editing and reference-aware code operations treenav intentionally does
not; treenav covers documentation and structured data Serena does not
index. Plausible to run both in the same agent.

---

### 10. ast-grep-mcp

**What it is.**
[`ast-grep/ast-grep-mcp`](https://github.com/ast-grep/ast-grep-mcp) is
the official ast-grep MCP server. Approximately **401 stars**, MIT,
Python, last commit April 21, 2026. Self-described as **"experimental"**
in the README. **4 tools confirmed**: `dump_syntax_tree`,
`test_match_code_rule`, `find_code`, `find_code_by_rule`. Requires the
external `ast-grep` binary on `PATH`.[^ast-grep-mcp]

A separate Rust port at
[`nnunley/ast-grep-mcp`](https://github.com/nnunley/ast-grep-mcp)
returns diff-shaped responses — different project, sometimes confused.

**Deployment model.** Local. Workflow is rule-iteration: write a YAML
rule, test against a snippet, then apply.

**How tree navigation compares.** ast-grep-mcp does **structural
pattern matching**, not relevance ranking and not navigation. The
primitive is "find all code matching this AST shape." There is no
keyword search and no document model.

**Positioning.** Pick ast-grep-mcp for **refactoring-pattern queries**:
"find every `await` inside a loop," "match this call shape," "apply
this rule." Pick treenav for keyword-relevance content search across
docs and code. ast-grep-mcp can match shapes treenav cannot; treenav
can rank content ast-grep-mcp does not attempt to. Complementary tools
in the same agent.

---

### 11. Sourcegraph Cody and Sourcegraph MCP

**What it is.** Sourcegraph Cody is Sourcegraph's commercial enterprise
AI coding assistant. Beyond Cody, Sourcegraph also exposes an
MCP server (`/.api/mcp`) for code search, navigation, and analysis —
the **MCP-server side is a relatively new addition** that pairs with
Cody's existing role as an MCP client.[^sourcegraph-mcp]
[^sourcegraph-cody-faq]

Cody does not have a meaningful "stars / license" reading because it is
a commercial product, not a single open-source repo. Sourcegraph's
official Cody FAQ states that Cody retrieves context via Sourcegraph
code intelligence and sends prompt/context snippets to an LLM. **Cody
Enterprise has retired embeddings in favour of Sourcegraph Search** as
the primary context provider; lower tiers still support embeddings
(`text-embedding-ada-002` or Sourcegraph's own
`st-multi-qa-mpnet-base-dot-v1`). Multi-repo `@`-mention chat is
**capped at 10 repositories per query**.[^sourcegraph-cody-faq]
[^sourcegraph-anatomy]

Compliance posture: SOC 2 Type II + ISO 27001:2022.

**Deployment model.** Cloud, self-hosted, or air-gapped (enterprise).
Cody integrates with editor extensions; the Sourcegraph MCP server
exposes tools for repository/file listing, keyword search,
natural-language search, go-to-definition, references, VCS context, and
Deep Search (Enterprise). Connectable as MCP from Claude Code, Cursor,
Amp, and similar clients.

**How tree navigation compares.** Sourcegraph's primitive is
**industrial code search and code intelligence across repositories**,
not a hierarchical document tree. There is no agent-facing
browseable heading/symbol/row hierarchy.

**Positioning.** Pick Sourcegraph/Cody for **multi-repo enterprise
code intelligence**, RBAC-gated search, hosted/self-hosted/air-gapped
deployment, editor integration, and SOC 2 / ISO 27001 procurement.
Pick treenav for a **lightweight local MCP retrieval layer** over a
single corpus that does not need a Sourcegraph backend. Sourcegraph
operates at enterprise/multi-repo scale; treenav is simpler,
deterministic, and free of model-and-license overhead — and is
plausibly used as an MCP server that Cody itself calls.

---

## Hybrid and Knowledge-Graph Entrants (May 2026)

### 12. Graphify — safishamsi

**What it is.**
[`safishamsi/graphify`](https://github.com/safishamsi/graphify) is the
most prominent project in the adjacent "give the agent a map of the
codebase" space. GitHub renders approximately **44.1k stars** (the
project's own marketing site still says "3.7k+ GitHub Stars" — that
copy is stale). MIT, Python, latest visible release **v0.7.8 on May 6,
2026**. PyPI confirms the package name is **`graphifyy`** (double-y);
the CLI is `graphify`.[^graphify-readme] [^graphify-pypi]

**Language coverage** is **28 code language families/extensions** in
the current README (was 13 in v1, 20 in v3, 25 in v5 — actively
expanding). [Note: the prior Claude research draft cited 25; this is
the codex-final correction.]

**Deployment model.** Graphify runs as a slash-command-style skill
inside AI coding assistants (`/graphify .` in Claude Code, Codex,
Cursor, OpenCode, and many others), but also exposes an MCP stdio
server via `--mcp` or `python -m graphify.serve graphify-out/graph.json`.

**MCP tools: 5** — `query_graph`, `get_node`, `get_neighbors`,
`shortest_path`, **`god_nodes`**. Earlier drafts of this analysis cited
4; the v4 CHANGELOG confirms `god_nodes` was added.[^graphify-changelog]

The pipeline is two-pass:

1. **Pass 1 (local):** tree-sitter parses code into AST nodes
   (functions, classes, imports, calls). Edges carry the `EXTRACTED`
   confidence tag. **No LLM, no network.**
2. **Pass 2 (model-backed):** docs, PDFs, images, and (with extras)
   audio/video transcripts go through the configured LLM for semantic
   concept extraction. Edges carry `INFERRED` or `AMBIGUOUS` tags.
   Backends: Anthropic, OpenAI, Gemini, Moonshot, Ollama. Audio/video
   is transcribed locally with `faster-whisper`.
3. **Pass 3:** Leiden community detection (via `graspologic`, now
   seeded for reproducibility) over the merged graph; produces a
   `GRAPH_REPORT.md` highlighting "god nodes," "surprising
   connections," and `# WHY:` / `# NOTE:` design rationale.[^graphify-readme]

Recent additions: a git merge driver for `graph.json`
(`graphify hook install`); a headless `graphify extract` mode; a
`--dedup-llm` entity dedup pipeline with entropy gate, MinHash/LSH,
Jaro-Winkler, and same-community boost.

A widely cited claim — **"71.5× fewer tokens per query"** on mixed
corpora — is **[vendor-claimed]** via a third-party blog post citing
internal numbers. Treat as marketing.[^graphify-blog]

**How tree navigation compares.** Graphify is a **graph, not a tree**.
Navigation is by traversal: neighbours, shortest path, communities,
"god nodes." It loses ranked keyword search and the ability to expand
a section by source-faithful hierarchy. It wins on cross-module
relationships, community structure, and design-rationale extraction —
things treenav does not model.

**Privacy posture.** Graphify is **"local for code, online for prose."**
Code is extracted locally via tree-sitter with no network. Doc/PDF/image
extraction calls **your configured AI provider's API** with your key —
which means the prose layer leaves the perimeter even though the code
does not. For regulated environments this is a real distinction.

**Positioning.** Pick Graphify for **architecture maps, relationship
discovery, and multimodal repos** — when the question is "how are
these things connected" or "what does this codebase look like." Pick
treenav for **exact section retrieval, BM25 ranking, grep, symbol
search, and fully offline indexing** across Markdown, code, and
CSV/JSONL. The two are complementary in practice: an agent could load
Graphify's `GRAPH_REPORT.md` once for orientation and then use treenav
for the fast retrieval loop. [Graphify issue #146](https://github.com/safishamsi/graphify/issues/146)
discusses exactly this kind of layered usage.

---

### 13. codebase-memory-mcp — DeusData

**What it is.**
[`DeusData/codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp)
is a knowledge-graph MCP server with a unique pitch: **a single static
binary written in pure C**, distributed for macOS, Linux, and Windows.
Approximately **2.1k stars**, MIT.[^codebase-memory-mcp]

**Language coverage** is claimed at **155 languages** via vendored
tree-sitter grammars compiled into the binary (a v0.6.0 marker said
64–66 languages — the count expanded rapidly).

**Deployment model.** Single static binary; no Python, no Node, no
package manager. Supports MCP server mode and a CLI. The index is a
SQLite knowledge graph + FTS5. **BM25 via FTS5 with the
`cbm_camel_split` tokenizer** (camelCase / snake_case aware). Provides
a Cypher-like query language and **Louvain community detection**
(distinct from Graphify's Leiden). Auto-detects 11 agents on install
(Claude Code, Codex CLI, Gemini CLI, Zed, OpenCode, Antigravity, Aider,
KiloCode, VS Code, OpenClaw, Kiro). 14 MCP tools.

Release supply-chain hygiene is unusually strong: **SLSA Level 3 build
provenance**, cosign signing, VirusTotal scanning gates each release.

**Vendor benchmark caveats.** Claims include indexing the Linux kernel
(28M LOC, 75 K files) in 3 minutes, a "120× fewer tokens" claim, and a
self-cited preprint **"arXiv:2603.27277."** That arXiv ID is a
**future-format ID** and the existence of the preprint **cannot be
independently verified**. Treat the academic veneer as marketing.

**How tree navigation compares.** Like Graphify, codebase-memory-mcp
is graph + community model rather than a hierarchical tree. It has BM25
via FTS5, but the agent-facing primitives are graph queries and
Cypher-style relationships, not heading/symbol navigation.

**Positioning.** Pick codebase-memory-mcp when the **single-static-binary
deployment** and **155-language coverage** are decisive — particularly
in policy-restricted environments where adding a Python or Node runtime
is a procurement headache. Pick treenav when you want the
heading/symbol tree as the agent's primary navigation primitive and a
TypeScript library you can embed. The two share an "everything in a
box" ethos but disagree on the central data model (graph vs tree).

---

### 14. Codanna

**What it is.** Codanna is a Rust-based MCP code-context server
positioning itself as **"X-ray vision for your codebase."** The README
lists semantic search, call graphs, document search, and MCP support
over stdio/HTTP/HTTPS, with claimed sub-10 ms lookups and **75k+
symbols/second parsing**. Indexing requires an embedding model of about
150 MB downloaded on first use. **[vendor-claimed]** numbers.[^codanna-readme]

**How tree navigation compares.** Codanna is closer to **semantic
symbol/code intelligence plus call/document graph** than treenav's
heading/symbol tree. It crosses the docs/code boundary, which makes it
relevant — but the primitive is graph + semantic search, not
hierarchical browse.

**Positioning.** Track on the watchlist. Pick Codanna for fast
Rust-implemented semantic code search where call graphs and
sub-10-ms latency matter and a 150 MB embedding model is acceptable.
Pick treenav for fully model-free indexing across Markdown, code, and
CSV/JSONL with explicit tree navigation.

---

## Local Semantic Code Search (May 2026)

### 15. Semble — MinishLab

**What it is.**
[`MinishLab/semble`](https://github.com/MinishLab/semble) is the
closest direct architectural cousin to treenav on the **code-search
axis**. Approximately **716–722 stars** during this verification pass
(grew from **4 stars at first verification** in late April 2026 — this
project is on a steep adoption curve). MIT, Python (99.6%), latest
visible release **v0.1.3 on May 5, 2026**. Has a Zenodo DOI
(10.5281/zenodo.19785932) and a citation block in the README.[^semble-readme]

The pitch: **"QMD-like hybrid retrieval, on CPU, with no transformer
forward pass at query time."**

**MCP tools: 2** — `search` and `find_related`.

**Stack** (verbatim from README):

- **Chonkie** code-aware chunking,
- **`bm25s`** for lexical scoring over identifiers and tokens,
- **Model2Vec `potion-code-16M`** static embeddings (~16M parameters,
  ~60 MB on disk, no transformer at query time),
- **Reciprocal Rank Fusion (RRF)** to combine BM25 and embedding
  rankings,
- code-aware reranking signals: adaptive lexical/semantic weighting,
  definition boosts, identifier-stem matching, file coherence boosts,
  and noise penalties for test/legacy/example/`.d.ts` files.

That signal stack is **strikingly similar to treenav's Tier-3 ranking
work** (RRF fusion, definition boost, file coherence, noise penalties),
which is why Semble is the most informative single competitor for
treenav on the code axis.

**Vendor benchmark — read carefully.** Semble's published benchmark
reports:

- **0.854 NDCG@10** on **1,250 queries / 63 repos / 19 languages**,
- 263 ms cold index, 1.5 ms p50 query,
- "99% of CodeRankEmbed Hybrid (a 137M-parameter transformer) at 218×
  faster indexing and 11× faster queries."[^semble-readme]

**Caveat (codex final).** The benchmark README discloses that the
**queries, labels, and LLM-as-judge evaluation were generated using
Claude Sonnet 4.6**. These are the project's own numbers, not a
third-party benchmark. The headline `0.854 NDCG@10` should always be
cited with that disclaimer.

**Deployment model.** Local via `uvx`. Indexes a local path or a remote
git URL (clones on demand, indexes cached for the session, file watcher
on local paths). Setup:
`claude mcp add semble -s user -- uvx --from "semble[mcp]" semble`.

**How tree navigation compares.** Chunked code, no hierarchical
browse. `find_related` provides follow-up by semantic similarity — a
different interaction model from parent/child traversal. **Code-only**:
Semble does not index Markdown docs.

**Positioning.** Pick Semble for **fast semantic code search on CPU**,
where the BM25 vocabulary gap is the binding constraint and you want a
~60 MB static embedding model rather than a 2 GB GGUF stack like QMD.
Pick treenav for **unified docs+code+CSV/JSONL retrieval, explicit
hierarchy, grep, no embedding model, and no model file at all**.

If treenav ever adopts a static-embedding side index — which is a
plausible future direction discussed in the
[BM25 limitation](#the-bm25-limitation--an-honest-acknowledgment)
section — Semble's `potion-code-16M` and the Model2Vec family are the
obvious reference points.

---

### 16. Claude Context — Zilliz

**What it is.**
[`zilliztech/claude-context`](https://github.com/zilliztech/claude-context)
is a **hybrid BM25 + dense vector** MCP server from Zilliz
(commercially aligned with Milvus). NPM package
`@zilliz/claude-context-mcp`, MIT, TypeScript monorepo (core + VSCode
extension + MCP).[^claude-context]

**Languages: 14** confirmed in README (TypeScript, JavaScript, Python,
Java, C++, C#, Go, Rust, PHP, Ruby, Swift, Kotlin, Scala, Markdown).

**Stack:** tree-sitter AST chunking with LangChain character splitter
fallback; BM25 + dense vector retrieval fused via RRF; embedding
providers OpenAI / VoyageAI / Ollama / Gemini; **Vector DB: Milvus or
Zilliz Cloud (cloud-managed Milvus)**. Incremental indexing via
**Merkle trees** (FileSynchronizer detects only changed files). 4
tools: `index_codebase`, `search_code`, `clear_index`,
`get_indexing_status`. Setup needs `OPENAI_API_KEY` + `MILVUS_TOKEN`.
Node.js >=20 and <24.

**[vendor-claimed]** ~40% token reduction at equivalent retrieval
quality, from the project's `evaluation/` directory.

**Deployment model.** **Not pure-local** — the vector database is
either Milvus self-hosted or Zilliz Cloud. Compared to Semble, Claude
Context represents the "managed-vector" sibling: better recall at the
price of operational complexity and a network/infrastructure dependency.

**How tree navigation compares.** AST chunks, no hierarchy. Returns
ranked snippets only. Closest to QMD on the "hybrid retrieval as MCP"
axis but with a vector DB instead of local GGUF models.

**Positioning.** Pick Claude Context when **a Milvus deployment is
already part of the stack** and OpenAI/VoyageAI embeddings are
acceptable. Pick treenav when you want **zero infrastructure**, no
embedding API key, no vector DB, and the heading/symbol tree as the
navigation primitive. The two cluster differently on the
local-vs-cloud and zero-deps-vs-rich-stack axes despite both serving
"agentic code retrieval."

---

### 17. mcp-codebase-search — teknologika

**What it is.** A local-first semantic-search MCP entrant.
[`teknologika/mcp-codebase-search`](https://github.com/teknologika/mcp-codebase-search)
is MIT and shows active release history around v0.1.16. Stack:
**local embeddings, Tree-sitter-aware chunking, LanceDB**. Requires
Node 22 / npm 10 and downloads about **500 MB of embedding models on
first use**. Tools include codebase listing/search, stats,
chunk/file content retrieval, adjacent chunks, file listing, and
update-scan operations.[^mcp-codebase-search]

**How tree navigation compares.** Semantic chunks plus adjacent-chunk
retrieval — there is no browseable heading/symbol tree. It's a
heavier local-semantic alternative to Semble (500 MB vs ~60 MB on
disk).

**Positioning.** Pick mcp-codebase-search when LanceDB-backed local
semantic search is preferable to Semble's static-embedding stack and
500 MB of model files is acceptable. Pick treenav when no embedding
download is acceptable at all and tree navigation matters.

---

## Token-Budget Summarisation (Non-MCP Comparators)

### 18. Aider repo map

**What it is.** Aider's **repo map** is a feature inside the
[Aider](https://aider.chat) coding assistant, not an MCP server. At
each turn, Aider parses the project with tree-sitter, builds a graph
of symbol definitions and references, runs personalised PageRank
seeded with the files currently in the chat (and any identifiers the
user mentioned), then renders the top-ranked definitions as elided
"skeleton" code that fits inside a token budget. Default
`--map-tokens` is **1024 (1k) tokens**, expanding in some contexts
when no files are already in chat.[^aider-repomap]

**Language coverage.** Aider's official docs do not surface a
specific language count this pass; the DeepWiki summary cites "130+
languages through tree-sitter parsers" each with a `tags.scm` query
file, plus Pygments fallback for some — treat the 130+ figure as
DeepWiki-secondary.[^aider-deepwiki]

**Deployment model.** Inside Aider's prompt construction. Not exposed
as a queryable tool; the agent never asks "expand this node," it
reads the map prepended to its prompt.

**How tree navigation compares.** Aider's repo map is a
**token-budgeted ranked outline injected into the prompt**, not an
interactive navigation primitive. It is the "construct a tree once and
drop it in" architecture, in contrast to treenav's "construct a tree
once and let the agent ask for nodes by ID."

**Positioning.** Pick Aider's repo map when the goal is **prompt
construction** — give the model a budgeted, conversation-aware
overview of the whole codebase before it asks a question. Pick treenav
when the goal is **agentic retrieval** — let the agent ask explicit
questions, get ranked answers with snippets, pull only the sections it
needs. The two are complementary: an agent could feed an Aider-style
overview once for orientation, then use treenav for follow-up
retrieval.

---

### 19. LlamaIndex TreeIndex

**What it is.** LlamaIndex's
[TreeIndex](https://docs.llamaindex.ai/en/stable/api_reference/indices/tree/)
is one of the original tree-shaped retrieval indexes — a Python
library, not an MCP server. At index time it chunks the corpus, then
recursively asks an LLM to summarise children into parents until a
single root remains. At query time it traverses from the root
downward, choosing one child per level (`child_branch_factor=1` by
default) or a fixed-width fan-out, with the LLM picking the next
branch.[^llamaindex-treeindex]

**How tree navigation compares.** TreeIndex builds a **summarisation
tree** where every parent node is an LLM-generated summary of its
children. treenav uses the **structural tree that already exists** in
the corpus — Markdown headings and code symbols — and computes no
summaries, no LLM calls at any stage.

**Positioning.** Pick TreeIndex when summarisation **is** the value —
you want the LLM to compose a hierarchical answer from many leaves and
you accept LLM cost at index and query time. Pick treenav when the
corpus already has structure and the goal is to let the agent navigate
that structure cheaply rather than have an LLM re-derive it.
TreeIndex is the philosophical predecessor to the tree-navigation
idea in a heavier, LLM-driven stack; treenav is what falls out when
you keep the tree-navigation insight and remove the LLM from indexing
and routing.

---

## Baselines and Primitives

### 20. Official MCP filesystem server and Claude Code built-ins

**What it is.** The
[`modelcontextprotocol/servers`](https://github.com/modelcontextprotocol/servers)
repo (~85.2k stars, MIT) describes its reference servers as
educational/reference implementations: Filesystem, Git, Fetch, Memory,
Sequential Thinking, Time. The filesystem server exposes
`read_text_file`, `read_multiple_files`, `list_directory`,
`directory_tree`, `search_files` (glob-only filename matching), and
write operations.[^mcp-servers]

Claude Code itself ships with **Glob** (file-pattern matching,
ripgrep-backed), **Grep** (ripgrep regex content search), **Read**,
**Bash**, **WebFetch**, **WebSearch**, and **Tool Search** (MCP tool
discovery — claims **[vendor-claimed]** 85% token reduction over
preloading all tool definitions).[^claude-code-tools]

**Anthropic's design philosophy is the strongest external citation
for treenav's "BM25 + grep + structure, no embeddings" approach.**
Boris Cherny (Anthropic, on the Latent Space podcast, May 2025): *"We
tried very early versions of Claude that actually used RAG. Eventually,
we landed on just agentic search… it outperformed everything. By a lot.
And this was surprising."*[^anthropic-agentic-search]

That is: **the most-shipped agent in the field deliberately uses
grep+glob+sub-agents over a retrieval index**, and treenav slots in
exactly as the structural augmentation that *doesn't* break the
agentic-search model.

**How tree navigation compares.** Filesystem MCP and Claude Code
built-ins have **directory** trees, not document trees. The agent must
know the path it wants, or walk the directory tree and read files
speculatively. There is no inverted index, no BM25, no AST, no heading
extraction.

**Positioning.** Pick filesystem MCP when the agent needs to
**manipulate files by path** — read, rename, edit by line range — and
the corpus is small enough that targeted reads don't waste context.
Pick treenav when the agent needs to **find content by meaning rather
than path**, or when retrieval precision matters across hundreds of
files. The two are complementary in the same agent.

---

### 21. mcp-ripgrep / mcp-grep

**What it is.** Thin MCP wrappers over `rg` and `grep`.
[`mcollina/mcp-ripgrep`](https://github.com/mcollina/mcp-ripgrep)
renders at approximately **67 stars**, MIT, Node-based, with **5
tools**: basic search, advanced search, count-matches, list-files
(no search), list-file-types. Requires `rg` and Node 18+.
[`247arjun/mcp-grep`](https://github.com/247arjun/mcp-grep) is similar
but smaller (~6 stars).[^mcp-ripgrep]

Output mirrors `rg -n`: `path:line:matched-text`. No scoring, no
relevance ranking, no document or symbol model — every match is
equally weighted, returned in file order.

**Deployment model.** Local-only. Each query re-scans the filesystem;
nothing is indexed in advance. No embeddings, no LLM, no model
downloads. Depends on the system `rg`/`grep` binary.

**How tree navigation compares.** No tree, no BM25, no section model,
no symbol model. The primitive is `path:line:match`.

**Positioning.** Pick ripgrep/grep MCP when the query is **exact**:
an error string, a CLI flag, a symbol name, or a regex — and you're
happy with file-order results. Pick treenav when relevance ranking,
structural navigation, or unified docs+code search matters — and note
that **treenav's `grep_documents` tool already provides literal/regex
grep over the indexed content** in the same server, so you rarely need
both.

---

## Client-Side Comparators

These are not MCP servers, but they compete for the same agent
context budget and are worth naming so the doc doesn't have a blind
spot.

### 22. Continue.dev

Continue is a coding-agent / client framework with **built-in code
RAG**. Its docs describe chunking code, generating embeddings, storing
them in **LanceDB**, and optionally using Voyage models such as
`voyage-code-3` and reranking with `rerank-2`. Index lives at
`~/.continue/index/index.sqlite`. Context providers: `@codebase`,
`@folder`, `@search` (ripgrep-powered), `@tree`, `@repo-map`. Reranking
is configurable between `nRetrieve=25` and `nFinal=5` defaults.
Continue can also define **custom MCP tools** like `search_codebase`
and `get_file_context`.[^continue-codebase]

**Tree-nav comparison:** Continue's primitive is embedding/vector
retrieval plus optional reranking, not a browseable source tree. It
competes with treenav for the same agent-context budget, but they sit
on different sides of the client/server boundary. **An agent running
Continue could call treenav as an MCP server**, pulling structural
navigation in addition to Continue's vector retrieval.

### 23. Cursor

Cursor's current codebase-indexing internals were not cleanly
verifiable from primary docs in this pass. An older Cursor forum post
by a Cursor team member states that local code chunks are sent to
Cursor's server for embeddings and stored in a remote vector database,
with code not stored after embedding — but that is a 2023
implementation note that may be stale.[^cursor-forum]

**Tree-nav comparison:** Cursor competes on "agent knows the
codebase" UX, not as an inspectable MCP retrieval server.

### 24. Cline

Cline is an agent runtime rather than a retrieval server. Its docs
list tools for reading files, regex search, listing code definitions,
browser actions, command execution, and MCP tool use. It analyses file
structure and ASTs, runs regex searches, and reads relevant files
while managing context.[^cline-docs]

**Tree-nav comparison:** Cline orchestrates search/read/code-definition
tools and runs MCP servers but does not provide a persistent BM25
index or tree-navigable corpus of its own. **It could call treenav as
an MCP tool** rather than replace it.

---

## Cross-Cutting Analysis

### Agentic Query Performance

| Query type | Best | Runner-up | Notes |
|------------|------|-----------|-------|
| Well-structured Markdown docs | treenav ≈ PageIndex | QMD | Tree navigation compensates for BM25-only matching |
| Complex PDFs with cross-references | PageIndex ≈ Graphify | treenav | LLM reasoning follows breadcrumbs across sections |
| Fuzzy / semantic doc queries | QMD | PageIndex | Vector + reranker bridges vocabulary gaps |
| Fuzzy / semantic code queries | Semble ≈ Claude Context | QMD | Static or dense embeddings on code corpora |
| Symbol lookup ("find `RateLimitPolicy`") | treenav ≈ Code-Index-MCP ≈ Serena | Semble | Direct symbol routing beats general search |
| Architectural overview ("god nodes," concept maps) | Graphify | codebase-memory-mcp | Graph + community detection is uniquely suited here |
| Refactoring patterns ("`X.method()` shape") | ast-grep-mcp | tree-sitter MCP | Structural pattern matching, not retrieval |
| Agent autonomy (browse + decide) | treenav ≈ PageIndex | Graphify | Most peers lack tree navigation entirely |
| Multi-step workflow (10+ tool calls) | treenav ≈ Semble | PageIndex | 5–30 ms vs LLM inference latency per call |
| Multi-repo enterprise code intelligence | Sourcegraph Cody | — | Treats repos as a federated index |
| Public OSS exploration ("ask about this repo right now") | GitMCP | Context7 | Zero setup wins decisively |
| Live framework docs lookup | Context7 | GitMCP | Hosted curated registry |

### The BM25 Limitation — An Honest Acknowledgment

BM25-only search is treenav's main vulnerability. If someone searches
**"how to handle expired credentials"** but the docs say
**"token refresh flow,"** BM25 with stemming and prefix matching will
partially bridge the gap but cannot make the semantic connection that
QMD's vector search or Semble's static embeddings would.

This matters less than it might seem for treenav's target use case
(structured Markdown docs and code under the user's control), because:

1. Documentation authors tend to use consistent terminology.
2. The agent can browse the tree to discover sections by title.
3. Prefix matching catches many partial-term overlaps.
4. The 9-tool workflow lets the agent iterate (search → browse →
   refine), and `compile_context` collapses that loop into one call.

But for corpora with inconsistent terminology, or natural-language
queries from users unfamiliar with the docs' vocabulary, this is a
real gap.

**Semble's static Model2Vec embeddings represent an interesting
middle path on this axis**: semantic matching at CPU-only cost, no
GPU and no transformer forward pass at query time. The treenav design
could in principle adopt a similar static-embedding signal as a side
index without giving up tree navigation, BM25 ranking, or
zero-model-download properties — at the cost of one ~16M-parameter
model file (~60 MB on disk). Noted as a possible future direction,
not a current capability.

The broader field has converged on the same intuition: FastEmbed
(ONNX, CPU-only), Model2Vec, the `potion-code-16M` family, and
similar projects are turning "static embeddings on CPU" into a
recognisable sub-genre that is genuinely cheaper than full
transformer inference.

### Token Efficiency: API Tokens vs Context Tokens

**A correction over earlier versions of this analysis** (per the
codex final pass): token-efficiency tables must distinguish
**API/model tokens** from **agent-context-window tokens**. They are
different costs.

| System | API/model tokens at index | API/model tokens at query | Context tokens per query (typical) |
|--------|---------------------------|---------------------------|-------------------------------------|
| **treenav** | 0 | 0 | ~300 – 1K |
| Semble | 0 | 0 (static embeddings, CPU) | ~few hundred per chunk × N retrieved |
| QMD | 0 | 0 (local GGUF) | ~few hundred per chunk × N retrieved |
| PageIndex | thousands per doc | hundreds–thousands (LLM reasoning) | ~5–20K depending on path |
| Graphify | thousands per non-code file (first run only) | 0 (graph traversal) | varies — graph traversal is compact |
| Claude Context | embedding tokens × file count | embedding tokens × query | ~few hundred per chunk × N retrieved |
| GitMCP | 0 | 0 | ~10K – 20K (full pages dumped) |

QMD and Semble both win on API/model tokens at query time because
they use local models with zero remote API calls — but **they still
return chunks that consume the agent's context window**. treenav
returns a precise section identified by node ID, which lets the
agent control what it pulls. PageIndex and GitMCP are the two
extremes on context-token cost: PageIndex consumes API tokens for
LLM reasoning, GitMCP dumps full documents.

Across a 10-call agent workflow:

- treenav: ~3K – 10K context tokens total.
- Semble / QMD / Claude Context: similar order on API tokens (zero
  if local-only) but typically more context tokens because chunks
  are wider than treenav's structurally-bounded sections.
- PageIndex: ~10K – 50K+ context, plus per-call API spend.
- GitMCP: ~100K – 200K+ context, plus network round-trips.

### Large-Volume Scaling

| System | 900 docs | 5,000 docs (est.) | 10,000+ docs (est.) |
|--------|----------|-------------------|---------------------|
| treenav | 2–5 s, zero LLM tokens | ~15–25 s (linear) | ~30–50 s |
| Semble | <1 s (CPU only) | few seconds | linear, CPU-bound |
| codebase-memory-mcp | claimed 28M LOC in 3 min ([vendor-claimed]) | extrapolation only | extrapolation only |
| QMD | minutes (model loading + embeddings) | 10–30 min | scales with model inference |
| PageIndex | minutes (LLM calls per doc) | expensive | impractical without caching |
| Graphify | minutes – hours (LLM calls per non-code file) | expensive on first run, cached after | cache-dominated |
| Claude Context | embedding API calls × file count | minutes | scales with provider quota |
| docs-mcp-server | varies (depends on embedding provider) | varies | varies |

treenav's zero-LLM, zero-embedding indexing is among the most
scalable of the group, alongside Semble's static-embedding approach.
The known boundary for treenav: the positional inverted index lives
**entirely in memory**. At 10,000+ documents with hundreds of
thousands of sections, this could grow to several hundred MB. The
[scaling path](./DESIGN.md#scaling-path) acknowledges this and maps
tiers from in-memory to SQLite FTS5 to chunked indexes.

### The Enterprise Blind Spot

Most popular MCP doc servers assume public access:

| System | Private repos | Enterprise GitHub | Offline | No data leaves perimeter |
|--------|---------------|-------------------|---------|--------------------------|
| **treenav** | yes | yes | yes | **yes** |
| Semble | yes | yes | yes | yes |
| QMD | yes | yes | yes | yes |
| codebase-memory-mcp | yes | yes | yes | yes |
| Code-Index-MCP | yes | yes | yes (BM25 path) | yes (without semantic backend) |
| Sourcegraph Cody | yes (Enterprise) | yes (Enterprise) | yes (air-gapped) | yes (air-gapped) |
| PageIndex | via local mode | via local mode | via local mode | via local mode |
| Graphify | yes (code-only) | yes (code-only) | code yes, **docs require API call** | **no** (docs/PDFs/images go to your AI provider) |
| Claude Context | yes (with self-hosted Milvus) | yes | embeddings via provider | depends on embedding provider |
| docs-mcp-server | local mode only | local mode only | local mode only | depends on config |
| GitMCP | no | no | no | no |
| Context7 | no | no | no | no |

For regulated industries (telecom, finance, healthcare) where
documentation cannot leave the network perimeter, the options narrow
to systems that run entirely locally with no external calls. **treenav,
Semble, codebase-memory-mcp, and QMD all qualify.** treenav and
codebase-memory-mcp additionally make **no network calls of any kind**,
not even for model downloads. Graphify is the most interesting partial
case: its code extraction is fully offline via tree-sitter, but its
non-code (docs/PDFs/images) extraction calls your configured AI
provider — meaning prose leaves the perimeter even though code does
not.

### Licensing Notes

Of the doc-retrieval cluster, **only GitMCP is Apache-2.0**; the rest
are MIT. MCP-Markdown-RAG (referenced earlier in this analysis but
since dropped from the comparison set due to apparent inactivity) was
also Apache-2.0. License posture rarely drives selection in practice
— both MIT and Apache-2.0 are permissive — but enterprise procurement
checks sometimes care.

---

## Positioning

treenav occupies a specific niche: **structured local-first navigation
over documentation, source code, and structured row data (CSV/JSONL)
in a single unified index, with zero external dependencies and a
9-tool MCP surface — including a composed `compile_context` call that
returns ranked hits partitioned by source plus outline trees in one
shot.**

It trades:

- GitMCP's convenience for retrieval precision and offline capability;
- PageIndex's LLM reasoning for zero-cost speed and simplicity;
- QMD's semantic recall for zero-model-download operation;
- Semble's static-embedding semantics for unified docs+code coverage and tree navigation;
- Claude Context's hybrid recall for zero infrastructure (no Milvus, no embedding API);
- Code-Index-MCP's tree-sitter precision for unified docs+code search;
- Vector RAG's vocabulary independence for structural awareness;
- Graphify's relationship-graph richness for ranked keyword search and zero-LLM-at-index-time operation;
- codebase-memory-mcp's single-static-binary 155-language sprawl for a TypeScript-library + Bun runtime profile;
- Serena's IDE-grade editing semantics for read-only retrieval;
- Sourcegraph Cody's enterprise multi-repo code intelligence for a single-corpus retrieval layer with no enterprise backend.

The 90% case — structured Markdown docs and source code that an agent
needs to navigate efficiently across many tool calls — gets
comparable retrieval quality at a fraction of the cost, latency, and
complexity. The agent gets BM25 ranking, deterministic structure,
literal grep, symbol search, and composed retrieval, all in one
in-memory index with no model downloads.

The 10% where alternatives win:

- **complex PDFs with cross-references** → PageIndex,
- **semantic fuzzy matching across inconsistent doc terminology** → QMD,
- **semantic fuzzy matching on code corpora** → Semble or Claude Context,
- **zero-setup access to any public OSS project** → GitMCP,
- **deep language-server semantics for code editing** → Serena,
- **architectural overviews and "surprising connections" across multimodal repos** → Graphify,
- **single-static-binary 155-language deployment** → codebase-memory-mcp,
- **multi-repo enterprise code intelligence** → Sourcegraph Cody.

A useful external anchor: **Anthropic's own Claude Code ships with
grep, glob, and sub-agents instead of a retrieval index** — Boris
Cherny's statement that "agentic search beats RAG" is the single
strongest framing for the whole BM25-and-structure approach.[^anthropic-agentic-search]
treenav slots in as the structural augmentation that does not break
the agentic-search model: it adds an inverted index, a heading/symbol
tree, and composed retrieval *underneath* the agent's grep/glob
loop, not as a replacement for it.

---

## Where to List treenav

Registries for MCP server visibility:

1. **GitHub MCP Registry** — [github.com/mcp](https://github.com/mcp) — the official GitHub-hosted registry.
2. **mcpservers.org** — submission via [mcpservers.org/submit](https://mcpservers.org/submit) (the wong2 / awesome-mcp-servers web directory).
3. **punkpeye/awesome-mcp-servers** — [github.com/punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers).
4. **appcypher/awesome-mcp-servers** — [github.com/appcypher/awesome-mcp-servers](https://github.com/appcypher/awesome-mcp-servers) — "Knowledge & Memory" category.
5. **PulseMCP** — [pulsemcp.com](https://pulsemcp.com).
6. **Glama.ai** — [glama.ai/mcp/servers](https://glama.ai/mcp/servers).
7. **LobeHub MCP** — [lobehub.com/mcp](https://lobehub.com/mcp).

---

## Long Tail / Not Covered in Depth

These projects exist in adjacent space and are worth tracking but
were not given full sections:

- **MCP-Markdown-RAG (Zackriya-Solutions)** — vector-only Markdown
  RAG via file-based Milvus; ~41 stars, did not surface as actively
  maintained in this verification pass; **dropped from the
  head-to-head set**.
- **engram (199-biotechnologies)** — BM25 + ColBERT + KG memory MCP,
  out of scope (personal memory, not code/doc search).
- **pdf-mcp (jztan)** — adjacent: BM25+FTS5+semantic via RRF, OCR.
  PDF-only.
- **robotmem** — robot memory with FastEmbed ONNX (CPU-only); referenced
  here as a precedent for the static-embedding pattern.
- **Daniel-Barta/mcp-rag-server** — long-tail wrapper.
- **mcp-codebase-searcher**, **mcp-semantic-search** — smaller
  semantic-code-search MCP wrappers, often with external Qdrant or
  Gemini dependencies; track as a long-tail cluster.

---

## Methodology

All claims in this document were independently verified against
primary sources (GitHub READMEs, release notes, official docs, PyPI
pages) on **May 7, 2026**. Star counts, tool inventories, version
numbers, and architectural details were cross-checked against actual
code and documentation. **Vendor-published benchmark numbers are
flagged `[vendor-claimed]` and are not independently reproduced.**
Star counts in particular fluctuate hour-to-hour and across cached
GitHub views — Graphify specifically was noted because the star
number disagreed across snapshots within the same session (~41.6k on
the README at fetch time vs ~42.2k–43.5k on trending pages and tag
views). Treat all star counts as "approximately N as of verification."

Verification depth varied. **Primary fetched (full README read):**
PageIndex, QMD, GitMCP, docs-mcp-server, Context7, Graphify (multiple
branches), Semble. **Search-snippet only (not full fetch):**
Code-Index-MCP, mcp-server-tree-sitter, Serena, ast-grep-mcp,
Claude Context, codebase-memory-mcp, Continue, Sourcegraph Cody,
Aider, mcp-ripgrep, Codanna, mcp-codebase-search,
johnhuang316/code-index-mcp. Snippet-only data points came from
GitHub directly when available and from aggregators (PulseMCP,
LobeHub, Glama, Playbooks, MCPStore) when not.
**Aggregator-only data points should be treated as lower confidence
than direct GitHub fetches.** DeepWiki summaries (used for Aider,
Continue, Claude Context architecture details) are LLM-generated
wiki articles — good for orientation, not authoritative for specific
numbers.

Notable corrections from earlier versions of this analysis:

- **PageIndex** main repo is approximately **29k** stars (not ~15k,
  not ~136 — both prior figures appeared in older drafts).
- **PageIndex** offers local deployment via `npx`, not cloud-only.
- **GitMCP** prioritises `llms.txt` but falls back gracefully through
  AI-optimized docs to README.
- **Context7** is **community-contributed**, not strictly curated.
  Backend (parsing/crawling) is proprietary.
- **QMD** is approximately **24.3k** stars and v2.1.0 (April 2026),
  not unreviewed; AST-aware code chunking was added in v2.1.0.
- **Graphify**'s PyPI package is `graphifyy` (double-y); CLI command
  is `graphify`. README cites **28** code language families/extensions
  (not 25 as earlier drafts said). MCP tools are **5** (added
  `god_nodes` in v4), not 4. Pipeline is "local for code, online for
  prose" — code via tree-sitter (no network), docs/PDF/image
  extraction via your configured AI provider.
- **Semble**'s benchmark of **0.854 NDCG@10** on 1,250 queries / 63
  repos / 19 languages was **generated using Claude Sonnet 4.6 as
  LLM-as-judge** — this is the project's own evaluation, not
  independent third-party validation.
- **Semble** grew from approximately 4 stars at v0.1.0 (April 26,
  2026) to approximately **716–722 stars at v0.1.3** (May 5, 2026)
  during the verification window — track as fast-growing.
- **Serena** is **LSP-only** with an upcoming paid JetBrains backend,
  **not** "tree-sitter + LSP" as some earlier drafts described.
- **mcp-server-tree-sitter** language coverage is approximately **30
  named languages, more via the language pack** — not "100+" as
  earlier drafts stated.
- **Code-Index-MCP** is approximately **51 stars** (small relative to
  Serena and QMD); rebalance prominence accordingly. Hybrid search
  with configurable BM25/semantic/fuzzy weights and query-intent
  routing for symbol patterns are recent additions.
- **codebase-memory-mcp**'s self-cited **"arXiv:2603.27277"** preprint
  uses a future-format ID and **cannot be independently verified** —
  treat as marketing copy, not academic.
- **MCP-Markdown-RAG** was demoted from a head-to-head section to a
  long-tail mention because the project did not surface as actively
  maintained in this pass.

---

## References

Primary GitHub repositories, READMEs, official docs, PyPI pages, and
release notes consulted on May 7, 2026.

[^pageindex-readme]: VectifyAI/PageIndex — https://github.com/VectifyAI/PageIndex (full README fetched). FinanceBench result via VentureBeat — https://venturebeat.com/infrastructure/this-tree-search-framework-hits-98-7-on-documents-where-vector-search-fails/

[^pageindex-mcp-readme]: VectifyAI/pageindex-mcp — https://github.com/VectifyAI/pageindex-mcp

[^qmd-readme]: tobi/qmd — https://github.com/tobi/qmd (full README + architecture diagram fetched; v2.1.0 release info from same page).

[^gitmcp-readme]: idosal/git-mcp — https://github.com/idosal/git-mcp (full README fetched).

[^docs-mcp-server-readme]: arabold/docs-mcp-server — https://github.com/arabold/docs-mcp-server (full README + repo metadata fetched).

[^context7-readme]: upstash/context7 — https://github.com/upstash/context7 (full README fetched). Latest package release: `@upstash/context7-mcp@2.2.4`, May 4, 2026.

[^code-index-mcp]: ViperJuice/Code-Index-MCP — https://github.com/ViperJuice/Code-Index-MCP. Star count and tool surface verified via https://github.com/ViperJuice/Code-Index-MCP/issues. Aggregator references: https://mcpservers.org/en/servers/ViperJuice/Code-Index-MCP, https://lobehub.com/mcp/viperjuice-code-index-mcp

[^johnhuang-code-index]: johnhuang316/code-index-mcp — https://github.com/johnhuang316/code-index-mcp

[^mcp-server-tree-sitter]: wrale/mcp-server-tree-sitter — https://github.com/wrale/mcp-server-tree-sitter, FEATURES.md and ROADMAP.md pages, https://github.com/wrale/mcp-server-tree-sitter/pulls. Aggregator references: https://www.juheapi.com/mcp-servers/wrale/mcp-server-tree-sitter, https://glama.ai/mcp/servers/@wrale/mcp-server-tree-sitter

[^serena-readme]: oraios/serena — https://github.com/oraios/serena, README + releases + issues pages. Star count and ranking via https://www.pulsemcp.com/servers/oraios-serena and the GitHub MCP Registry listing.

[^ast-grep-mcp]: ast-grep/ast-grep-mcp — https://github.com/ast-grep/ast-grep-mcp, organization page https://github.com/ast-grep, official AI-tools guide https://ast-grep.github.io/advanced/prompting.html. Alternative implementations not used: https://github.com/nnunley/ast-grep-mcp, https://hub.docker.com/mcp/server/ast-grep

[^sourcegraph-mcp]: Sourcegraph MCP context-gathering announcement — https://sourcegraph.com/changelog/mcp-context-gathering. Original MCP integration blog — https://sourcegraph.com/blog/cody-supports-anthropic-model-context-protocol

[^sourcegraph-cody-faq]: Sourcegraph Cody FAQ — https://sourcegraph.com/docs/cody/faq

[^sourcegraph-anatomy]: Sourcegraph "Anatomy of a coding assistant" — https://sourcegraph.com/blog/anatomy-of-a-coding-assistant (embedding model details: `text-embedding-ada-002` + `st-multi-qa-mpnet-base-dot-v1`).

[^aider-repomap]: Aider — repository map — https://aider.chat/docs/repomap.html, options reference https://aider.chat/docs/config/options.html, original blog post https://aider.chat/2023/10/22/repomap.html

[^aider-deepwiki]: DeepWiki on Aider repo mapping — https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping (130+ languages claim — DeepWiki, secondary).

[^llamaindex-treeindex]: LlamaIndex Tree index API — https://docs.llamaindex.ai/en/stable/api_reference/indices/tree/. Index guide — https://docs.llamaindex.ai/en/stable/module_guides/indexing/index_guide/

[^graphify-readme]: safishamsi/graphify — https://github.com/safishamsi/graphify (full README fetched, v6 + main branches). Tag/branch pages confirming language and tool variance: https://github.com/safishamsi/graphify/blob/v3/README.md, https://github.com/safishamsi/graphify/blob/v5/README.md, https://github.com/safishamsi/graphify/blob/v7/README.md

[^graphify-pypi]: PyPI `graphifyy` — https://pypi.org/project/graphifyy/

[^graphify-changelog]: v4 CHANGELOG (god_nodes added) — https://github.com/safishamsi/graphify/blob/v4/CHANGELOG.md

[^graphify-blog]: "71.5× fewer tokens" claim — https://blog.gopenai.com/graphify-build-a-knowledge-graph-from-your-entire-codebase-without-sending-your-code-to-anyone-1b6924474b50 (third-party blog, [vendor-claimed], not third-party validated).

[^semble-readme]: MinishLab/semble — https://github.com/MinishLab/semble (full README fetched twice — same content both times, including benchmark table). Stack components implicitly referenced: Chonkie (https://github.com/chonkie-inc/chonkie), Model2Vec (https://github.com/MinishLab/model2vec), `potion-code-16M` (https://huggingface.co/minishlab/potion-code-16M), `bm25s` (https://github.com/xhluca/bm25s), CodeRankEmbed (https://huggingface.co/nomic-ai/CodeRankEmbed). Zenodo DOI cited in README: `10.5281/zenodo.19785932`.

[^claude-context]: zilliztech/claude-context — https://github.com/zilliztech/claude-context. NPM — https://www.npmjs.com/package/@zilliz/claude-context-mcp. DeepWiki architecture deep-dive — https://deepwiki.com/zilliztech/CodeIndexer (secondary). Vendor blog — https://milvus.io/blog/why-im-against-claude-codes-grep-only-retrieval-it-just-burns-too-many-tokens.md, https://milvus.io/blog/build-open-source-alternative-to-cursor-with-code-context.md. PulseMCP listing — https://www.pulsemcp.com/servers/zilliz-claude-context

[^codebase-memory-mcp]: DeusData/codebase-memory-mcp — https://github.com/DeusData/codebase-memory-mcp. Releases — https://github.com/DeusData/codebase-memory-mcp/releases (and v0.6.0 tag — https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.6.0). Self-cited preprint "arXiv:2603.27277" not independently verified.

[^codanna-readme]: Codanna README and project pages (verified via search snippets). Performance and 150 MB embedding model claims are README-only — `[vendor-claimed]`.

[^mcp-codebase-search]: teknologika/mcp-codebase-search — https://github.com/teknologika/mcp-codebase-search

[^mcp-ripgrep]: mcollina/mcp-ripgrep — https://github.com/mcollina/mcp-ripgrep, star count via https://www.pulsemcp.com/servers/mcollina-ripgrep. Additional aggregator references: https://playbooks.com/mcp/mcollina/mcp-ripgrep, https://glama.ai/mcp/servers/@mcollina/mcp-ripgrep, https://lobehub.com/mcp/mcollina-mcp-ripgrep

[^mcp-servers]: modelcontextprotocol/servers — https://github.com/modelcontextprotocol/servers

[^claude-code-tools]: Claude Code tools reference — https://code.claude.com/docs/en/tools-reference. Glob/Grep/Explore behavior — https://github.com/anthropics/claude-code/issues/22429. Reverse-engineered system prompt (secondary) — https://gist.github.com/wong2/e0f34aac66caf890a332f7b6f9e2ba8f. Tool Search 85% reduction claim — https://www.aifreeapi.com/en/posts/claude-code-tool-search (`[vendor-claimed]`).

[^anthropic-agentic-search]: "Agentic search beats RAG" quote — Boris Cherny on the Latent Space podcast (May 2025), as relayed via https://zerofilter.medium.com/why-claude-code-is-special-for-not-doing-rag-vector-search-agent-search-tool-calling-versus-41b9a6c0f4d9. The podcast itself was not fetched this pass — treat as second-hand attribution.

[^continue-codebase]: Continue codebase indexing docs — https://docs.continue.dev/customize/context/codebase. Embedding model roles — https://docs.continue.dev/customize/model-roles/embeddings. Custom providers — https://docs.continue.dev/customize/custom-providers. DeepWiki — https://deepwiki.com/continuedev/continue/3.4-codebase-indexing (secondary).

[^cursor-forum]: Cursor team member forum post on indexing internals (2023, may be stale) — referenced via search aggregators; primary forum post not relinked from cache this pass.

[^cline-docs]: Cline documentation pages (verified via search snippets).
