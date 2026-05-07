# Competitive Landscape Research — Codex Final Analysis (May 2026)

> Research artifact captured verbatim. This is the codex final analysis
> received on 2026-05-07, building on
> [`2026-05-07-competitive-landscape-claude.md`](./2026-05-07-competitive-landscape-claude.md)
> and the earlier codex verification pass in
> [`2026-05-07-competitive-landscape-codex.md`](./2026-05-07-competitive-landscape-codex.md).
> This pass introduces high-confidence corrections to the prior drafts
> (notably PageIndex / QMD / Graphify / Semble star counts and Serena's
> LSP-only architecture), and supplies competitor briefs in the new
> template (one-line description / facts / deployment / tree-nav
> comparison / positioning) intended to seed the authored
> [`COMPETITIVE-ANALYSIS.md`](../COMPETITIVE-ANALYSIS.md) restructure.
> Citation markers from the source were rendered as `￼` glyphs and
> are preserved here for fidelity.

---

I treated the prior Claude draft and our review as the working context for this refresh. Verification basis below: primary GitHub READMEs/release pages, official docs, PyPI pages, and vendor benchmark pages checked for May 2026 freshness. Star counts are volatile; use "approx." and a verification date in the final doc.

## High-confidence corrections to Claude's draft

Claude's direction is mostly sound, but I would correct several items before publishing.

PageIndex is no longer a 15k-star project in rendered GitHub metadata. The main repo shows roughly 29k stars, while pageindex-mcp shows roughly 320 stars. The MCP wrapper's latest visible release is v1.6.3, Oct. 30, 2025, MIT, TypeScript.  ￼

QMD is also much larger than the old draft implies: rendered GitHub metadata shows roughly 24.3k stars and latest visible release v2.1.0, Apr. 5, 2026. QMD's model-size claims are verified in its README: about 300 MB embedding model, 640 MB reranker, and 1.1 GB query expansion model, cached under ~/.cache/qmd/models.  ￼

Graphify is real and important, but Claude's metadata is off. GitHub currently renders about 44.1k stars, while Graphify's own website still displays "3.7k+ GitHub Stars," which appears stale. Current README says 28 code language families/extensions, not 25. It is MIT, Python, latest visible release v0.7.8, May 6, 2026, and the PyPI package is indeed graphifyy.  ￼

Semble is not a 4-star April v0.1.0 project anymore. Rendered GitHub metadata during this pass showed roughly 716–722 stars and latest visible release v0.1.3, May 5, 2026. Its benchmark numbers are project-published, and its benchmark README says queries/labels and LLM-as-judge evaluation were generated with Claude Sonnet 4.6, so do not present them as independent validation.  ￼

Serena should be described as LSP-backed with optional JetBrains backend, not "tree-sitter + LSP," unless you separately verify tree-sitter usage from current code. The current official README emphasizes Language Server Protocol support across 40+ languages and a paid JetBrains plugin backend.  ￼

Token-efficiency tables should separate API/model tokens from downstream context tokens. QMD and Semble use zero API tokens at query time, but they still return chunks/snippets that consume the agent's context window. Semble's own benchmark reports expected retrieved tokens, not zero tokens.  ￼

---

## Verified competitor briefs

### PageIndex — VectifyAI/PageIndex + VectifyAI/pageindex-mcp

**One-line description.** PageIndex is VectifyAI's vectorless, LLM-native document tree retrieval system, with a separate MCP wrapper for exposing PageIndex retrieval to agents.

**Facts.** The main PageIndex repo renders at roughly 29k stars, MIT license, mostly Python, with no GitHub releases visible in the rendered metadata. pageindex-mcp renders at roughly 320 stars, MIT, TypeScript, latest visible release v1.6.3, Oct. 30, 2025. The README positions PageIndex as "reasoning-based RAG" that replaces vector search/chunking with a hierarchical tree index; the LLM reasons over the tree to retrieve information.  ￼

**Deployment model.** Deployment is hybrid: local/self-hosted library usage, a hosted PageIndex API, an OAuth/chat path, and local MCP usage through `npx -y @pageindex/mcp` for local PDF upload. The MCP docs also describe an API-key HTTP endpoint. PageIndex is not cloud-only, but model-backed document understanding is central to its design.  ￼

