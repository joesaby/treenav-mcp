# treenav-mcp Go Port — Phase Plan

**Status:** Phase A (docs) — consolidation pending; code-tree decoupling pending decision
**Branch:** `claude/rewrite-go-migration-LK31U`
**Related:** [docs/adr/0002-typescript-to-go-migration.md](./adr/0002-typescript-to-go-migration.md), ADR 0003 (deprecate regex code tree) pending

This document is the canonical roadmap for porting treenav-mcp from Bun/TypeScript
to Go. Every subsequent piece of work on this branch should be traceable back to
a phase below.

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
   fixtures regenerated, then ported.
6. **Security boundaries get extracted and isolated.** Path containment
   (`internal/safepath`) is the single source of truth for path validation and
   ships with its own adversarial test suite before anything else touches
   filesystem paths.
7. **Engine and wrapper are separable.** The BM25 / indexer / curator engine
   lives in `pkg/treenav` (importable as a library). The MCP protocol layer
   lives in `internal/mcp` (one consumer among potentially many). Single repo,
   single `go.mod`, single release cadence — split into a separate repo later
   only if external demand materializes.

## Go module layout

```
treenav-mcp/
├── go.mod                         # single module, no submodules
├── cmd/
│   └── treenav-mcp/
│       └── main.go                # MCP binary entry point
├── pkg/
│   └── treenav/                   # PUBLIC engine library — importable by third parties
│       ├── doc.go                 # package docs + usage examples
│       ├── types.go               # TreeNode, IndexedDoc, DocMeta, SearchResult, …
│       ├── store.go               # BM25 engine, facets, snippets, glossary, AddDocument
│       ├── indexer.go             # markdown: IndexFile, BuildTree, InferTypeFromPath
│       ├── codeindex.go           # code-indexing coordinator
│       └── curator.go             # FindSimilar, DraftWikiEntry, WriteWikiEntry
├── internal/                      # PRIVATE — refactor freely, no API guarantees
│   ├── safepath/                  # path containment (security boundary)
│   ├── fsutil/                    # file, glob, hash wrappers
│   ├── frontmatter/               # YAML subset parser
│   ├── tokenize/                  # tokenizer + stemmer
│   ├── parsers/
│   │   ├── golang/                # stdlib go/parser + go/ast (accuracy upgrade)
│   │   ├── typescript/
│   │   ├── python/
│   │   ├── rust/
│   │   ├── java/
│   │   └── generic/
│   ├── searchfmt/                 # search result → Markdown formatter
│   └── mcp/                       # MCP wrapper: tools, stdio + HTTP transports
├── testdata/
│   ├── corpus/                    # representative markdown + code
│   ├── fixtures/                  # JSON snapshots from the TS oracle
│   └── adversarial-paths.json     # safepath fuzz inputs
├── tests/
│   └── e2e/                       # subprocess-level MCP round-trips
├── docs/                          # consolidated — see Phase A
├── scripts/
│   └── dump-fixtures.ts           # TS → JSON fixture dumper
└── .github/workflows/             # Bun + Go CI matrix
```

### Key boundaries

- **`pkg/treenav`** has a stable, documented public API. External Go code can
  import it: `import "github.com/joesaby/treenav-mcp/pkg/treenav"`. Consumers
  could build a CLI, a REST API, a VS Code extension, or an alternative MCP
  server with custom tools — none of which need the MCP protocol layer.
- **`internal/`** packages are private. They can be refactored freely between
  releases without breaking external consumers.
- **`cmd/treenav-mcp`** is the MCP server binary. It wires `pkg/treenav`
  (engine) and `internal/mcp` (wrapper) together.
- Splitting `pkg/treenav` into its own repo later is a `git filter-repo`
  operation — the layout is split-ready without committing to split today.

## DocTree vs CodeTree asymmetry

The engine distinguishes two content types, and the port respects the asymmetry
rather than forcing artificial symmetry:

| Capability | DocTree (markdown) | CodeTree (source) |
|---|---|---|
| Indexing | ✓ | ✓ |
| BM25 search (shared engine) | ✓ | ✓ |
| Tree navigation | ✓ | ✓ |
| Frontmatter parsing (YAML) | ✓ | — |
| Type inference from path | ✓ (runbooks/ → runbook) | — |
| Glossary expansion | ✓ | ✓ |
| **Write path / curation** | ✓ (findSimilar, draft, write) | — (read-only) |
| YAML round-trip serialization | ✓ | — |
| Default enablement | always on | off unless `CODE_ROOT` set |
| Dedicated MCP tools | **5 read + 3 curation = 8** | **1** (`find_symbol`) |

**DocTree has meaningfully more functionality than CodeTree.** Code indexing is
a thin path: glob → parse → build tree → hand to the shared BM25 engine.
Doc indexing adds frontmatter parsing, type inference, and the entire curator
write path (639 lines in TS, 3 MCP tools, 6 error codes).

