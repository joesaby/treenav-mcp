# ADR 0002: Port treenav-mcp from Bun/TypeScript to Go

**Status:** Proposed
**Date:** 2026-04-11
**Deciders:** treenav-mcp maintainers
**Related:** [docs/PORT-PLAN.md](../PORT-PLAN.md), [docs/adr/0001-llm-curated-wiki.md](./0001-llm-curated-wiki.md)

---

## Context

treenav-mcp ships today as a Bun/TypeScript MCP server. Distribution is via
`bun install` or a Docker image built from `oven/bun`. The Bun runtime is a
dependency of running the tool — end users must install Bun (or use the
container) before `treenav-mcp` can start.

Three pressures are pushing us toward native single-file distribution:

1. **Non-technical users.** A growing share of users want to `brew install
   treenav-mcp` or download a single binary from GitHub Releases, drop it in
   `~/bin`, and be done. "Install Bun first, then `bun install -g`" is a
   friction point that loses adoption.
2. **Claude Desktop integrators.** MCP servers that shell out via
   `command: /usr/local/bin/treenav-mcp` are trivially easier to configure
   than servers that need `command: bun` with arguments. Single-binary
   means fewer wrong-directory bug reports.
3. **The curator write path (ADR 0001, PR #9).** The new write-side toolset
   introduces a filesystem security boundary (path containment) and a
   concurrency requirement (stdio handlers may race with incremental
   `addDocument`). Both are easier to get right in a language with
   first-class data-race tooling and a mature static stdlib.

The engineering question is whether the benefits justify a rewrite of
~5,400 lines of TypeScript and, if so, which target language.

## Decision

**We will port treenav-mcp to Go**, publishing it as `v2.0.0`. The Bun/TS
version will remain on a `legacy` branch for security-only maintenance for
one release cycle after Go reaches parity, then be retired.

The port is governed by [docs/PORT-PLAN.md](../PORT-PLAN.md) — a four-phase,
test-driven, fixture-parity plan.

## Options considered

### Option A: Stay on Bun, ship `bun build --compile` binaries

Bun can produce standalone executables via `bun build --compile
--target=bun-<platform>-<arch>`. Zero rewrite cost; ship tomorrow.

**Pros:**
- No code changes. The existing test suite keeps passing.
- Cross-compile targets cover linux/darwin/windows × amd64/arm64.
- `Bun.markdown`, `Bun.Glob`, `Bun.hash`, `Bun.serve` all keep working.

**Cons:**
- Binaries are ~55–95 MB (the entire Bun runtime is embedded).
- Cold start is ~50–100 ms vs ~5 ms for a Go binary — noticeable in MCP
  `listTools` discovery when a client spawns the server for each request.
- Windows support on Bun has historically been the least mature target;
  Claude Desktop on Windows would be a weak link.
- Does not address the concurrency story introduced by ADR 0001 — Bun's
  stdio transport is effectively single-threaded, so the store has no race
  protection, which is fine *until* the curator write path starts
  interleaving with queries.

**Rejected because** the binary-size and cold-start costs are user-visible,
and the concurrency model is a growing liability as the curator feature
lands.

### Option B: Rewrite in Rust

Rust produces the smallest, fastest binaries. The official `rmcp` crate
(Anthropic-maintained) is a credible MCP SDK. `comrak` or `pulldown-cmark`
handle markdown.

**Pros:**
- Smallest binaries (~5–10 MB with LTO + strip).
- Fastest cold start (~2 ms).
- Best long-term memory safety story.
- `cargo` + `crates.io` ecosystem is strong for CLI tools.

**Cons:**
- `TreeNode` has parent/child back-references — a classic Rust lifetime
  problem, usually solved with arena allocators or ID-based indirection.
  The existing TS code already uses ID-based indirection, so the port is
  feasible, but it adds friction.
- Cross-compiling to five targets requires `cross` or a GitHub Actions
  matrix with cached toolchains — non-trivial compared to Go's trivial
  `GOOS=…`.
- Onboarding new contributors is materially harder. The existing
  contributor base writes TypeScript and Python; Rust's ownership model is
  a steeper learning curve than Go's.
- The performance headroom we're buying is not useful for this workload.
  The tool is dominated by string manipulation, regex, and JSON I/O — not
  hot loops where Rust's advantage over Go would show.

**Rejected because** the cost-to-benefit ratio is wrong for a
string-manipulation CLI. Rust is the right answer for a library being
embedded in latency-sensitive systems. treenav-mcp is a standalone
MCP server that spends most of its time waiting on stdio.

### Option C: Rewrite in Zig

Zig produces excellent binaries and has arguably the best cross-compilation
story of any language (it can compile for any target from any host without
a separate toolchain).

**Pros:**
- Smallest binaries of any option considered.
- Best-in-class cross-compilation.
- Simple, explicit language without hidden control flow.

**Cons:**
- **No MCP SDK.** Implementing JSON-RPC stdio framing, schema validation,
  and the full MCP protocol from scratch is a meaningful chunk of work on
  top of the actual port.
- No mature CommonMark parser (`koino`, a `comrak` port, is not actively
  maintained).
- No YAML library worth using for frontmatter.
- Language is still pre-1.0; API churn is real and would affect the port
  over its useful lifetime.

**Rejected because** the ecosystem gap is too large for a tool that lives
or dies by its MCP compatibility surface.

### Option D: Rewrite in Go

Go produces single static binaries, cross-compiles with one environment
variable, and has mature libraries for every dependency we need:

| Need | Library |
|---|---|
| MCP protocol | `github.com/mark3labs/mcp-go` |
| Markdown (CommonMark) | `github.com/yuin/goldmark` *(optional — regex fallback already exists)* |
| Glob (`**/*.md`) | `github.com/bmatcuk/doublestar/v4` |
| YAML frontmatter | `gopkg.in/yaml.v3` |
| Non-cryptographic hash | `github.com/cespare/xxhash/v2` |
| Release pipeline | `goreleaser` |
| Go AST (for Go code parser) | stdlib `go/parser` + `go/ast` |

**Pros:**
- Single static binary, ~10–15 MB, cross-compiles with `GOOS=darwin
  GOARCH=arm64 go build` — no toolchain setup.
- `mcp-go` is mature and supports both stdio and streaming HTTP transports.
- Stdlib `go/parser` replaces the existing regex-based Go code parser with
  a real AST-based implementation — free accuracy upgrade on one of our
  language targets.
- `sync.RWMutex` + `go test -race` makes the curator concurrency story
  straightforward to get right and verify.
- Boring, stable, easy to onboard contributors who already write Go (a
  sizable overlap with the MCP server author community).
- `goreleaser` reduces the "five platform binaries + Homebrew tap + Docker
  image" release pipeline to one config file and one workflow.

**Cons:**
- ~5,400 lines of TS port to ~6,000–7,000 lines of Go (Go is slightly more
  verbose for data plumbing).
- BM25 numerical parity requires careful porting of the scoring math,
  tokenizer, and stemmer. Mitigated by the fixture-driven parity plan in
  Phase C.
- Go's `encoding/json` serializes `nil` slices as `null` where TS's
  `JSON.stringify` emits `[]`. Must use `make([]T, 0)` for fields that
  should always round-trip as arrays. Known gotcha, tracked in
  `docs/spec/mcp-server.md`.
- Go map iteration is randomized; any code that summed or ranked with
  map-order dependency must be explicitly sorted. Mitigated by
  deterministic tiebreak requirements in every spec.

**Selected.** Go is the smallest-footprint path to the user-visible
outcomes (single binary, fast cold start, native Windows support) without
forcing contributors up a steep learning curve or implementing a protocol
SDK from scratch.

## Consequences

### Positive

- **Distribution becomes a non-event.** `brew install treenav-mcp`,
  single-file downloads from GitHub Releases, and a ~5 MB Docker image on
  `distroless/static`. The non-technical onboarding story is solved.
- **The curator concurrency story gets principled handling.** The store
  is guarded by `sync.RWMutex` and verified by `go test -race` on every
  CI run, not by hoping Bun's single-threaded transport hides the bug.
- **The Go code parser becomes AST-based** via stdlib `go/parser`,
  improving symbol extraction accuracy on Go source without extra
  dependencies.
- **Binary size drops ~90%**. Container image drops from ~200 MB (Bun
  base) to ~15 MB (distroless + Go binary).
- **Cold start drops ~15×**, making MCP clients that spawn the server
  per-request feel instant.

### Negative

- **Duplicate maintenance during the port.** Both codebases must stay
  green until Phase D cutover. Mitigated by the fixture oracle: the TS
  version *is* the spec, so keeping it working is the same thing as
  keeping the spec honest.
- **Contributors must know Go.** The current contributor base is primarily
  TypeScript. Mitigated by Go's low learning curve relative to Rust/Zig
  and by the phase-C ordering (each PR is one small module, easy to
  review).
- **BM25 parity is a real risk.** Tokenization, stemming, and
  floating-point summation order must match exactly or search results
  drift in subtle ways users will notice. Mitigated by fixture-driven
  tests at every sub-phase of the store port and by explicit
  deterministic-tiebreak requirements in the spec.
- **YAML round-trip is a new parity requirement.** The curator serializes
  frontmatter that the indexer must parse back losslessly. Mitigated by
  a dedicated property test run in both TS and Go:
  `parseFrontmatter(serializeMarkdown(fm)) == fm`.

### Neutral

- **Protocol version pinning.** `mcp-go` must track the same MCP protocol
  version as the `@modelcontextprotocol/sdk` TS package we're replacing.
  Add a CI check that diffs the reported server capabilities.
- **Release versioning.** The Go rewrite ships as `v2.0.0`. Commit messages
  on the port branch use `feat!:` to signal the major bump via
  semantic-release.

## Non-goals

This ADR does **not** commit to:

- Changing the public MCP tool surface. The 6 read tools and 3 curation
  tools remain identical in name, argument schema, and return shape.
- Changing the data model. `TreeNode`, `IndexedDoc`, facet keys, and
  frontmatter semantics are stable across the port.
- Replacing BM25 with a different ranking algorithm.
- Introducing embeddings or a vector index.
- Changing the "zero LLM calls at index or retrieval time" invariant.

The port is a language migration, not a redesign. Any behavior change must
be a separate PR with its own ADR.

## Rollout

1. **Phase A (docs):** write `docs/features/*.md` and `docs/spec/*.md` for
   every module listed in `docs/PORT-PLAN.md`.
2. **Phase B (red tests):** Go test files compile and run; every
   assertion fails because no implementation exists.
3. **Phase C (implementation):** one module per PR, in dependency order,
   each turning its red tests green and adding a fixture-parity check
   against the TS oracle.
4. **Phase D (cutover):** `v2.0.0-rc.1` on both tracks; one cycle of
   feedback; `v2.0.0` default release; TS moved to `legacy` branch.

No user-visible breakage is expected at any phase. The TS version remains
fully functional on `main` until Phase D completes.

## References

- [docs/PORT-PLAN.md](../PORT-PLAN.md) — the concrete phase-by-phase roadmap
- [docs/adr/0001-llm-curated-wiki.md](./0001-llm-curated-wiki.md) — the
  curator feature whose concurrency and security requirements motivate
  several decisions above
- `src/store.ts` — current BM25 engine, the module whose parity is
  hardest to preserve
- `src/curator.ts` — current write path, whose security boundary gets
  extracted into `internal/safepath` during the port