**Tree navigation comparison.** PageIndex does have a tree, but it is an LLM-inferred document tree with LLM-guided traversal. treenav's tree is source-native: Markdown headings and code symbols already present in the corpus, searched with BM25 and browsed deterministically. PageIndex's tree is better for PDFs and documents whose structure must be inferred; treenav's tree is better when the structure already exists and the agent needs exact sections without model calls.

**Positioning.** Pick PageIndex for professional PDFs, dense reports, and cross-referenced financial/legal documents where retrieval itself benefits from LLM reasoning. Pick treenav for local Markdown/code corpora where the value is deterministic search, exact section retrieval, zero model dependency, and repeated low-latency agent calls. PageIndex cannot match treenav's "no LLM, no embeddings, no model downloads, no network dependency" profile; treenav cannot match PageIndex's LLM-driven reasoning over poorly structured PDFs.

---

### QMD — tobi/qmd

**One-line description.** QMD is Tobias Lütke's local hybrid Markdown/code search engine using BM25, vectors, query expansion, and local LLM reranking.

**Facts.** QMD renders at roughly 24.3k stars, MIT, with latest visible release v2.1.0, Apr. 5, 2026. The README describes an on-device search engine for Markdown notes, transcripts, docs, and knowledge bases using SQLite FTS5 BM25, vector semantic search, and LLM reranking through node-llama-cpp and GGUF models.  ￼

**Deployment model.** QMD is local, but model-heavy. It auto-downloads three local GGUF models: `embeddinggemma-300M-Q8_0` at about 300 MB, `qwen3-reranker-0.6b-q8_0` at about 640 MB, and `qmd-query-expansion-1.7B-q4_k_m` at about 1.1 GB. It supports stdio and HTTP MCP modes, with HTTP keeping models warm and stdio potentially reloading models per request. v2.1.0 added AST-aware code chunking for TypeScript, JavaScript, Python, Go, and Rust, plus per-collection model configuration and a `--no-rerank` option.  ￼

**Tree navigation comparison.** QMD does not expose a browseable heading/symbol tree. Its primitive is hybrid retrieval over chunks: query expansion, BM25, vector search, Reciprocal Rank Fusion, and reranking. An agent gets high-quality ranked context, but not a document hierarchy it can browse, expand, or selectively retrieve by node.

**Positioning.** Pick QMD when semantic recall matters most, especially when users ask questions in different vocabulary from the docs. Pick treenav when the corpus already has clean structure and the agent benefits from search → browse → retrieve workflows. QMD can beat treenav on fuzzy single-query precision; treenav beats QMD on zero model downloads, smaller memory footprint, explicit tree navigation, and no local inference overhead.

---

### GitMCP — idosal/git-mcp

**One-line description.** GitMCP is a Cloudflare-hosted MCP server that turns public GitHub repositories and GitHub Pages into agent-readable documentation and code-search endpoints.

**Facts.** The repo renders at roughly 8k stars, Apache-2.0, TypeScript. Its README describes repo-specific endpoints such as `gitmcp.io/{owner}/{repo}` and a generic endpoint `gitmcp.io/docs`. It can also be self-hosted.  ￼

**Deployment model.** GitMCP is primarily cloud/remote. It works by fetching public GitHub content and documentation. It prioritizes `llms.txt`, then AI-optimized docs, then README/root documentation. Its tools include documentation fetch, documentation search, URL content fetch, and GitHub code search. The README states that it only works with public GitHub projects and only accesses already-public content.  ￼

**Tree navigation comparison.** GitMCP has no heading/symbol tree and no local positional BM25 index. Its primitive is remote fetching/searching against public GitHub docs and code. An agent loses the ability to browse a normalized local corpus tree, inspect sibling sections, and retrieve exact nodes from private documentation.

**Positioning.** Pick GitMCP for zero-setup public OSS exploration: "ask about this GitHub repo right now." Pick treenav once a repo or documentation set becomes part of daily work and precision/private/offline retrieval matters. GitMCP cannot index private enterprise docs behind a firewall; treenav cannot match GitMCP's instant access to arbitrary public GitHub repositories without cloning or indexing first.

---

### docs-mcp-server / Grounded Docs — arabold/docs-mcp-server

**One-line description.** Grounded Docs is a broad local documentation indexer and MCP server for websites, GitHub repos, local folders, package docs, and many document formats.