**Implications for the port:**

- `pkg/treenav/indexer.go` (doc) is meaningfully larger than
  `pkg/treenav/codeindex.go` (code coordinator). Expected, not a smell.
- `pkg/treenav/curator.go` has no codetree counterpart. A "write path for
  code" is explicitly out of scope; if demand materializes it deserves its own
  ADR.
- Phase A docs cover both under `docs/indexing.md` but the asymmetry is called
  out in that doc.
- Phase B test distribution is lopsided toward doctree. Correct.

## Phase overview

| Phase | Name | State | Output |
|---|---|---|---|
| A | Docs & Specs | **In progress** (consolidation pending) | 8 consolidated docs + 2 ADRs |
| B | Red tests | Pending | Three tiers: library, wrapper, e2e |
| C | Implementation | Pending | Module-by-module in dependency order |
| D | Parity & cutover | Pending | Full-corpus parity run + goreleaser + v2.0.0 RC |

## Phase A — Docs & Specs

**Goal:** establish the written contract for every module before any code or
test is written.

### Execution history

An initial parallel agent sprint produced 38 topic-granular files under
`docs/features/` and `docs/spec/`. That granularity was overkill — 15,000 lines
of docs for 5,400 lines of TS code. The consolidation pass merges them into
**8 meaningful documents** mirroring the Go package layout, and the
`docs/features/` and `docs/spec/` scratch directories are deleted.

### Target document set (after consolidation)

| Doc | Go surface | Tier |
|---|---|---|
| `docs/PORT-PLAN.md` | — (this file) | meta |
| `docs/adr/0002-typescript-to-go-migration.md` | — | meta |
| `docs/architecture.md` | cross-cutting: layering, concurrency (`sync.RWMutex`), error taxonomy, distribution (goreleaser), env contract | meta |
| `docs/core-data-model.md` | `pkg/treenav/types.go` — TreeNode, IndexedDoc, DocMeta, SearchResult, facets | engine |
| `docs/bm25-engine.md` | `pkg/treenav/store.go` — BM25 formula, tokenization, stemming, inverted index, facets, snippets, glossary, incremental `AddDocument` | engine |
| `docs/indexing.md` | `pkg/treenav/indexer.go` + `pkg/treenav/codeindex.go` + `internal/parsers/*` + `internal/frontmatter` + `internal/fsutil` — both doc-tree and code-tree, asymmetry documented | engine |
| `docs/curator.md` | `pkg/treenav/curator.go` — FindSimilar, DraftWikiEntry, WriteWikiEntry, YAML round-trip, error codes | engine |
| `docs/safepath.md` | `internal/safepath` — path containment + 30-row adversarial input table | engine/security |
| `docs/mcp-wrapper.md` | `internal/mcp` + `cmd/treenav-mcp` — 9 MCP tools, stdio + HTTP transports, search formatter, debug CLI subcommand | wrapper |

**Total: 8 docs + 2 ADRs + this plan = 11 files in `docs/`.**

### Missing specs handled inline during consolidation

The agent sprint produced 19 feature docs but only 13 specs — the 6 missing
specs (`bm25-engine`, `curator`, `glossary-expansion`, `incremental-index`,
`language-parsers`, `markdown-indexer`) correspond to the parity-critical
modules where the TS source is the authoritative oracle. These are written
during consolidation by reading `src/store.ts`, `src/curator.ts`, `src/indexer.ts`,
`src/code-indexer.ts`, and `src/parsers/*.ts` directly. No additional agents.

**Exit criteria:** the 11 files above exist; `docs/features/` and `docs/spec/`
scratch directories are deleted; every module's behavior is described precisely
enough to drive a Phase B red test without reading the TS source; ADR 0002 is
merged.

## Phase B — Red tests

**Goal:** for every section in Phase A, produce failing Go tests. Parallelizable
across feature groups. All tests initially red because no implementation exists.

### Three test tiers

1. **Library tests** — `pkg/treenav/*_test.go`. No MCP dependency. Fast, run on
   every change. Cover BM25 parity, tokenization, indexer output, curator
   behavior, incremental reindex, fixture-based parity against the TS oracle.
2. **Wrapper tests** — `internal/mcp/*_test.go`. Use an in-memory transport
   over a real `pkg/treenav` engine instance. Cover tool registration (6/9
   gating on `WIKI_WRITE`), input schema validation, JSON serialization quirks
   (`make([]T, 0)` vs `null`), error-to-JSON-RPC mapping.
3. **E2E tests** — `tests/e2e/`. Spawn `cmd/treenav-mcp` as a subprocess, send
   real JSON-RPC over stdio. Covers full-stack round-trips, corpus parity,
   adversarial-path rejection, concurrent read/write races (under
   `go test -race`).

