# Competitive Landscape Research — Codex (May 2026)

> Research artifact captured verbatim. This is the Codex research brief
> received on 2026-05-07, with the appended sources document. Star
> counts, tool inventories, and other facts here represent the codex
> verification pass; the authored
> [`COMPETITIVE-ANALYSIS.md`](../COMPETITIVE-ANALYSIS.md) is updated
> separately and synthesizes findings from both this artifact and
> [`2026-05-07-competitive-landscape-claude.md`](./2026-05-07-competitive-landscape-claude.md).

---

# treenav competitive landscape — research brief (May 2026)

All facts below were verified against primary sources (GitHub READMEs, release notes, official docs) on May 7, 2026 unless flagged otherwise. Where vendor-published numbers are cited without third-party confirmation, they are flagged as **[vendor-claimed]**.

## VERIFY — existing entries

### PageIndex (VectifyAI/PageIndex + pageindex-mcp)
**29.1k stars** (main repo, up from 15.1k in Feb 2026 — significant growth), 2.5k forks, MIT, Python, no published releases. Pageindex-mcp wrapper still ~209 stars. Self-described "vectorless, reasoning-based RAG." Builds hierarchical tree index from PDFs via LLM (default `gpt-4o-2024-11-20`); markdown supported via `--md_path` using `#` heading levels. Three deployment modes: (1) self-host via this repo with standard PDF parsing; (2) cloud service with enhanced OCR/tree-building/retrieval; (3) enterprise (private/on-prem). Multi-LLM via LiteLLM. New since Feb: **PageIndex File System** — file-level tree layer for corpus-scale reasoning across millions of documents (announced via blog); chat platform at `chat.pageindex.ai`; an "Agentic Vectorless RAG" demo using OpenAI Agents SDK shipped to `examples/`. **Tree nav vs treenav:** PageIndex's tree is LLM-summarized at every level (each node has an LLM-generated `summary` field); treenav's tree comes free from markdown headings/code symbols with zero LLM calls. PageIndex routes by LLM reasoning at retrieval time; treenav routes by BM25 score plus deterministic navigation. **One thing it can't do:** zero-LLM retrieval — every PageIndex query consumes model tokens. **Mafin 2.5 / FinanceBench 98.7%** still cited in README.

### QMD (tobi/qmd) — Tobias Lütke
**16.5k stars** (was unstarred in original doc), 991 forks, MIT, TypeScript (81%) + Python (16.6%), latest **v2.0.1 Mar 11, 2026**. Three local GGUF models confirmed via README (`hf:` URIs in `src/llm.ts`): **embeddinggemma-300M-Q8_0** (~300MB), **qwen3-reranker-0.6b-q8_0** (~640MB), **qmd-query-expansion-1.7B-q4_k_m** (~1.1GB) — total ~2GB matches original doc. New since Feb: **HTTP transport** with daemon mode (`qmd mcp --http --daemon`) keeps models loaded across calls; **multilingual override** via `QMD_EMBED_MODEL` env var with Qwen3-Embedding-0.6B for CJK; **smart chunking** uses scored break points (heading=100, code-fence=80, blank-line=20) with 200-token search window; **context tree** feature (`qmd context add qmd://path`) is now framed as the "key feature" — described as a hierarchical context layer that returns parent context alongside each match. **MCP tools:** `query`, `get`, `multi_get`, `status` (4 confirmed). Position-aware blending preserves top-3 retrieval ranks against reranker. **Tree nav vs treenav:** QMD's "context tree" is a tagged hierarchy of human-written descriptions per path, not a structural index; treenav's tree is the document/code structure itself. Returns ranked chunks, not browseable sections.

### GitMCP (idosal/git-mcp)
**8.0k stars** (up from 7.6k), 707 forks, **Apache-2.0** (not MIT), TypeScript, Cloudflare Workers. Tools confirmed: `fetch_<repo>_documentation`, `search_<repo>_documentation`, `fetch_url_content`, `search_<repo>_code` (4 tools, plus generic variants on `gitmcp.io/docs`). Documentation priority order verified in README: **(1) `llms.txt`, (2) AI-optimized version of project's documentation, (3) `README.md`/root** — confirms original doc's correction. Privacy statement explicitly: "GitMCP only accesses content that is already publicly available" and respects `robots.txt` on GitHub Pages. No changes that would affect tree-nav comparison. **Tree nav vs treenav:** still none — flat content delivery. Smart search on documentation is GitHub's code search API (for code) and snippet extraction (for docs), not BM25 over a local index.

### docs-mcp-server (arabold/docs-mcp-server)
**1.0k stars**, 121 forks, MIT, TypeScript (99.8%), latest **v2.0.3 Feb 10, 2026**. Now rebranded as "Grounded Docs MCP Server: Open-Source Alternative to Context7, Nia, and Ref.Tools." Web UI on `localhost:6280`, Docker image `ghcr.io/arabold/docs-mcp-server:latest`. New since Feb: **OAuth2/OIDC authentication** docs added; **embedding model is now described as "optional but dramatically improves search quality"** — without one, search quality drops; supported providers OpenAI / Ollama / Gemini / Azure / Bedrock. Format support unchanged: HTML, Markdown, PDF, Word, Excel, PowerPoint, source code. **Tree nav vs treenav:** still chunk-based RAG, no heading hierarchy, no symbol tree.