**Facts.** The repo renders at roughly 1.3k stars, MIT, TypeScript, latest visible release v2.2.1, Mar. 30, 2026. It describes itself as a private/local MCP server and CLI for indexing docs from websites, GitHub, npm/PyPI packages, local folders/zips, PDFs, Office files, EPUBs, notebooks, and source code.  ￼

**Deployment model.** It runs locally or in Docker, with an MCP server exposed over SSE on localhost. Network calls happen when scraping websites, GitHub, npm, or PyPI. It supports optional embeddings through providers such as OpenAI, Ollama, Gemini, Azure, and others; without embeddings, it still indexes, but the README explicitly frames embeddings as an optional search-quality improvement.  ￼

**Tree navigation comparison.** docs-mcp-server is a general-purpose RAG/indexing system, not a tree-navigation system. Its retrieval primitive is document/chunk search over a heterogeneous corpus. An agent gains format breadth but loses treenav's normalized heading/symbol tree, node IDs, and section-precise browse/retrieve workflow.

**Positioning.** Pick docs-mcp-server when the corpus includes PDFs, Office docs, websites, package documentation, and mixed formats. Pick treenav when the corpus is primarily Markdown/code/structured rows and the agent needs deterministic tree navigation plus grep plus BM25 without embeddings. docs-mcp-server can cover more formats; treenav provides a simpler and more controllable structural workflow.

---

### MCP-Markdown-RAG — Zackriya-Solutions/MCP-Markdown-RAG

**One-line description.** MCP-Markdown-RAG is a small local vector-RAG MCP server for Markdown files using a file-based Milvus vector database.

**Facts.** The repo renders at roughly 41 stars, Apache-2.0, Python, with no visible releases. The README describes two tools: `index_documents` and `search`. On first run it downloads an embedding model of about 50 MB.  ￼

**Deployment model.** It is local-first. It reads Markdown files, splits them into chunks using headings/logical chunking, computes embeddings, stores them in local Milvus, and retrieves by vector similarity. It needs an embedding model download and a vector database dependency, but does not require a cloud API for the default path described in the README.  ￼

**Tree navigation comparison.** It uses heading-aware chunking, but it does not expose a browseable heading tree. The agent receives vector-similar chunks rather than a document hierarchy. That means it can bridge vocabulary better than treenav BM25, but it cannot browse sibling headings, expand branches, or retrieve exact source sections by structural node.

**Positioning.** Pick MCP-Markdown-RAG as a lightweight local semantic baseline for Markdown-only corpora. Pick treenav when you need Markdown plus source code plus CSV/JSONL, literal/regex grep, symbol search, and explicit tree navigation with no embeddings or model download. MCP-Markdown-RAG can do semantic similarity; treenav can do structured navigation and unified docs+code retrieval.

---

### Context7 — upstash/context7

**One-line description.** Context7 is Upstash's hosted/versioned documentation registry for pulling current library docs and code examples into prompts via CLI, Skills, and MCP.

**Facts.** The repo renders at roughly 54.6k stars, MIT for the MCP/source repo, TypeScript, latest visible package release `@upstash/context7-mcp@2.2.4`, May 4, 2026. The README says it provides up-to-date, version-specific documentation and examples.  ￼

**Deployment model.** Context7 is cloud/registry-centered. It exposes a remote MCP endpoint at `https://mcp.context7.com/mcp`, with optional API key use, and CLI commands such as `ctx7 library` and `ctx7 docs`. Its MCP tools include `resolve-library-id` and `query-docs`. The README says the backend API, parsing, and crawling are private/proprietary, and that the registry is community-contributed.  ￼

**Tree navigation comparison.** Context7 has no user-controlled local heading/symbol tree. Its primitive is hosted lookup of library documentation snippets/examples. An agent gains instant framework docs, but loses the ability to index internal docs or browse a project-specific local structure.

**Positioning.** Pick Context7 for public framework/library docs, especially when version freshness matters. Pick treenav for private/internal docs, local source code, and exact node retrieval. Context7 cannot index a company's private runbooks or source tree; treenav cannot provide a global hosted registry of current public library docs. PulseMCP ranking claims, such as "#3 MCP server," should be cited only as registry/secondary metadata, not as an official Context7 claim.  ￼

