# treenav-mcp Go Port — Phase Plan

**Status:** In progress
**Branch:** `claude/rewrite-go-migration-LK31U`
**Related:** [docs/adr/0002-typescript-to-go-migration.md](./adr/0002-typescript-to-go-migration.md)

This document is the canonical roadmap for porting treenav-mcp from Bun/TypeScript
to Go. Every subsequent piece of work on this branch should be traceable back to a
phase below.

## Guiding principles

1. **Docs drive tests; tests drive code.** No implementation is written before a
   spec exists; no spec is written before a feature doc exists.
2. **Fixture-driven parity.** Every module is validated against JSON fixtures
   captured from the current TS implementation before its Go counterpart is
   touched. The TS version is the oracle until cutover.
3. **Leaves before roots.** Port in dependency order so each module can be
   tested in isolation with no mocking.
4. **Keep both codebases alive until cutover.** No TS file is deleted until the
   Go version passes parity on a real corpus.
5. **Don't port bugs.** Bugs found during the port are fixed in TS first,
   fixtures regenerated, then ported. This keeps the oracle honest.
6. **Security boundaries get extracted and isolated.** Path containment
   (`internal/safepath`) is the single source of truth for "is this path inside
   this root?" and ships with its own adversarial test suite before anything
   else touches filesystem paths.

## Phase overview

| Phase | Name | State | Output |
|-------|------|-------|--------|
| A | Docs & Specs | **In progress** | `docs/features/*.md`, `docs/spec/*.md`, this plan, ADR 0002 |
| B | Red tests | Pending | `tests/go/**` red unit + e2e tests, driven by specs |
| C | Implementation | Pending | `internal/**`, `cmd/treenav-mcp/**` — one module per PR |
| D | Parity & cutover | Pending | Full-corpus parity run, goreleaser, v2.0.0 release |

## Phase A — Docs & Specs

**Goal:** establish the written contract for every module before any code or
test is written.

Two artifact types, always paired:

- **`docs/features/<name>.md`** — user-facing "what and why". Go package layout,
  public API signatures (no bodies), key behaviors, non-goals, dependencies.
- **`docs/spec/<name>.md`** — contract-level "exactly how". Full type
  definitions, function signatures, step-by-step behavior, error tables, edge
  cases, parity requirements, test requirements, fixture layout.

### Feature inventory

Every feature listed below gets exactly one feature doc and one spec doc in
Phase A. Owners shown are the parallel agent that will write each group.

| # | Feature | Feature doc | Spec doc | Owner |
|---|---|---|---|---|
| 1 | Core data model | `features/core-data-model.md` | `spec/core-data-model.md` | Foundation |
| 2 | Safepath (path containment) | `features/safepath.md` | `spec/safepath.md` | Foundation |
| 3 | fsutil (file, glob, hash) | `features/fsutil.md` | `spec/fsutil.md` | Foundation |
| 4 | Frontmatter parser | `features/frontmatter.md` | `spec/frontmatter.md` | Foundation |
| 5 | BM25 engine | `features/bm25-engine.md` | `spec/bm25-engine.md` | BM25 |
| 6 | Glossary expansion | `features/glossary-expansion.md` | `spec/glossary-expansion.md` | BM25 |
| 7 | Incremental index | `features/incremental-index.md` | `spec/incremental-index.md` | BM25 |
| 8 | Markdown indexer | `features/markdown-indexer.md` | `spec/markdown-indexer.md` | Markdown |
| 9 | Code indexer | `features/code-indexer.md` | `spec/code-indexer.md` | Code |
| 10 | Language parsers | `features/language-parsers.md` | `spec/language-parsers.md` | Code |
| 11 | Curator | `features/curator.md` | `spec/curator.md` | Curator |
| 12 | MCP tools | `features/mcp-tools.md` | `spec/mcp-tools.md` | MCP |
| 13 | MCP server (stdio + HTTP) | `features/mcp-server.md` | `spec/mcp-server.md` | MCP |
| 14 | Search formatter | `features/search-formatter.md` | `spec/search-formatter.md` | MCP |
| 15 | Debug CLI | `features/cli-debug.md` | `spec/cli-debug.md` | MCP |
| 16 | Concurrency model | `features/concurrency-model.md` | `spec/concurrency-model.md` | Cross-cutting |
| 17 | Error taxonomy | `features/error-taxonomy.md` | `spec/error-taxonomy.md` | Cross-cutting |
| 18 | Distribution | `features/distribution.md` | `spec/distribution.md` | Cross-cutting |
| 19 | Environment variables | `features/environment.md` | `spec/environment.md` | Cross-cutting |

**Exit criteria:** every row above has both files committed; ADR 0002 is
merged; the spec for `safepath` explicitly enumerates adversarial path inputs.