### MCP-Markdown-RAG (Zackriya-Solutions)
Could not find substantive May 2026 updates from primary sources (GitHub repo did not surface in current search results in either README dump or recent activity). Original doc's characterization (vector-only via file-based Milvus, ~50MB embedding model) appears to still hold; **flag as not-reverified-this-pass** and demote to a one-line mention if it's clearly inactive. **Tree nav vs treenav:** vector chunks only; no tree.

### Context7 (upstash/context7)
**54.6k stars** (up from 45.7k), 2.6k forks, MIT, TypeScript (92.5%), latest **`@upstash/context7-mcp@2.2.4` May 4, 2026**. Major change since original doc: **CLI + Skills mode** added (`npx ctx7 setup`) — agents can now use Context7 via skill files without MCP at all; pick MCP or CLI mode at install. **Tools renamed:** `resolve-library-id` and `query-docs` (was `find_libraries` and `get_library_docs` in earlier versions). README confirms README's prior wording: "Context7 projects are community-contributed" and "the API backend, parsing engine, and crawling engine are private." Server URL `https://mcp.context7.com/mcp` requires `CONTEXT7_API_KEY` header. **Tree nav vs treenav:** none — Context7 is a key-value lookup of pre-indexed library snippets, no structural model.

### Code-Index-MCP (ViperJuice)
**Only 32 stars** (much smaller than typical MCP retrieval tools — flag in your positioning), MIT, Python, **v1.2.0-rc4 (beta)**, ghcr.io image `viperjuice/code-index-mcp`. Tools: `search_code`, `symbol_lookup`. Confirmed **48 languages** via tree-sitter (registry-based), BM25 via SQLite FTS5. New since original doc: **semantic search now supports either Voyage AI or a local vLLM endpoint** (was Voyage-only); **hybrid search with configurable BM25/semantic/fuzzy weights** (`HYBRID_SEARCH_BM25_WEIGHT=0.3`, `HYBRID_SEARCH_SEMANTIC_WEIGHT=0.5`, `HYBRID_SEARCH_FUZZY_WEIGHT=0.2`); **query-intent routing** — symbol-pattern queries (`class Foo`, `def bar`, CamelCase) bypass BM25 entirely and hit symbols table for sub-5ms lookups; reranker only applies to semantic path. Performance: sub-100ms search, sub-5ms symbol lookup. **Tree nav vs treenav:** has tree-sitter symbol extraction but no hierarchical navigation primitive — agents can find symbols and search code but can't browse a tree.

### mcp-server-tree-sitter (wrale)
**280 stars**, 37 forks, MIT, Python, last meaningful update March 2025 (FEATURES.md still pinned to that). README explicitly cites only **~10 fully-supported languages with symbol extraction + AST + queries** (Python, JavaScript, TypeScript, Go, Rust, C, C++, Swift, Java, Kotlin, Julia, APL) plus more via `tree-sitter-language-pack` (Bash, C#, Clojure, Elixir, Elm, Haskell, Lua, Objective-C, OCaml, PHP, Protobuf, Ruby, Scala, SCSS, SQL, XML). **The original doc's "100+ languages" claim is inflated** — `tree-sitter-language-pack` itself supports ~165 grammars but mcp-server-tree-sitter's first-class symbol extraction covers a fraction. Suggest "~30 named languages, more via the language pack." Tools: `register_project_tool`, `list_projects_tool`, AST queries, `get_query_template_tool`, `build_query`, `adapt_query`, `get_node_types`, similar code detection. **Tree nav vs treenav:** exposes raw tree-sitter ASTs (CST nodes) for inspection but no BM25 ranking and no persistent inverted index — every search re-parses.

### Serena (oraios)
**23.9k stars** (large, comparable to QMD), 1.6k forks, MIT, Python. Latest stable described as "likely the last release before stable v1.0.0 which will come together with the JetBrains IDE extension." **30+ programming languages via LSP** (Python, JavaScript, TypeScript, Java, etc.). Notable feature: language servers run in background thread, so MCP responds immediately on startup. Self-evaluation in README quotes Opus 4.6 (high) calling Serena's IDE-backed semantic tools "the single most impactful addition to my toolkit" for cross-file renames/moves/reference lookups. **Strongly cautions against installing via plugin marketplaces** — only via Quick Start. Tool surface includes symbol search, references, semantic edits, and `SearchForPatternTool`. **Tree nav vs treenav:** Serena exposes symbol-level code intelligence via LSP (definitions, references, rename), not a heading/symbol *tree* the agent navigates by hierarchy. It's a structured-code editor's brain, not a browseable corpus.

### ast-grep-mcp (ast-grep/ast-grep-mcp — official)
**399 stars**, MIT, Python, last commit April 21, 2026. Self-described as **"experimental"** in README. **4 tools confirmed:** `dump_syntax_tree`, `test_match_code_rule`, `find_code`, `find_code_by_rule`. Requires external `ast-grep` binary on PATH. Workflow is rule-iteration: write a YAML rule, test against snippet, then apply. Note: there's also `nnunley/ast-grep-mcp` (Rust port with diff-based responses) and a Docker MCP Catalog wrapper — not the same project. **Tree nav vs treenav:** structural pattern matching, not relevance ranking. Complementary tool, not a competitor for keyword search.

### Sourcegraph Cody — current state
Cody status from Sourcegraph's own changelog: **MCP support is for *agentic context gathering*** — i.e., Cody calls MCP servers; it is not itself an MCP server. Embedding retirement: per docs, **"Sourcegraph has since transitioned from embeddings to Sourcegraph Search as its primary context provider"** for Enterprise; lower tiers still support embeddings (text-embedding-ada-002 or Sourcegraph's own st-multi-qa-mpnet-base-dot-v1). **Multi-repo @-mention chat is capped at 10 repositories per query** (from Sourcegraph docs) — useful constraint to cite. SOC 2 Type II + ISO 27001:2022 still listed. **Tree nav vs treenav:** Cody does not expose a hierarchical structural index to agents — its retrieval is search-API + (optional) embeddings + LLM rewriting, returning ranked snippets.