---

### Code-Index-MCP — ViperJuice/Code-Index-MCP

**One-line description.** Code-Index-MCP is a local-first code indexer exposing MCP tools for code search and symbol lookup, with optional semantic search.

**Facts.** The repo renders at roughly 51 stars, MIT, latest visible release v1.2.0, Apr. 26, 2026. Its README describes a stable MCP surface with `search_code` and `symbol_lookup`, a FastAPI admin layer, local indexing, SQLite + FTS5, BM25, a file watcher, registry/plugin language support, and optional semantic search.  ￼

**Deployment model.** Core indexing is local with SQLite/FTS5. Optional semantic search uses Voyage AI or local vLLM/Qwen-style backends; rerankers include options such as FlashRank, cross-encoder, and Voyage. Vendor performance claims include sub-100 ms symbol lookup and sub-500 ms code search on a "typical codebase," but those are README claims, not third-party benchmarks.  ￼

**Tree navigation comparison.** Code-Index-MCP has symbol lookup and search, but not treenav's browseable heading/symbol tree spanning docs and code. Its structure is code-index infrastructure, not an agent-facing tree of Markdown headings, classes, methods, and structured row nodes. An agent can find symbols quickly, but cannot navigate documentation hierarchy in the same corpus.

**Positioning.** Pick Code-Index-MCP for code-only symbol/search infrastructure, especially if optional semantic search and SQLite persistence matter. Pick treenav when the answer may live in a runbook, API reference, CSV/JSONL data, and implementation code together. Code-Index-MCP is richer as code infrastructure; treenav is broader and more tree-navigable across docs and code.

---

### mcp-server-tree-sitter — wrale/mcp-server-tree-sitter

**One-line description.** mcp-server-tree-sitter is a local MCP server for AST-level code analysis, tree-sitter queries, symbols, dependencies, and code search.

**Facts.** The repo renders at roughly 303 stars, MIT, Python, latest visible release v0.7.0, Apr. 9, 2026. Its README describes tree-sitter-based analysis, language parsers loaded on demand, AST cursor traversal, text search, tree-sitter query execution, caching, symbol extraction, and dependency analysis.  ￼

**Deployment model.** It is local. It uses tree-sitter language packs/parsers and provides MCP tools for project registration, language management, file operations, AST analysis, code search, symbol extraction, dependency analysis, query building, similar-code detection, cache diagnostics, and configuration.  ￼

**Tree navigation comparison.** It has AST navigation, but not treenav-style hierarchical retrieval. The tree is a concrete syntax/AST tree for source files, not a unified content tree of docs, symbols, and structured data. It also does not provide BM25-ranked search over the corpus. An agent gains precise structural code introspection, but loses relevance-ranked retrieval and documentation browsing.

**Positioning.** Pick mcp-server-tree-sitter for deep AST questions: "what symbols are in this file?", "run this tree-sitter query," "analyze dependencies," or "inspect syntax." Pick treenav for content retrieval: "find the best section/code symbol about rate limiting and retrieve the relevant node." tree-sitter MCP can answer structural code questions treenav cannot; treenav can unify docs/code search and rank relevance.

---

### Serena — oraios/serena

**One-line description.** Serena is an agent-oriented coding toolkit that gives LLMs IDE-like symbolic editing, navigation, and project-memory tools through MCP.

**Facts.** The repo renders at roughly 23.9k stars, MIT, latest visible release v1.2.0, Apr. 27, 2026. Current docs describe two backends: a free/default Language Server Protocol backend and a paid JetBrains plugin backend. The LSP backend supports 40+ programming languages through language servers.  ￼

**Deployment model.** Serena is local/client-integrated. It can be launched by MCP clients or run over HTTP. Its tools cover symbol discovery, references, declarations, implementations, symbolic editing/refactoring, regex/list/read/shell operations, and memory. It does not present itself as a BM25 or vector retrieval system.  ￼

**Tree navigation comparison.** Serena offers code-symbol navigation through LSP, not a browseable docs+code retrieval tree. An agent can inspect symbols and perform edits with IDE semantics, but it does not get treenav's unified Markdown heading tree, source symbol tree, CSV/JSONL row nodes, BM25 search, or grep in one content index.