## Phase B — Red tests

**Goal:** for every spec in Phase A, produce failing Go tests that encode the
spec's behavioral and parity requirements. Tests are written in parallel,
batched by feature group. All tests must fail initially (red) because no
implementation exists.

### Sub-phases (parallelizable)

1. **Test infrastructure** — `go.mod`, `cmd/treenav-mcp/main.go` stub,
   `internal/` skeleton, `testdata/corpus/`, fixture dump script
   `scripts/dump-fixtures.ts`, CI workflow that runs both `bun test` and
   `go test ./...`.
2. **Unit tests** — per-feature, one agent per group. Each agent reads the
   spec doc and produces `_test.go` files at
   `internal/<pkg>/<pkg>_test.go`. Test names map to spec bullets.
3. **E2E tests** — the full MCP round-trip, tool registration gating, corpus
   parity suite. Lives in `tests/e2e/` and drives the binary as a subprocess.
4. **Adversarial suite** — path traversal fuzz for `internal/safepath`,
   YAML round-trip, frontmatter edge cases, concurrent `addDocument` races
   (must pass `go test -race`).

**Exit criteria:** `go test ./...` runs and every test fails with a "not
implemented" error (or compiles but fails assertions). No green tests. CI is
green on the Bun side, intentionally red on the Go side.

## Phase C — Implementation (one by one)

**Goal:** turn every red test green, one module at a time, in strict
dependency order. Each sub-phase is one PR.

### Order

1. `internal/types` — data model structs (dependency of everything)
2. `internal/safepath` — path containment (security-critical, isolated first)
3. `internal/fsutil` — file IO, glob, hash
4. `internal/frontmatter` — YAML subset parser + reserved key handling
5. `internal/tokenize` — tokenizer + stemmer (leaf of BM25)
6. `internal/store` — BM25 inverted index, facets, scoring, snippets,
   glossary, incremental `AddDocument`
7. `internal/indexer` — markdown tree builder, `IndexFile`, type inference
8. `internal/parsers/{generic,python,rust,java,typescript}` — regex parsers
9. `internal/parsers/golang` — AST-based via stdlib `go/parser`
10. `internal/codeindex` — multi-language coordinator
11. `internal/searchfmt` — result formatter
12. `internal/curator` — `FindSimilar`, `DraftWikiEntry`, `WriteWikiEntry`
    (uses `safepath`, `indexer`, `store`)
13. `internal/mcp` — tool registration, `WIKI_WRITE` gating
14. `cmd/treenav-mcp` — stdio + HTTP transports, env parsing, CLI subcommands

Each PR must leave `main` shippable: previously green tests stay green, new
tests for the shipped module flip from red to green, unrelated tests remain
red. No module is considered done until its fixture-parity test matches the
TS output.

**Exit criteria:** every test from Phase B is green; `go test -race ./...`
is clean; a full corpus run indexes and queries identically to the TS
implementation on the chosen oracle corpus.

## Phase D — Parity & cutover

1. **Full corpus parity run** — 200+ queries, diff top-20 results between TS
   and Go implementations. Acceptable variance: zero rank differences on
   identical tokenization; tied-score reshuffling allowed only when
   explicitly tie-broken via deterministic secondary key.
2. **Benchmarks** — indexing time, query latency, memory footprint, binary
   size. Recorded in `BENCHMARKS.md`.
3. **Distribution** — `goreleaser.yml` for linux/darwin/windows × amd64/arm64,
   Homebrew tap, GitHub Release, Docker image on `scratch`/`distroless`.
4. **RC release** — tag `v2.0.0-rc.1`. Ship Go alongside TS. Solicit
   feedback for one cycle.
5. **Cutover** — make Go the default distribution; move TS to `legacy`
   branch for security-only maintenance; announce in README.

## Scope note: the curator feature

The wiki curation feature (PR #9) lands in the port as a first-class module,
not an afterthought. Its write path introduces four concerns that didn't
exist in the read-only port:

- **Path containment** — extracted into its own `internal/safepath` package
  so the security boundary is reviewable in isolation.
- **YAML round-trip** — `internal/curator.SerializeMarkdown` must emit bytes
  that `internal/indexer.IndexFile` parses back losslessly. Enforced by a
  round-trip property test.
- **Concurrency** — stdio MCP handlers may run on separate goroutines in Go
  (unlike Bun's single-threaded model). `internal/store` guards its index
  with `sync.RWMutex`; concurrent reads during writes are validated with
  `go test -race`.
- **Incremental reindex** — `internal/store.AddDocument` must update
  postings, facets, per-doc length, and `avgdl` correctly. Parity test:
  build(N) + AddDocument(N+1) must produce the same state as build(N+1).

See `docs/spec/curator.md` and `docs/spec/safepath.md` for the full
contract.
