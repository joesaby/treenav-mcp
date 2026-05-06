# Acknowledgements

treenav is built on direct ideas, code patterns, and design choices borrowed from several upstream projects. This page is the canonical record of what we owe to whom. The README's "Standing on Shoulders" section is a short summary; this is the long form.

## Direct intellectual debts

### [PageIndex](https://pageindex.ai)

PageIndex demonstrated the agent-friendly **search → outline → retrieve** workflow that treenav is built around. Their core insight — that an agent reasoning over a hierarchical table of contents is more token-efficient than an agent searching a flat bag of chunks — is the foundation of every navigation tool in treenav. The `get_tree` / `navigate_tree` / `get_node_content` tool surface mirrors PageIndex's interaction model.

PageIndex itself is not used as a library; treenav implements the same workflow against a different storage layer (Bun, BM25, AST parsers).

### [Pagefind](https://pagefind.app) by [CloudCannon](https://cloudcannon.com)

Pagefind is the closest direct ancestor of `src/store.ts`. We borrowed:

- **Positional inverted index** with term-position-aware scoring
- **BM25** parameter conventions (`k1`, `b` defaults; per-field weights)
- **Density-based snippet** generation that prefers windows with multiple query-term hits
- **Filter facets** generated from frontmatter (mapped to our `meta` field)
- **Multisite collection weighting** (mapped to our `CollectionConfig.weight`)
- **Content hashing** for incremental re-indexing
- **Stemming** via a Porter-style algorithm

We did not vendor or fork Pagefind code — `src/store.ts` is an independent implementation of the same techniques in TypeScript. Full attribution lives in [`docs/DESIGN.md`](DESIGN.md).

### [Semble](https://github.com/MinishLab/semble) by [MinishLab](https://github.com/MinishLab)

Semble is a fast code-search MCP server with a hybrid lexical + static-embedding pipeline. The Tier 1–4 ranking improvements landing in treenav (definition boost, subtoken indexing, noise penalties, file coherence, RRF fusion, optional Model2Vec) are a port of techniques Semble validated on real code corpora. The full plan is at [`docs/plans/2026-05-03-semble-feature-port.md`](plans/2026-05-03-semble-feature-port.md), with task-level attribution.

We do not depend on Semble at runtime; we re-implement its ideas against treenav's tree model.

### [Model2Vec](https://github.com/MinishLab/model2vec) by [MinishLab](https://github.com/MinishLab)

When treenav's optional semantic layer ships (Tier 4), it will use Model2Vec's `potion-code-16M` static embedding model. Model2Vec's distillation technique — bake PCA + Zipf weighting into a fixed embedding table at distillation time, leaving runtime as plain tokenize → lookup → mean-pool — is what makes a Bun-native, dependency-free embedder feasible. The model weights are MinishLab's; treenav's runtime implementation is a TypeScript port that aims for bit-equivalence with the reference Python `model2vec` library (validated by golden-vector tests).

We considered the official [`model2vec-rs`](https://github.com/MinishLab/model2vec-rs) Rust crate. Rejected because it ships only Rust + CLI + experimental browser-WASM — no Node/NAPI bindings — so using it from Bun would have required more glue than porting the algorithm.

### [Bun](https://bun.com)

The runtime. We use `Bun.markdown.render` for parsing, `Bun.hash` for content hashing, `Bun.Glob` for file discovery, and `bun:ffi` is on the table for the Tier 4 embedder. Bun's startup time is also why treenav can be invoked as `bunx treenav` per agent session without measurable warmup cost.

### [Model Context Protocol](https://modelcontextprotocol.io) and the [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) by [Anthropic](https://anthropic.com)

The protocol and SDK that make treenav usable from any MCP-compatible client (Claude Code, Claude Desktop, Cursor, Cline, Continue, Goose, and others). `src/server.ts` and `src/server-http.ts` are thin wrappers over the SDK's stdio and Streamable HTTP transports.

## Tools used during development

These influenced how treenav is built but are not runtime dependencies:

- [Claude Code](https://claude.com/claude-code) — the primary development environment. Most of treenav's code, tests, and documentation were authored in collaboration with Claude inside Claude Code sessions.
- [`@huggingface/tokenizers`](https://www.npmjs.com/package/@huggingface/tokenizers) — pure-JS tokenizer library. Pinned for the future Model2Vec runtime (Tier 4) to avoid pulling `onnxruntime-node` and its native binary dependency story.
- [semantic-release](https://github.com/semantic-release/semantic-release) — automated versioning and changelog generation.

## Comparable projects

For a side-by-side comparison with PageIndex, QMD, GitMCP, Code-Index-MCP, and other adjacent projects, see [`docs/COMPETITIVE-ANALYSIS.md`](COMPETITIVE-ANALYSIS.md).