**Positioning.** Pick Serena for coding-agent workflows where editing, refactoring, LSP references, and IDE-like semantics matter. Pick treenav when the task is read-only retrieval across docs and source code. Serena can do symbolic editing and reference-aware code operations treenav intentionally does not; treenav can search/navigate documentation and structured data Serena does not index.

---

### ast-grep-mcp

**One-line description.** ast-grep-mcp exposes ast-grep structural code search and rule matching through MCP.

**Facts.** The repo renders at roughly 401 stars, MIT, Python, with no visible releases. Its README describes AST pattern matching for finding code constructs, YAML rule testing, AST debugging, and tools such as `dump_syntax_tree`, `test_match_code_rule`, `find_code`, and `find_code_by_rule`. It requires ast-grep and uv.  ￼

**Deployment model.** It is local and depends on the ast-grep binary. It supports many common languages via ast-grep, including JavaScript, TypeScript, Python, Rust, Go, Java, C/C++, C#, and others. It is not a retrieval/ranking system and does not require embeddings or LLM calls.  ￼

**Tree navigation comparison.** ast-grep-mcp does not expose a tree-navigation workflow. Its primitive is structural pattern matching: "find code matching this AST shape." An agent gains precise refactoring-pattern search, but loses BM25 relevance ranking, documentation retrieval, node browsing, and composed section retrieval.

**Positioning.** Pick ast-grep-mcp when the query is structural: "find every `await` inside a loop," "match this call shape," or "apply a rule." Pick treenav when the query is informational or mixed docs+code: "where is token refresh documented and implemented?" ast-grep can match shapes treenav cannot; treenav can retrieve meaningfully ranked content across docs, code, and structured data.

---

### Sourcegraph Cody and Sourcegraph MCP

**One-line description.** Sourcegraph Cody is Sourcegraph's enterprise AI coding assistant, and Sourcegraph now also exposes an MCP server for code search, navigation, and analysis.

**Facts.** Cody is a commercial product rather than a single open-source MCP repo, so stars/license are not meaningful in the same way. Official Cody FAQ says Cody retrieves context using Sourcegraph code intelligence and sends prompt/context snippets to an LLM. Sourcegraph also documents a Sourcegraph MCP Server with endpoints such as `/.api/mcp` and tools for repository/file listing, keyword search, natural-language search, go-to-definition, references, VCS context, and Deep Search on Enterprise plans.  ￼

**Deployment model.** Sourcegraph is cloud/self-hosted/enterprise infrastructure. Cody can act as an MCP client through agentic context gathering, and Sourcegraph's MCP server can be connected to tools such as Claude Code, Cursor, and Amp. Cody Enterprise has retired embeddings in favor of Sourcegraph Search as the primary context source, according to Sourcegraph's Cody FAQ.  ￼

**Tree navigation comparison.** Sourcegraph's primitive is industrial code search/code intelligence across repositories, not treenav's source-document tree. It has code navigation and search, but not a single browseable heading/symbol tree over local Markdown docs, source code, and structured rows.

**Positioning.** Pick Sourcegraph/Cody for multi-repo enterprise code intelligence, RBAC, hosted/self-hosted search, editor integration, and enterprise procurement. Pick treenav for a lightweight local MCP retrieval layer over one corpus. Sourcegraph can operate at enterprise/multi-repo scale; treenav is simpler, deterministic, and free of enterprise backend/model dependencies.

---

### Aider repo map

**One-line description.** Aider's repo map is a codebase-summarization feature inside the Aider coding assistant, not an MCP server.

**Facts.** Aider docs say the repo map gives the LLM a concise map of important files, classes, functions, and signatures. It uses a graph-ranking algorithm over the repository structure and keeps the map under an active token budget. The default `--map-tokens` value is 1k tokens, expanding in some contexts when no files are already in chat.  ￼

**Deployment model.** It runs inside Aider as part of prompt construction. I did not find a primary-source current language-count number in the official Aider docs during this pass. Secondary documentation claims broad tree-sitter language support, but I would not publish an exact count without verifying it from Aider's repo or official docs.  ￼

**Tree navigation comparison.** Aider's repo map is a ranked skeleton/overview, not an agent-facing navigation tree. The agent does not call `get_node_content` or browse sibling sections; the repo map is injected into the prompt as compact context.