### Aider's repo map
Default `--map-tokens` confirmed as **1024 (1k) tokens** (per `aider.chat/docs/repomap.html` and `docs/config/options.html`). Per Aider's **DeepWiki**: "supports 130+ languages through tree-sitter parsers" (each with a `tags.scm` query file) — **the original doc's wording about "many programming languages" understates the current breadth**. Uses `tree-sitter-language-pack` for the parser bundle, plus Pygments fallback for languages where queries only provide definitions (e.g., C++). PageRank seeded by chat files; binary search to fit budget. Optimized via `to_tree()` formatter using `grep_ast`'s `TreeContext`. **Tree nav vs treenav:** Aider's "map" is a token-budgeted ranked outline injected into prompts — not an interactive navigation primitive. The agent never asks "expand this node"; the map is a single artifact.

### LlamaIndex TreeIndex
LlamaIndex docs still describe TreeIndex with `child_branch_factor` parameter — default per the API reference is **`child_branch_factor=1`** (one child per descent level). At index time it recursively LLM-summarizes children into parents. **Could not find any 2026 changes to the API surface** — appears stable/de-emphasized in favor of newer LlamaIndex retrievers. Original doc's framing is still accurate.

## INVESTIGATE — added by Claude

### graphify (safishamsi/graphify, PyPI: `graphifyy` — double y)
**Stars 41.6k–43.5k** (varies across snapshots; star-history.com puts current at ~42.2k; main README at time of fetch said 41.6k; v3 tag page said 43.5k — repo is growing fast). 4.6k forks, MIT, Python (100%), latest v0.6.9 May 3, 2026. **Languages: 25 confirmed in v5/current README** (Python, JS, TS, Go, Rust, Java, C, C++, Ruby, C#, Kotlin, Scala, PHP, Swift, Lua, Zig, PowerShell, Elixir, Objective-C, Julia, Verilog, SystemVerilog, plus a few more); v1 was 13 languages, v3 was 20 — actively expanding. Leiden community detection via `graspologic` (now seeded for reproducibility), tree-sitter for code, `faster-whisper` local for audio/video. **MCP tools: 5 not 4** — `query_graph`, `get_node`, `get_neighbors`, `shortest_path`, **`god_nodes`** (per v4 CHANGELOG). MCP server runs via `python -m graphify.serve graphify-out/graph.json` or `--mcp` flag. The "local for code, online for prose" pipeline confirmed: code via tree-sitter (no network), docs/PDFs/images via your AI assistant's API key, audio/video local via faster-whisper. Confidence tags: EXTRACTED / INFERRED / AMBIGUOUS. New goodies since you wrote: git merge driver for `graph.json` (`graphify hook install`), `graphify extract` headless (Anthropic/OpenAI/Gemini/Moonshot/Ollama keys), entity dedup pipeline (entropy gate + MinHash/LSH + Jaro-Winkler + same-community boost), `--dedup-llm` flag. **Self-claimed "71.5× fewer tokens per query" on mixed corpora — [vendor-claimed], from a third-party blog post citing internal numbers.** **Tree nav vs treenav:** graphify is a *graph*, not a tree — no hierarchy, navigation is by traversal (neighbors, shortest path, communities). Loses: ranked keyword search, ability to expand a section by hierarchy. Wins: cross-module relationships, "god nodes" insight, design rationale extraction from `# WHY:` / `# NOTE:` comments.

### semble (MinishLab/semble, PyPI: `semble`)
**4 stars** confirmed (very early), 0 forks, MIT, Python (99.6%), v0.1.0 released **April 26, 2026**. Has **Zenodo DOI 10.5281/zenodo.19785932** and a citation block in README. **2 MCP tools confirmed:** `search`, `find_related`. Tech stack confirmed verbatim: **Chonkie** code-aware chunking + **`bm25s`** for lexical + **Model2Vec `potion-code-16M`** static embeddings (the model is ~16M parameters; a static embedding means no transformer forward pass at query time, runs on CPU). Fusion via **Reciprocal Rank Fusion (RRF)**. Code-aware reranking signals (verbatim from README): adaptive weighting (lexical for symbol queries, balanced for NL), definition boosts, identifier stems, file coherence, noise penalties (test/legacy/example/`.d.ts` down-ranked). **Vendor benchmarks (verify-but-flag):** [vendor-claimed] NDCG@10 0.854 on 1,250 queries / 63 repos / 19 languages; 263ms cold index; 1.5ms p50 query. README's table includes head-to-head vs CodeRankEmbed Hybrid (0.862, 57s, 16ms), vanilla BM25 (0.673, 0.02ms), ripgrep (0.126). The "99% of CodeRankEmbed Hybrid at 218× faster indexing, 11× faster queries" claim derives directly from this self-published benchmark. **Treat all numbers as the project's own evaluation, not third-party.** Setup: `claude mcp add semble -s user -- uvx --from "semble[mcp]" semble`. **Tree nav vs treenav:** chunked code, no hierarchical browse. `find_related` gives a follow-up by semantic similarity, not parent/child traversal. Code-only — does not index docs.

## DISCOVER — gaps & April–May 2026 entrants worth covering

### Claude Context (zilliztech/claude-context)
NPM `@zilliz/claude-context-mcp`, MIT, TypeScript monorepo (core + VSCode extension + MCP). Hybrid **BM25 + dense vector** retrieval via Reciprocal Rank Fusion; **tree-sitter AST chunking** with LangChain character splitter fallback. **14 confirmed languages** in README (TypeScript, JavaScript, Python, Java, C++, C#, Go, Rust, PHP, Ruby, Swift, Kotlin, Scala, Markdown). Embedding providers: OpenAI / VoyageAI / Ollama / Gemini. **Vector DB: Milvus or Zilliz Cloud (cloud-managed Milvus)** — meaning cloud or self-hosted Milvus deployment is required, this isn't pure-local. **Incremental indexing via Merkle trees** (FileSynchronizer detects only changed files). 4 tools: `index_codebase`, `search_code`, `clear_index`, `get_indexing_status`. [vendor-claimed] ~40% token reduction at equivalent retrieval quality from their `evaluation/` directory. Setup needs `OPENAI_API_KEY` + `MILVUS_TOKEN`. Node.js >=20 and <24 (Node 24 not supported as of latest). **Strongly relevant for the doc** — closest direct comparison to QMD on the "hybrid retrieval as MCP" axis, but with cloud vector DB requirement instead of local GGUF models. **Tree nav vs treenav:** AST chunks, no hierarchy. Emits ranked snippets only.

### codebase-memory-mcp (DeusData/codebase-memory-mcp)
**2.1k stars**, MIT, written in **pure C** (not Go despite some directory copy), single static binary for macOS/Linux/Windows. **155 languages** via vendored tree-sitter grammars compiled into the binary (a v0.6.0 release marker said 64–66 languages; current README says 155 — they expanded rapidly). **14 MCP tools**, plus a CLI mode. Index → SQLite knowledge graph + FTS5. **BM25 via SQLite FTS5 with `cbm_camel_split` tokenizer** (camelCase / snake_case aware). Cypher-like query language. **Louvain community detection** (different from Leiden — note for graphify comparison). HTTP route ↔ call-site matching, gRPC/GraphQL/tRPC service detection, dead code detection, Git diff impact mapping. [vendor-claimed] Linux kernel (28M LOC, 75 K files) indexed in 3 minutes; preprint cited as "arXiv:2603.27277" — **note this is a future arXiv ID format and the existence of this preprint cannot be verified** — treat as marketing copy, not academic. SLSA Level 3 build provenance + cosign signing + VirusTotal scanning gates each release. Auto-detects 11 agents on install (Claude Code, Codex CLI, Gemini CLI, Zed, OpenCode, Antigravity, Aider, KiloCode, VS Code, OpenClaw, Kiro). **Strongest "single static binary" pitch in the field — directly competes with treenav-mcp on zero-dependency philosophy, but with a knowledge-graph+BM25 stack rather than tree+BM25.** **Tree nav vs treenav:** graph + community model. Like graphify, no heading/symbol tree to browse.

### mcp-ripgrep (mcollina/mcp-ripgrep) — re-verified
**67 stars** (small but stable), MIT, Node.js. **5 tools confirmed:** basic search, advanced search (FixedStrings/FileType/IncludeHidden/etc.), count matches, list files (no search), list file types. Wraps system `ripgrep` binary. Original doc's framing still accurate. mcp-grep (247arjun) appears similar but smaller; no notable 2026 changes surfaced.

### Continue.dev codebase indexing — client-side competitor
Not an MCP server, but a **major competitor on the "let the agent navigate the codebase" axis** that the original doc doesn't address. Built into the Continue VS Code/JetBrains extension: **transformers.js for local embeddings** by default (in VS Code; JetBrains has no built-in embedder), **LanceDB for vector storage**, **SQLite for metadata**, **tree-sitter via `.scm` queries for code-snippet extraction**. Context providers: `@codebase`, `@folder`, `@search` (ripgrep-powered), `@tree`, `@repo-map`. Index lives at `~/.continue/index/index.sqlite`. Configurable to use OpenAI / Voyage `voyage-code-3` / Ollama / Gemini for embeddings. **Reranking with LLM** between `nRetrieve=25` and `nFinal=5` (defaults). Worth a mention as: "treenav is an MCP server, Continue is a coding client with built-in retrieval — they're orthogonal but compete for the same agent context budget."

### Anthropic-bundled retrieval (Claude Code)
**Claude Code does not bundle a retrieval/index MCP server** beyond the official filesystem reference server. Its built-in tools (per Anthropic's tools-reference docs and reverse-engineered system prompts in the wild) are **Glob** (file pattern matching, ripgrep-backed), **Grep** (ripgrep regex content search), **Read**, **Task/Explore** (sub-agents with their own context), and **Tool Search** (MCP tool discovery — claims [vendor-claimed] 85% token reduction over preloading all tool definitions). Anthropic's stated philosophy (Boris Cherny on Latent Space podcast, May 2025): "We tried very early versions of Claude that actually used RAG... Eventually, we landed on just agentic search... it outperformed everything. By a lot. And this was surprising." This is a **strong rhetorical anchor for treenav's positioning**: even Anthropic's own assistant ships with grep+glob+agent rather than a retrieval index, and treenav slots in as the structural augmentation that doesn't break the agentic-search model. The same blog/discussion notes "the sweet spot may be: light local indexing + model-driven query refinement!" — that's exactly treenav's pitch.

### Skipped (out of scope / not directly comparable)
- **engram** (199-biotechnologies) — personal-memory MCP with BM25 + ColBERT + KG; memory not code-search.
- **pdf-mcp** (jztan) — adjacent (BM25+FTS5+semantic via RRF, OCR), but PDF-only, complementary not competitive.
- **robotmem** — robot memory with FastEmbed ONNX (CPU-only) — confirms "static-embedding MCP" pattern is broader than just semble; useful precedent but out of scope.
- **AmanMCP**, **Daniel-Barta/mcp-rag-server**, and the dozens of one-off "BM25+vector codebase indexing" wrappers in the PulseMCP listings — long tail of similar tools, none with notable adoption or differentiation worth a section.

## Cross-cutting notes for the rewrite

1. **The "tree nav" axis honestly has only three tools that do hierarchical browsing as a first-class agent primitive: treenav, PageIndex, and graphify (graph rather than tree).** Everything else either returns ranked snippets (QMD, semble, Claude Context, docs-mcp-server, MCP-Markdown-RAG, Sourcegraph Cody) or returns flat files (GitMCP, Context7, mcp-ripgrep, filesystem MCP). Aider's repo-map and LlamaIndex TreeIndex are non-MCP variants of "construct a tree, drop it in the prompt." This is the cleanest single positioning move.

2. **"Static embeddings on CPU" is now a recognizable sub-genre.** Semble's `potion-code-16M` and the broader Model2Vec family represent a credible alternative to BM25-only that doesn't require GGUFs or GPUs — worth one sentence acknowledging in the BM25-Limitation section. FastEmbed (ONNX, CPU-only) is an even more general precedent.

3. **Anthropic's "agentic search beats RAG" position is your strongest external citation for the BM25-first design.** Cite the Latent Space podcast quote in your "Positioning" rather than burying it.

4. **graphify and codebase-memory-mcp are the two structurally similar competitors that emerged or matured most strongly between Feb and May 2026.** Both pitch "knowledge graph instead of vector RAG" with single-binary or single-package install. graphify owns the multi-modal angle (PDFs/images/video); codebase-memory-mcp owns the "single static binary, 155 languages, milliseconds" angle. They're the two most credible "you should have considered us" critiques an outside reviewer would raise — cover both.

5. **Star count distortions to fix in the original doc:**
   - Context7: 45.7k → **54.6k** (still #2-3 globally per registries)
   - PageIndex: 15K → **29.1k** (nearly doubled)
   - GitMCP: 7.6k → **8.0k**
   - QMD: unspecified → **16.5k** (real adoption)
   - Code-Index-MCP: unspecified → **only 32** (much smaller than implied; rebalance the section accordingly)
   - mcp-server-tree-sitter: unspecified → **280** (also small)
   - Aider language coverage: "many" → **130+ languages**
   - mcp-server-tree-sitter language coverage: 100+ → **~30 first-class, more via language-pack**

6. **License note:** Of the doc-retrieval cluster, only **GitMCP is Apache-2.0**; the rest are MIT. Worth a footnote if you ever discuss adoption in regulated environments.

7. **MCP tool counts to correct in the rewrite:**
   - graphify: 4 → **5** (`query_graph`, `get_node`, `get_neighbors`, `shortest_path`, `god_nodes`)
   - QMD: confirmed 4 (`query`, `get`, `multi_get`, `status`)
   - Context7: tool names are now `resolve-library-id` / `query-docs` (renamed)

---

# Sources for the May 2026 research pass

All URLs visited via `web_fetch` or `web_search` between sessions on May 7, 2026. Grouped by entry, with the verification depth flagged.

## Verify — existing entries

**PageIndex**
- Primary: https://github.com/VectifyAI/PageIndex (full README fetched)
- Secondary: https://github.com/VectifyAI/pageindex-mcp (referenced in original doc, not re-fetched this pass)

**QMD (tobi/qmd)**
- Primary: https://github.com/tobi/qmd (full README + architecture diagram fetched)
- Release info from same page (v2.0.1, Mar 11 2026)

**GitMCP (idosal/git-mcp)**
- Primary: https://github.com/idosal/git-mcp (full README fetched)

**docs-mcp-server (arabold)**
- Primary: https://github.com/arabold/docs-mcp-server (full README + repo metadata fetched)

**MCP-Markdown-RAG (Zackriya-Solutions)**
- Did not surface in searches; flagged as not-reverified-this-pass
- Original doc reference: https://github.com/Zackriya-Solutions/MCP-Markdown-RAG

**Context7 (upstash/context7)**
- Primary: https://github.com/upstash/context7 (full README fetched)
- Release info: v2.2.4 May 4 2026 from same page

**Code-Index-MCP (ViperJuice)**
- Search-only verification (no full fetch this pass)
- https://github.com/ViperJuice/Code-Index-MCP (README excerpts via search)
- https://github.com/ViperJuice/Code-Index-MCP/issues (star count: 32)
- Secondary aggregators: https://mcpservers.org/en/servers/ViperJuice/Code-Index-MCP, https://lobehub.com/mcp/viperjuice-code-index-mcp

**mcp-server-tree-sitter (wrale)**
- Search-only verification
- https://github.com/wrale/mcp-server-tree-sitter (README + FEATURES.md excerpts)
- https://github.com/wrale/mcp-server-tree-sitter/blob/main/FEATURES.md
- https://github.com/wrale/mcp-server-tree-sitter/blob/main/ROADMAP.md
- https://github.com/wrale/mcp-server-tree-sitter/pulls (star count: 280)
- Secondary: https://www.juheapi.com/mcp-servers/wrale/mcp-server-tree-sitter, https://glama.ai/mcp/servers/@wrale/mcp-server-tree-sitter

**Serena (oraios)**
- Search-only verification
- https://github.com/oraios/serena (README excerpts via search)
- https://github.com/oraios/serena/blob/main/README.md
- https://github.com/oraios/serena/releases
- https://github.com/oraios/serena/issues (star count: 23.9k)
- Secondary: https://www.pulsemcp.com/servers/oraios-serena (star count + ranking)
- https://github.com/mcp/oraios/serena (GitHub MCP Registry listing)

**ast-grep-mcp (official ast-grep/ast-grep-mcp)**
- Search-only verification
- https://github.com/ast-grep/ast-grep-mcp
- https://github.com/ast-grep (org page; 399 stars, last commit Apr 2026)
- https://ast-grep.github.io/advanced/prompting.html (official "Using ast-grep with AI Tools" guide)
- Alternative implementations noted but not used: https://github.com/nnunley/ast-grep-mcp, https://hub.docker.com/mcp/server/ast-grep

**Sourcegraph Cody**
- https://sourcegraph.com/changelog/mcp-context-gathering (MCP support is for *agentic context gathering* — Cody as MCP client)
- https://sourcegraph.com/blog/cody-supports-anthropic-model-context-protocol (original MCP integration announcement)
- https://sourcegraph.com/blog/anatomy-of-a-coding-assistant (embedding model details: text-embedding-ada-002 + st-multi-qa-mpnet-base-dot-v1)
- Secondary (competitor-marketing pages, used only for cross-checking the embeddings-retirement claim — flag as not-fully-independent): https://www.augmentcode.com/tools/sourcegraph-cody-vs-continue-enterprise-comparison, https://www.augmentcode.com/tools/cursor-vs-sourcegraph-cody-embeddings-and-monorepo-scale, https://www.augmentcode.com/tools/google-antigravity-vs-sourcegraph-cody, https://www.augmentcode.com/tools/sourcegraph-cody-vs-qodo

**Aider repo-map**
- https://aider.chat/docs/repomap.html (`--map-tokens` default = 1024)
- https://aider.chat/docs/config/options.html
- https://aider.chat/2023/10/22/repomap.html (original tree-sitter repo-map blog post)
- https://aider.chat/docs/ctags.html (historical context, predecessor)
- https://aider.chat/docs/languages.html (language support)
- https://aider.chat/docs/faq.html
- https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping (130+ languages claim — DeepWiki, treat as secondary)
- https://deepwiki.com/Aider-AI/aider/4-repository-and-version-control

**LlamaIndex TreeIndex**
- Did not re-fetch primary docs this pass; relied on prior knowledge of API surface
- Reference URLs from original doc: https://docs.llamaindex.ai/en/stable/api_reference/indices/tree/, https://docs.llamaindex.ai/en/stable/module_guides/indexing/index_guide/

## Investigate — newly added entries

**graphify (safishamsi/graphify)**
- Primary: https://github.com/safishamsi/graphify (full README fetched, v6 + main branches)
- Tag/branch pages confirming star variance: https://github.com/safishamsi/graphify/tree/v3, https://github.com/safishamsi/graphify/blob/v3/README.md, https://github.com/safishamsi/graphify/blob/v5/README.md, https://github.com/safishamsi/graphify/blob/v7/README.md, https://github.com/safishamsi/graphify/tree/v3/graphify, https://github.com/safishamsi/graphify/tree/v4/graphify, https://github.com/safishamsi/graphify/tree/v1/graphify
- Release notes: https://github.com/safishamsi/graphify/releases
- v4 changelog confirming 5 MCP tools incl. `god_nodes`: https://github.com/safishamsi/graphify/blob/v4/CHANGELOG.md
- Issue threads referenced: https://github.com/safishamsi/graphify/issues/146 (MCP integration discussion), https://github.com/safishamsi/graphify/issues/152 (agentmemory integration), https://github.com/safishamsi/graphify/issues/425 (multi-project hierarchy)
- Marketing site: https://graphify.net/, https://graphify.net/graphify-cli-commands.html
- PyPI: https://pypi.org/project/graphifyy/
- Star tracking: https://www.star-history.com/safishamsi/graphify/, https://trendshift.io/repositories/25296
- Third-party blog (used only for the "71.5× fewer tokens" claim, flagged as vendor-claimed): https://blog.gopenai.com/graphify-build-a-knowledge-graph-from-your-entire-codebase-without-sending-your-code-to-anyone-1b6924474b50
- Adoption guide (third-party): https://gist.github.com/ashokvarmamatta/344a642e8b5bd286be605a8f439c3848
- Skills aggregator: https://skillsovermcp.com/connect/safishamsi/graphify

**semble (MinishLab/semble)**
- Primary: https://github.com/MinishLab/semble (full README fetched twice — same content both times, including benchmark table)
- Implicitly referenced (not fetched separately): https://github.com/chonkie-inc/chonkie, https://github.com/MinishLab/model2vec, https://huggingface.co/minishlab/potion-code-16M, https://github.com/xhluca/bm25s, https://huggingface.co/nomic-ai/CodeRankEmbed
- Zenodo DOI cited in README: 10.5281/zenodo.19785932 (not independently verified; flagged)

## Discover — new entrants

**Claude Context (zilliztech/claude-context)**
- https://github.com/zilliztech/claude-context (README excerpts via search)
- https://github.com/lcretan/zilliztech.claude-context (mirror with same README)
- https://github.com/zchee/zilliztech-claude-context (another mirror)
- https://www.npmjs.com/package/@zilliz/claude-context-mcp (NPM package)
- https://deepwiki.com/zilliztech/CodeIndexer (architecture deep-dive — DeepWiki, secondary)
- Vendor blog: https://milvus.io/blog/why-im-against-claude-codes-grep-only-retrieval-it-just-burns-too-many-tokens.md, https://milvus.io/blog/build-open-source-alternative-to-cursor-with-code-context.md
- Third-party guides: https://www.augmentcode.com/mcp/claude-context-mcp-server, https://skywork.ai/skypage/en/unlocking-codebase-zilliz-claude-mcp/1978656702595375104, https://antigravity.codes/blog/claude-context-guide
- PulseMCP listing: https://www.pulsemcp.com/servers/zilliz-claude-context

**codebase-memory-mcp (DeusData)**
- https://github.com/DeusData/codebase-memory-mcp (README excerpts via search)
- https://github.com/DeusData/codebase-memory-mcp/releases
- https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.6.0
- https://github.com/DeusData/codebase-memory-mcp/blob/main/.clang-format
- https://github.com/DeusData/codebase-memory-mcp/issues (star count: 2.1k)
- Secondary listings: https://mcpstore.co/server/699ef9b62d20cd6fa24f996a, https://skillsllm.com/skill/codebase-memory-mcp, https://www.loaditout.ai/skills/DeusData/codebase-memory-mcp
- Self-cited preprint "arXiv:2603.27277" — **not independently verified, flagged as marketing copy**

**mcp-ripgrep (mcollina)**
- https://github.com/mcollina/mcp-ripgrep
- https://www.pulsemcp.com/servers/mcollina-ripgrep (star count: 67)
- https://playbooks.com/mcp/mcollina/mcp-ripgrep
- https://glama.ai/mcp/servers/@mcollina/mcp-ripgrep
- https://lobehub.com/mcp/mcollina-mcp-ripgrep
- https://mcp.directory/servers/ripgrep
- https://explainx.ai/mcp-servers/ripgrep
- https://claudecode.app/mcp/mcollina-mcp-ripgrep
- Skywork analysis: https://skywork.ai/skypage/en/matteo-collina-ripgrep-mcp-server/1980476673338494976

**Continue.dev (client-side comparison)**
- https://docs.continue.dev/customize/context/codebase
- https://docs.continue.dev/reference/deprecated-codebase
- https://docs.continue.dev/customize/custom-providers
- https://docs.continue.dev/customize/model-roles/embeddings
- https://deepwiki.com/continuedev/continue/3.4-codebase-indexing
- https://docs.plataformia.com/en/customization/context-providers
- Issues for context-quality: https://github.com/continuedev/continue/issues/952, https://github.com/continuedev/continue/issues/7072

**Anthropic-bundled retrieval (Claude Code)**
- https://code.claude.com/docs/en/tools-reference (Claude Code tools reference)
- https://github.com/anthropics/claude-code/issues/22429 (Glob/Grep/Explore behavior)
- https://gist.github.com/wong2/e0f34aac66caf890a332f7b6f9e2ba8f (reverse-engineered system prompt — secondary, treat as best-available rather than authoritative)
- https://blog.thepete.net/claude-code-tools/ (Pete's overview)
- https://www.aifreeapi.com/en/posts/claude-code-tool-search (Tool Search 85% reduction claim — vendor-claimed)
- https://www.vtrivedy.com/posts/claudecode-tools-reference
- https://israynotarray.com/en/ai/2026/04/29/claude-code-built-in-tools-explained/
- "Agentic search beats RAG" quote — sourced via https://zerofilter.medium.com/why-claude-code-is-special-for-not-doing-rag-vector-search-agent-search-tool-calling-versus-41b9a6c0f4d9, attributing Boris Cherny on the Latent Space podcast (May 2025); **the podcast itself was not fetched this pass** — treat the quote as second-hand.

## Cross-mentioned but not used as primary sources

- https://github.com/199-biotechnologies/engram (BM25 + ColBERT + KG memory MCP — out of scope)
- https://github.com/jztan/pdf-mcp (BM25+FTS5+semantic PDF MCP — out of scope, adjacent only)
- https://github.com/robotmem/robotmem (FastEmbed ONNX CPU-only — referenced as a precedent for static-embedding pattern)
- https://github.com/Daniel-Barta/mcp-rag-server (long-tail wrapper — not used)
- https://github.com/modelcontextprotocol/servers (official reference servers — already in original doc)
- https://github.com/safurrier/filesystem-mcp (referenced indirectly)
- https://github.com/johnhuang316/code-index-mcp (different project from the ViperJuice one — flagged but not used)
- https://github.com/mcp (GitHub MCP Registry — used for star verification only)

## Source-quality notes

- **Primary fetched (read in full):** PageIndex, QMD, GitMCP, docs-mcp-server, Context7, graphify (multiple branches), semble (twice).
- **Search-snippet only (not full fetch):** Code-Index-MCP, mcp-server-tree-sitter, Serena, ast-grep-mcp, Claude Context, codebase-memory-mcp, Continue.dev, Sourcegraph Cody, Aider, mcp-ripgrep. Snippets came from GitHub directly when available, and from aggregators (PulseMCP, LobeHub, Glama, Playbooks, MCPStore) when not. **Aggregator-only data points should be treated as lower-confidence than direct GitHub fetches.**
- **DeepWiki** entries (used for Aider, Continue, Claude Context architecture details) are LLM-generated wiki summaries and are good for orientation but are not authoritative for specific numbers — flag if you cite them.
- **Augment Code's competitor pages** (Cody vs Continue, Cody vs Cursor, Cody vs Qodo, Cody vs Antigravity) are competitor-marketing content. Used only to cross-check the "Sourcegraph transitioned from embeddings to Search" claim, which is also stated in Sourcegraph's own docs cited above. Don't cite Augment as primary.
- **Self-cited benchmarks** not independently verified, flagged as `[vendor-claimed]` in the brief: PageIndex's 98.7% on FinanceBench, QMD's reranker quality, semble's 0.854 NDCG@10 / 263ms / 1.5ms, graphify's "71.5× fewer tokens", Claude Context's "~40% token reduction", codebase-memory-mcp's 28M-LOC-in-3-min and "120× fewer tokens" and the unverifiable arXiv preprint, Aider's PageRank quality claims, Tool Search's "85% token reduction", Cody's enterprise scaling figures.
- **Star counts** can fluctuate hour-to-hour and across cached GitHub views — graphify is specifically noted because the star number disagreed across snapshots within the same session (41.6k on the README at fetch time vs 42.2k–43.5k in trending pages and tag views). Treat as "low-mid 40k range, growing fast" rather than a precise number.
