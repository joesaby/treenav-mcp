# ADR 0003: Drop Code Tree from the Go Port

**Status:** Accepted
**Date:** 2026-04-11
**Deciders:** treenav-mcp maintainers
**Related:** [0002-typescript-to-go-migration.md](./0002-typescript-to-go-migration.md), [../PORT-PLAN.md](../PORT-PLAN.md), [../HANDOFF.md](../HANDOFF.md)

---

## Context

treenav-mcp has two distinct content pipelines sharing the same BM25 engine:

| Pipeline | Inputs | Extractor | MCP tools |
|---|---|---|---|
| **Doc tree** | markdown files | `src/indexer.ts` (regex + Bun.markdown fallback) | 5 read + 3 curation = 8 |
| **Code tree** | source code | `src/code-indexer.ts` + per-language regex parsers (`src/parsers/*.ts`) | 1 (`find_symbol`) |

ADR 0002 picked Go as the target language for a native-binary rewrite.
As the port moved into Phase A, three concerns converged on the code
tree specifically:

1. **The per-language parsers are regex-based.** They were explicitly
   acknowledged in the TS codebase as interim stopgaps for every language
   except Go (which uses stdlib `go/parser`). The extraction quality is
   mediocre and users regularly file false-negative bugs for nested generics,
   decorators, and other constructs regex can't reliably handle.

2. **A "proper AST" replacement is a separate project.** Doing it right
   means either `tree-sitter` — which adds a CGO dependency and complicates
   the cross-compilation story that motivated ADR 0002 in the first place —
   or pure-Go parsers per language, which is a multi-month effort with
   little overlap with doc tree. Either path deserves its own design, its
   own ADR, and its own release cadence. Bundling it into the doc-tree port
   delays the port without improving the outcome.

3. **Doc tree and code tree are functionally asymmetric.** Doc tree has
   frontmatter parsing, type inference, glossary expansion, and the entire
   curator write path (639 lines in TS, 3 MCP tools, 6 error codes). Code
   tree is a thin read-only path. Coupling them in one repo forces
   artificial symmetry and makes it harder to evolve either feature
   independently.

The simplest expression of all three concerns: don't port the code tree
at all. Ship `doctree-mcp` as doc-only. If a proper AST-based code indexer
is ever built, it ships as its own project with its own repo.

## Decision

**doctree-mcp is doc-tree-only.** The code tree subsystem is out of scope
for this repo. Specifically, doctree-mcp does not contain:

- `pkg/codeindex` package
- `internal/parsers/*` packages for source-code parsing
- `find_symbol` MCP tool
- `CODE_ROOT`, `CODE_COLLECTION`, `CODE_WEIGHT`, `CODE_GLOB` env vars
- Per-language parser sentinel errors in the error taxonomy
- Language / symbol_kind facets in the default index (these facets remain
  *possible* via frontmatter on doc-tree entries, but are not extracted
  automatically from source code)

Existing docs under `docs/features/` and `docs/spec/` that referenced these
surfaces have been either deleted (code-indexer.md, language-parsers.md,
spec/code-indexer.md) or will have the references stripped during Phase A
consolidation (mcp-tools, environment, error-taxonomy) — see
[../HANDOFF.md](../HANDOFF.md) for the cleanup checklist.

## Consequences

### Positive

- **Scope stays manageable.** The port is a one-engine-plus-one-wrapper
  project, not a two-engine project. Phase B test authoring and Phase C
  implementation both compress accordingly.
- **Single-binary story is preserved.** No tree-sitter CGO dependency,
  no multi-language parser burden. `go build` stays pure-Go and
  cross-compiles to five platforms with one environment variable.
- **doctree-mcp release cadence is independent** of any future code
  indexer project. Breaking changes in one never affect the other.
- **The BM25 engine is exercised by a single consumer** (doc tree + curator),
  which simplifies the parity fixture strategy — every query in the fixture
  corpus runs through a single code path.
- **Security and concurrency reviewers have less surface to audit.** The
  curator write path is the only mutation, `safepath` is the only
  user-path-handling surface, and `sync.RWMutex` has exactly one consumer.

### Negative

- **Feature regression for treenav-mcp users who use `find_symbol`.**
  Mitigation: treenav-mcp stays live with full code-tree functionality;
  users who need it stay on v1 (Bun/TS). The v2.0 doctree-mcp release
  notes must call this out prominently and link to treenav-mcp for
  affected users.
- **No obvious home for a future code indexer.** Mitigation: the lack of a
  pre-committed design leaves that project free to pick the best approach
  (tree-sitter vs pure-Go vs reuse a third-party engine) without being
  constrained by doctree's decisions. If a replacement ships, it gets its
  own repo (provisionally `joesaby/codetree-mcp` or similar) and its own
  ADR chain.
- **The existing `src/parsers/golang.ts` stdlib-based parser is not
  preserved.** Of all the code-tree parsers, this is the one that wasn't
  deprecated — Go has a real AST available. It is still discarded here
  because there's no point shipping a single-language code indexer; a
  multi-language AST story belongs in a dedicated project.

### Neutral

- **treenav-mcp remains the canonical home for code indexing** until either
  a replacement ships or the feature is formally retired. The deprecation
  timeline for treenav-mcp's code-tree is not set by this ADR.
- **The BM25 engine, tokenizer, and store in `pkg/treenav/store.go` are
  potentially reusable by a future code indexer.** If that future project
  happens, it can import doctree-mcp's `pkg/treenav` as a library
  dependency for the shared engine, or both can extract the store into a
  third package. Neither decision is made today.

## Non-goals

This ADR does **not** commit to:

- Building a replacement code indexer. If one happens, it's a separate
  project with its own ADR chain.
- Removing code tree from treenav-mcp. The TS implementation stays
  maintained as part of v1 until explicitly deprecated.
- Choosing between tree-sitter, pure-Go parsers, or any other approach
  for any future work.
- Committing to a deprecation timeline for treenav-mcp v1.

## Rollout

1. **On the treenav-mcp port branch** (`claude/rewrite-go-migration-LK31U`):
   - Delete `docs/features/code-indexer.md`,
     `docs/features/language-parsers.md`, `docs/spec/code-indexer.md`.
   - Update `docs/PORT-PLAN.md` to reflect the reduced scope.
   - Commit this ADR.
   - Commit `docs/HANDOFF.md` that explains the repo move.
   - Push to the branch.

2. **Move to `joesaby/doctree-mcp`** — the user creates the repo on GitHub
   and runs the extraction script in `docs/HANDOFF.md` from a local machine
   (sandbox limitations prevent this from being done inside the originating
   Claude Code session; see HANDOFF.md for the full explanation).

3. **In doctree-mcp**, complete the Phase A consolidation pass. During
   consolidation, strip remaining code-tree references from `mcp-tools`,
   `environment`, and `error-taxonomy` docs before they fold into
   `architecture.md` and `mcp-wrapper.md`.

4. **doctree-mcp `v2.0.0` release notes** prominently document that
   `find_symbol`, code indexing, and the `CODE_*` env vars are not present
   in doctree-mcp. Users who need them stay on treenav-mcp v1.

## References

- [../PORT-PLAN.md](../PORT-PLAN.md) — four-phase roadmap
- [../HANDOFF.md](../HANDOFF.md) — context for continuing in the new repo
- [0002-typescript-to-go-migration.md](./0002-typescript-to-go-migration.md) — Go migration decision
- `treenav-mcp/src/parsers/` — the regex-based parsers being retired
- `treenav-mcp/src/code-indexer.ts` — the coordinator being retired