**Positioning.** Pick Aider's repo map when the goal is automatic prompt budgeting for code editing. Pick treenav when the agent needs explicit search, grep, symbol lookup, and selective retrieval calls. Aider can provide a conversation-aware overview before retrieval; treenav provides a queryable MCP retrieval layer.

---

### LlamaIndex TreeIndex

**One-line description.** LlamaIndex TreeIndex is a Python library index that builds an LLM-summary tree over text nodes and traverses it during query.

**Facts.** This is not an MCP server. The current API docs define TreeIndex as a tree-structured index where parent nodes summarize child nodes; defaults shown in the API include `num_children=10`, `build_tree=True`, and an optional LLM parameter. The query guide says tree querying traverses from root to leaf and that the default `child_branch_factor` is 1.  ￼

**Deployment model.** It is a library inside the broader LlamaIndex stack. It generally involves LLM calls at index/build time for summaries and at query time for traversal/answering, depending on configuration. It is not a standalone local MCP server.

**Tree navigation comparison.** LlamaIndex has a tree, but it is a generated summarization tree, not a source-native heading/symbol hierarchy. treenav preserves the document/code structure already present in the corpus and lets the agent retrieve exact nodes. LlamaIndex routes through summaries; treenav ranks and browses concrete sections.

**Positioning.** Pick TreeIndex when you are building a Python RAG app and want hierarchical summarization as part of the answer-generation process. Pick treenav when you need an MCP server that exposes deterministic, exact, local retrieval over existing structure. TreeIndex can synthesize summaries; treenav can retrieve exact source sections without LLM calls.

---

### Graphify — safishamsi/graphify, PyPI graphifyy

**One-line description.** Graphify is a Python knowledge-graph skill/CLI/MCP tool that maps code, docs, PDFs, images, videos, and other media into a queryable graph for AI coding assistants.

**Facts.** GitHub renders about 44.1k stars, MIT, Python, latest visible release v0.7.8, May 6, 2026. PyPI confirms the package name is `graphifyy`; the CLI remains `graphify`. The README says it outputs `graph.html`, `GRAPH_REPORT.md`, and `graph.json`.  ￼

**Deployment model.** Graphify runs locally as a slash-command-style skill, CLI, or MCP server. The CLI includes `--mcp`, and the MCP server can be launched with `python -m graphify.serve graphify-out/graph.json`. Verified MCP tools are `query_graph`, `get_node`, `get_neighbors`, and `shortest_path`. Code extraction is local via Tree-sitter with no API calls. Docs/PDFs/images go through the configured AI assistant/model backend; supported backends include Gemini, Kimi, Claude, OpenAI, and Ollama. The README says video/audio are transcribed locally with faster-whisper.  ￼

**Tree navigation comparison.** Graphify has graph navigation, not tree navigation. It represents concepts, code symbols, docs, and inferred relationships as nodes/edges, then applies NetworkX/Leiden-style graph analysis. It is excellent for paths, neighbors, communities, "god nodes," and surprising cross-module links, but it does not provide BM25-ranked section search or a source-faithful heading/symbol hierarchy.  ￼

**Positioning.** Pick Graphify for architecture maps, relationship discovery, multimodal repositories, and "how are these things connected?" Pick treenav for exact section retrieval, BM25 ranking, grep, symbol search, and fully offline/no-model indexing across Markdown/code/CSV/JSONL. Graphify can see relationships treenav does not model; treenav gives deterministic ranked retrieval without sending prose/media through a model backend.

---

### Semble — MinishLab/semble, PyPI semble

**One-line description.** Semble is a local-first semantic code-search MCP server using code-aware chunking, BM25, static Model2Vec code embeddings, RRF, and code-aware reranking.

**Facts.** GitHub rendered roughly 716–722 stars during this pass, MIT, Python, latest visible release v0.1.3, May 5, 2026. It exposes two MCP tools: `search` and `find_related`.  ￼

**Deployment model.** Semble runs locally through `uvx`. It indexes local paths or remote git URLs, clones remote repositories on demand, caches indexes for the session, and watches local paths. Its README claims average repo indexing around 250 ms, query latency around 1.5 ms on CPU, no API keys, no GPU, and no external services. The stack is Chonkie code chunking, static Model2Vec embeddings from `potion-code-16M`, BM25 via `bm25s`, Reciprocal Rank Fusion, and reranking signals such as adaptive lexical/semantic weighting, definition boosts, identifier stems, and file coherence.  ￼

