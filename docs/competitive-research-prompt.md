# Competitive Research Prompt

Self-contained prompt used to refresh
[`COMPETITIVE-ANALYSIS.md`](./COMPETITIVE-ANALYSIS.md). Paste into a
research-capable assistant (codex, Claude with web access, etc.) when
the next refresh is due. The prompt is intentionally specific to
treenav's positioning — adjust the "Verify / Investigate / Discover"
sections for the new pass.

Last used: May 7, 2026.

---

## Prompt

**Targeted research: treenav competitive landscape refresh**

I'm refreshing a competitive analysis document for **treenav**, a local
MCP server that provides BM25 search + hierarchical tree navigation +
literal/regex grep + symbol search + composed retrieval, over Markdown
docs, source code, and CSV/JSONL — all in-memory, zero LLM calls at
index or query time, zero embeddings, zero model downloads. It exposes
9 MCP tools.

The doc is structured so each competitor section follows a consistent
template:

1. **What it is** — preamble (1–2 paragraphs: what it does, how it
   works, deployment model, stars/maturity, license).
2. **How tree navigation compares** — does it have a tree model? If
   yes, how does it differ from treenav's heading/symbol hierarchy?
   If no, what does it use instead (flat chunks, graph, embeddings,
   AST queries) and what does an agent lose without a browseable tree?
3. **Positioning** — when to pick which, actionable.

For each project below, I need the data to fill those three slots. Be
specific (numbers, file sizes, latency claims, license types) and flag
anything you can't independently verify (e.g. "vendor-claimed, not
third-party benchmarked").

### Verify (already in the doc — confirm or correct)

- **PageIndex** (`VectifyAI/PageIndex` + `VectifyAI/pageindex-mcp`) —
  current stars, deployment modes, any new features.
- **QMD** (`tobi/qmd`) — current state, model sizes, any changes.
- **GitMCP** (`idosal/git-mcp`) — current stars, tools, `llms.txt`
  behaviour.
- **docs-mcp-server / Grounded Docs** (`arabold/docs-mcp-server`).
- **Context7** (`upstash/context7`) — current stars, ranking among
  MCP servers.
- **Code-Index-MCP** (`ViperJuice`) — current stars, languages,
  FTS5 + Voyage AI status.
- **mcp-server-tree-sitter** (`wrale`).
- **Serena** (`oraios`) — current state, LSP integration, JetBrains
  backend status.
- **ast-grep-mcp** — current state.
- **Sourcegraph Cody / Sourcegraph MCP** — MCP client + server status,
  embedding retirement status.
- **Aider repo-map** — current default `--map-tokens`, tree-sitter
  language coverage.
- **LlamaIndex TreeIndex** — current API surface,
  `child_branch_factor` defaults.
- **Graphify** (`safishamsi/graphify`, PyPI `graphifyy`) — verify
  stars, tools (incl. `god_nodes`), language coverage, Leiden
  clustering, "local for code, online for prose" pipeline split, MCP
  server flag.
- **Semble** (`MinishLab/semble`, PyPI `semble`) — verify stars,
  release version, tools (`search`, `find_related`), tech stack
  (Chonkie chunking + `bm25s` + Model2Vec `potion-code-16M`),
  benchmark claims (NDCG@10, indexing/query latency, "% of
  CodeRankEmbed" claim) — flag clearly that these are vendor-published
  numbers and disclose the LLM-as-judge model used in the benchmark.
- **Claude Context** (`zilliztech/claude-context`) — current state,
  Milvus/Zilliz Cloud requirement, embedding providers.
- **codebase-memory-mcp** (`DeusData/codebase-memory-mcp`) — current
  stars, language coverage, single-static-binary claim, supply-chain
  hygiene (SLSA, cosign, VirusTotal). Independently verify any cited
  arXiv preprint.

### Investigate (newly surfaced or rumoured — verify against primary sources)

[List specific projects to investigate per pass.]

### Discover (gaps we may have)

- Any **MCP retrieval entrants** worth covering (local-first, BM25,
  hybrid, code-aware) that aren't already in the list above.
- Any **MCP servers that wrap embedding models** in a CPU-only /
  no-download way (semble-style static embeddings, ONNX, FastEmbed,
  etc.).
- Any **MCP client-side code-context tools** (Cline, Continue, Cursor,
  Aider, KiloCode) that compete on the "let the agent navigate the
  codebase" axis.
- The current state of **mcp-ripgrep** (`mcollina`) and **mcp-grep**
  (`247arjun`) — stars, any new variants worth naming.
- Any **Anthropic-published or Claude Code-bundled retrieval tools**
  beyond the official filesystem reference server.

### Output format

For each project, a tight brief (~150–250 words) hitting:

- One-line description (what it is, who makes it).
- Stars, license, language, latest release date if visible.
- Deployment model (local / cloud / hybrid; any model downloads
  required; any network calls at index or query time).
- Whether it has hierarchical tree navigation, and if not, what its
  retrieval primitive is (flat chunks, graph, vector similarity, AST
  queries, etc.).
- Strongest single claim or differentiator (with source link).
- One thing it cannot do that treenav can (or vice versa).

Flag anything you can't verify with a primary source (repo README,
official docs, release notes). Don't trust secondary write-ups for
star counts or benchmarks. Mark vendor-published numbers as
`[vendor-claimed]` and note when a benchmark was generated using an
LLM-as-judge (and which model).

Cap total output at ~6,000 words. Skip anything clearly out of scope
(general LLM frameworks, non-MCP RAG libraries) unless directly
comparable.

### Source-quality discipline

- **Primary sources only** for star counts, license, version, and
  feature claims (GitHub README, official docs, release notes, PyPI).
- **Aggregator data** (PulseMCP, LobeHub, Glama, Playbooks, MCPStore)
  is acceptable for sanity-checking but should be marked as
  lower-confidence than direct GitHub fetches.
- **DeepWiki summaries** are LLM-generated wiki articles — useful for
  orientation, not authoritative for specific numbers.
- **Competitor-marketing pages** (Augment, Skywork, etc.) should never
  be used as primary sources for competing tools.
- **Star counts** drift hour-to-hour; cite as "approximately N as of
  verification" rather than precise figures.
- **Self-cited preprints / DOIs / arXiv IDs** must be verifiable; if
  the citation fails verification, flag as marketing copy, not academic.