### Sub-phases (parallelizable)

1. **Test infrastructure** — `go.mod`, package skeletons, `testdata/corpus/`,
   `testdata/fixtures/`, `scripts/dump-fixtures.ts` run against the corpus to
   emit JSON snapshots, CI workflow running both `bun test` and
   `go test -race ./...`.
2. **Library unit tests** — per-module, driven by the consolidated specs.
3. **Wrapper unit tests** — tool registration + gating + error mapping.
4. **E2E tests** — subprocess round-trips + corpus parity diff.
5. **Adversarial suite** — `safepath` fuzz (`go test -fuzz`), YAML round-trip
   property test, concurrent `AddDocument` race test.

**Exit criteria:** `go test ./...` compiles and runs; every test fails (red)
because nothing is implemented; CI is green on Bun, intentionally red on Go.

## Phase C — Implementation (one by one)

**Goal:** turn red tests green, one package at a time, in strict dependency
order. One PR per sub-phase.

### Order

1. `pkg/treenav/types.go` — data model (dependency of everything)
2. `internal/safepath` — path containment (security-critical, isolated first,
   fuzz-tested before anything depends on it)
3. `internal/fsutil` — file IO, glob, hash wrappers
4. `internal/frontmatter` — YAML subset parser + reserved-key handling
5. `internal/tokenize` — tokenizer + stemmer (BM25 leaf)
6. `pkg/treenav/store.go` — BM25 engine: inverted index, facets, scoring,
   snippets, glossary, incremental `AddDocument`. **Highest-risk sub-phase** —
   parity-tested against fixtures before proceeding.
7. `pkg/treenav/indexer.go` — markdown tree builder, `IndexFile`, type inference
8. `internal/parsers/{generic,python,rust,java,typescript}` — regex parsers,
   parallelizable within this sub-phase
9. `internal/parsers/golang` — stdlib `go/parser` + `go/ast` implementation
10. `pkg/treenav/codeindex.go` — multi-language coordinator
11. `internal/searchfmt` — result formatter
12. `pkg/treenav/curator.go` — `FindSimilar`, `DraftWikiEntry`, `WriteWikiEntry`.
    Depends on `internal/safepath`, `pkg/treenav/store`, `pkg/treenav/indexer`.
13. `internal/mcp` — tool registration, `WIKI_WRITE` gating, stdio + HTTP
    transports
14. `cmd/treenav-mcp` — env parsing, CLI subcommands (`serve` default, `index`
    debug), main entry point

Each PR must leave `main` shippable: previously-green tests stay green, new
tests for the shipped module flip red → green, unrelated tests remain red.

**Exit criteria:** all Phase B tests green; `go test -race ./...` clean;
full-corpus parity run matches TS on 200+ queries.

## Phase D — Parity & cutover

1. **Full corpus parity run** — 200+ queries, diff top-20 results between TS
   and Go on an oracle corpus. Acceptable variance: zero rank differences on
   identical tokenization.
2. **Benchmarks** — indexing time, query latency, memory footprint, binary
   size. Recorded in `BENCHMARKS.md`.
3. **Distribution** — `.goreleaser.yml` for linux/darwin/windows × amd64/arm64,
   Homebrew tap, GitHub Release automation, Docker image on
   `gcr.io/distroless/static-debian12` or `scratch`.
4. **RC release** — tag `v2.0.0-rc.1`. Ship Go alongside TS for one cycle.
5. **Cutover** — make Go the default; move TS to `legacy` branch for
   security-only maintenance; update README.

## Scope note: the curator feature (write path)

The wiki curation feature (PR #9, `docs/adr/0001-llm-curated-wiki.md`)
introduces four concerns the read-only port didn't need:

- **Path containment** — extracted into `internal/safepath` so the security
  boundary is reviewable in isolation. Used by the curator; nothing else
  touches user-supplied paths without going through it.
- **YAML round-trip** — `pkg/treenav/curator.go:SerializeMarkdown` must emit
  bytes that `pkg/treenav/indexer.go:IndexFile` parses back losslessly.
  Enforced by a property test in Phase B.
- **Concurrency** — `internal/mcp`'s stdio handlers may run on separate
  goroutines in Go (unlike Bun's single-threaded model). `pkg/treenav/store.go`
  guards its index with `sync.RWMutex`; concurrent reads during writes are
  validated under `go test -race`.
- **Incremental reindex** — `pkg/treenav/store.AddDocument` must correctly
  update postings, facets, `doc_lens`, and `avgdl`. Parity test:
  `Build(N)` + `AddDocument(N+1)` must produce the same state as `Build(N+1)`.

See `docs/curator.md` and `docs/safepath.md` for the full contracts.