**Benchmark caveat.** Semble's published benchmark reports 0.854 NDCG@10, 263 ms index time, 1.5 ms p50 query time, and "99% of a 137M-parameter transformer" quality with much faster indexing/querying. This is vendor-published; the benchmark README says its queries/labels and LLM-as-judge evaluation were generated using Claude Sonnet 4.6. The exact disk size of `potion-code-16M` was not verified from a primary source in this pass.  ￼

**Tree navigation comparison.** Semble has no browseable tree. Its primitive is ranked code chunks plus related-chunk expansion. It likely beats treenav for code-only natural-language semantic search, but it cannot browse docs and code as one tree.

**Positioning.** Pick Semble for fast semantic code search on CPU. Pick treenav for unified docs+code+CSV/JSONL retrieval, explicit hierarchy, grep, and no embedding model.

---

### mcp-ripgrep and mcp-grep wrappers

**One-line description.** These are thin MCP wrappers over local grep/ripgrep-style text search.

**Facts.** `mcollina/mcp-ripgrep` renders at roughly 67 stars, MIT, Node-based, and exposes tools such as search, advanced-search, count-matches, list-files, and list-file-types; it requires `rg` and Node 18+. `247arjun/mcp-grep` renders at roughly 6 stars, MIT, and wraps grep with intent/regex-oriented tools.  ￼

**Deployment model.** Local-only. No embeddings, no LLM, no model downloads, but it depends on local grep/ripgrep binaries. Each query scans files rather than using a prebuilt ranked index.

**Tree navigation comparison.** No tree, no BM25, no section model, no symbol model. The primitive is `path:line:match`. Agents get exact literal/regex results but no relevance ranking or browseable structure.

**Positioning.** Pick ripgrep/grep MCP when the query is exact: an error string, CLI flag, symbol name, or regex. Pick treenav when you want the same literal/regex capability plus BM25 ranking, snippets, symbol search, and tree navigation. ripgrep wrappers win on zero index warmup; treenav wins on multi-step retrieval efficiency and structured browsing.

---

### Official filesystem MCP and Claude Code built-ins

**One-line description.** The official MCP filesystem server and Claude Code's built-in tools form the "do nothing beyond files/search" baseline.

**Facts.** The `modelcontextprotocol/servers` repo renders at roughly 85.2k stars and describes its reference servers as educational/reference implementations, including Filesystem, Git, Fetch, Memory, Sequential Thinking, and Time. The filesystem server exposes file read/write/list/search/directory-tree tools and is MIT licensed.  ￼

**Deployment model.** Local filesystem access is permission-scoped to allowed directories. It performs file operations and filename/content search but does not build a content index. Claude Code itself also has built-in tools such as Glob, Grep, Read, Bash, WebFetch, WebSearch, and LSP-related code intelligence when plugins are installed. Anthropic's newer "Tool Search Tool" is about retrieving tool definitions with regex/BM25/embeddings, not indexing a user's code/docs corpus.  ￼

**Tree navigation comparison.** Filesystem MCP has directory trees, not document trees. Claude Code Grep/LSP can help locate code, but neither provides treenav's unified heading/symbol/row hierarchy with BM25 and composed retrieval.

**Positioning.** Pick filesystem MCP when the agent needs to read/write known paths. Pick treenav when the agent needs to find the right content before reading it. I did not find an Anthropic-published treenav-like indexed retrieval server beyond reference filesystem/git/fetch-style tools and Claude Code's built-ins.

---

## Client-side code-context systems worth mentioning, but not full MCP retrieval peers

### Continue

Continue is a coding-agent/client framework with custom code-RAG guidance. Its docs describe chunking code, generating embeddings, storing them in LanceDB, and optionally using Voyage models such as `voyage-code-3` and reranking with `rerank-2`. It can also define custom MCP tools such as `search_codebase` and `get_file_context`.  ￼

Tree comparison: Continue's primitive is embedding/vector retrieval and optional reranking, not a browseable source tree. Mention it as a client-side/vector-code-RAG comparator, not as a direct treenav replacement.

### Cursor

Cursor's current codebase-indexing internals were not cleanly verifiable from primary docs in this pass. An older Cursor forum post by a Cursor team member says local code chunks were sent to Cursor's server for embeddings and stored in a remote vector database, with code not stored after embedding, but that 2023 implementation detail may be stale. Do not publish current architecture claims without a fresh official docs source.  ￼

Tree comparison: Cursor competes on "agent knows the codebase" UX, but not as an inspectable MCP retrieval server with treenav-like node navigation.

### Cline

Cline is an agent/runtime rather than a retrieval server. Its docs list tools for reading files, regex search, listing code definitions, browser actions, command execution, and MCP tool use. It analyzes file structure and ASTs, runs regex searches, and reads relevant files while managing context.  ￼

Tree comparison: Cline can orchestrate search/read/code-definition tools, but it does not provide a persistent BM25 index or tree-navigable docs+code corpus. It could call treenav as an MCP tool rather than replace it.

---

## Newly discovered or gap-filling entrants

### Codanna

Codanna is worth adding to the watch list. Its README positions it as "X-ray vision for your codebase," with semantic search, call graphs, document search, MCP support, Rust implementation, and performance claims such as sub-10 ms lookups and 75k+ symbols/second parsing. It supports MCP over stdio/HTTP/HTTPS and requires about a 150 MB embedding model on first use. Those are project claims, not third-party benchmarks.  ￼

Tree comparison: Codanna appears closer to semantic symbol/code intelligence plus call/document graph than treenav's heading/symbol tree. It is relevant because it crosses code and docs more than pure code searchers.

### Claude Context — Zilliz

Claude Context is a semantic code-search MCP server from Zilliz. Its README requires Zilliz Cloud as the vector database and an OpenAI API key, with Node 20+. That makes it relevant to the vector-code-search landscape but not local-first/no-network in the treenav sense.  ￼

Tree comparison: It uses semantic/vector retrieval rather than tree navigation. It is a strong contrast case for treenav's no-cloud/no-API posture.

### johnhuang316/code-index-mcp

This is a separate project from ViperJuice's Code-Index-MCP and is worth not confusing in the doc. It renders at roughly 932 stars, MIT, Python, and describes dual-strategy code indexing with specialized Tree-sitter support for 10 core languages, fallback support for 50+ file types, and advanced search using tools such as ugrep/ripgrep/ag/grep.  ￼

Tree comparison: It is a code-index/search server, not a docs+code tree navigation system. It may deserve a footnote or separate row if the code-navigation table includes similarly named projects.

### mcp-codebase-search — teknologika

This is a relevant local semantic-search entrant. Its README describes a local-first MCP server using local embeddings, Tree-sitter-aware chunking, and LanceDB, with no cloud dependency by default. It is MIT and shows active release history around 0.1.16. It requires Node 22/npm 10 and downloads about 500 MB of embedding models on first use. Tools include codebase listing/search, stats, chunk/file content retrieval, adjacent chunks, file listing, and updating scans.  ￼

Tree comparison: It has semantic chunks and adjacent-chunk retrieval, not a browseable heading/symbol tree. It is relevant as a heavier local-semantic alternative to Semble.

### Long-tail semantic MCP searchers

I found smaller projects such as `mcp-codebase-searcher` and `mcp-semantic-search` that expose semantic code-search MCP tools, often with external APIs, Qdrant/Gemini, or less mature packaging. They are worth tracking in an appendix, but I would not promote them to the main competitor table unless you want a "long tail" section.  ￼

---

## Suggested final positioning update

Use this as the defensible treenav wedge:

> treenav-mcp is a deterministic, local-first MCP retrieval layer for agents that need BM25-ranked search, literal/regex grep, symbol search, composed retrieval, and explicit heading/symbol/row tree navigation across Markdown documentation, source code, and CSV/JSONL. It uses no LLMs, embeddings, vector database, model downloads, or network calls at index or query time.

And use this trade-off framing:

> treenav trades PageIndex's LLM-guided PDF/document reasoning, QMD's semantic doc recall, Graphify's relationship graph, Semble's semantic code embeddings, Serena's IDE-like editing semantics, and Sourcegraph's enterprise multi-repo code intelligence for a smaller, deterministic, inspectable, zero-model retrieval loop over a known local corpus.

That framing is neutral and resilient: it acknowledges where competitors win without weakening treenav's actual niche.
