# doctree-mcp HANDOFF

**Purpose:** pick up the Go port of treenav-mcp's doc-tree subset, continuing
from work originally staged on branch `claude/rewrite-go-migration-LK31U` in
`github.com/joesaby/treenav-mcp`.

This document is the single source of truth for where the port stands. **Read
it first** before doing any work in `github.com/joesaby/doctree-mcp`. It
captures every non-obvious decision from the originating conversation so a
new Claude Code session can continue without re-litigating choices.

## Why this doc exists in treenav-mcp

The prior session that set up this port ran inside a sandbox with GitHub
access scoped to `joesaby/treenav-mcp` only — ssh was unavailable and the
local git proxy rejected any other repository. So the port work, including
this handoff, was committed to branch `claude/rewrite-go-migration-LK31U` in
`treenav-mcp` as the staging area, with the expectation that it gets
transplanted into a fresh `joesaby/doctree-mcp` repo by a user running git
locally.

**The extraction recipe is in the README-style section "Moving this branch
into doctree-mcp" below. Run it from a local clone once you've created the
`joesaby/doctree-mcp` repository on GitHub.**

## What doctree-mcp is

doctree-mcp is the **Go port of the doc-tree subset of treenav-mcp**. It
provides BM25 search, hierarchical tree navigation, and LLM-curated wiki
writes over a markdown repository via MCP — matching the TS implementation
at `github.com/joesaby/treenav-mcp` on the read + curation side, but
delivered as a single static Go binary for native distribution.

### Relationship to treenav-mcp

- **treenav-mcp is the authoritative oracle** during the port. It stays live
  until doctree-mcp reaches parity and cuts over. Bug fixes still land in
  treenav-mcp first.
- doctree-mcp is a **fresh repo (not a fork)** — clean history, clean release
  cadence, clean identity as the canonical home for the Go/native product.
- Code indexing (source code via language parsers, the `find_symbol` tool,
  `CODE_*` env vars) is **not in scope**. See ADR 0003. Users who need code
  indexing stay on treenav-mcp v1.

## Phase status

**Phase A (Docs & Specs):** *in progress, consolidation pending.* 17 feature
docs and 12 specs exist under `docs/features/` and `docs/spec/` — these are
**intermediate scratch output** from a parallel agent sprint. They need to
be consolidated into the 8 target documents listed in PORT-PLAN.md, and the
scratch directories deleted. This consolidation is your first task in the
new repo.

**Phase B (red tests):** not started.
**Phase C (implementation):** not started.
**Phase D (parity + cutover):** not started.

## Decisions made — don't re-litigate

| Decision | Rationale | Where recorded |
|---|---|---|
| Port to Go (not Rust/Zig/Bun-compile) | Single static binary, mcp-go SDK maturity, `sync.RWMutex` + race detector for curator concurrency, goreleaser pipeline | `adr/0002` |
| Fresh repo `joesaby/doctree-mcp`, not a fork | Clean history, independent release cadence, clean identity | this file, ADR 0003 |
| Single repo, single `go.mod` | YAGNI on library split until external consumer exists; `pkg/internal/cmd` layout is split-ready | PORT-PLAN |
| `pkg/treenav` + `internal/*` + `cmd/treenav-mcp` | Engine exportable, wrapper private, binary wires both. Binary name stays `treenav-mcp` for MCP client compatibility. | PORT-PLAN |
| Drop code tree entirely | Regex approach deprecated; AST replacement planned as a separate project | `adr/0003` |
| `internal/safepath` is its own package | Security boundary reviewable + fuzzable in isolation | `spec/safepath` |
| `sync.RWMutex` on the store | Go stdio handlers may race with curator `AddDocument`; verified by `go test -race` | `spec/concurrency-model` |
| Tokenizer + stemmer numerical parity required | BM25 drift is silent and user-visible | `spec/bm25-engine` (TODO — write inline during consolidation) |
| YAML round-trip contract curator↔indexer | `curator.SerializeMarkdown` must parse back losslessly | `spec/curator` (TODO) |
| Fixture-driven parity against TS oracle | TS is the spec until cutover | PORT-PLAN principle 2 |
| Three test tiers: library, wrapper, e2e | Layered boundaries, each independently meaningful | PORT-PLAN Phase B |
| goreleaser + distroless Docker image | Five-platform matrix, Homebrew tap, ~12 MB image | `spec/distribution` |
| xxhash replaces Bun wyhash | Stable Go choice; breaks on-disk index compat but treenav re-indexes on startup so no migration needed | `spec/fsutil` |
| `make([]T, 0)` for always-array fields | Go's `encoding/json` emits `null` for nil slices; TS clients expect `[]` | `spec/core-data-model` |

## Target consolidated doc set

After consolidation, `docs/` contains exactly these files:

```
docs/
├── HANDOFF.md                     # this file
├── PORT-PLAN.md                   # four-phase roadmap
├── architecture.md                # layering, concurrency, errors, distribution, env
├── core-data-model.md             # pkg/treenav/types.go reference
├── bm25-engine.md                 # pkg/treenav/store.go (shared with curator)
├── doc-indexing.md                # pkg/treenav/indexer.go + frontmatter + fsutil
├── curator.md                     # pkg/treenav/curator.go
├── safepath.md                    # internal/safepath + adversarial table
├── mcp-wrapper.md                 # internal/mcp + cmd/treenav-mcp
└── adr/
    ├── 0001-llm-curated-wiki.md   # carried from treenav-mcp verbatim
    ├── 0002-typescript-to-go-migration.md
    └── 0003-drop-code-tree-from-go-port.md
```

**The `docs/features/` and `docs/spec/` scratch directories get deleted
during consolidation.** They are not part of the doctree-mcp repo's
long-term shape.

### Consolidation mapping

| Target doc | Sources from scratch | Must be written inline |
|---|---|---|
| `architecture.md` | `features/concurrency-model.md` + `spec/concurrency-model.md` + `features/error-taxonomy.md` + `spec/error-taxonomy.md` + `features/distribution.md` + `spec/distribution.md` + `features/environment.md` + `spec/environment.md` | Strip `CODE_*` env vars and parser error codes. |
| `core-data-model.md` | `features/core-data-model.md` + `spec/core-data-model.md` | — |
| `bm25-engine.md` | `features/bm25-engine.md` + `features/glossary-expansion.md` + `features/incremental-index.md` | **Specs were not written** — synthesize from `treenav-mcp/src/store.ts`. This is the riskiest doc; be precise about the BM25 formula, tokenizer, stemmer, `avgdl` handling. |
| `doc-indexing.md` | `features/markdown-indexer.md` + `features/frontmatter.md` + `spec/frontmatter.md` + `features/fsutil.md` + `spec/fsutil.md` | **markdown-indexer spec was not written** — synthesize from `treenav-mcp/src/indexer.ts`. Document both the regex parser as the primary and the frontmatter extraction. |
| `curator.md` | `features/curator.md` | **Curator spec was not written** — synthesize from `treenav-mcp/src/curator.ts` and `treenav-mcp/docs/wiki-curation-spec.md`. Cover FindSimilar/Draft/Write, YAML round-trip contract, all 6 error codes, concurrency with store. |
| `safepath.md` | `features/safepath.md` + `spec/safepath.md` (already has the 30-row adversarial table) | — |
| `mcp-wrapper.md` | `features/mcp-tools.md` + `spec/mcp-tools.md` + `features/mcp-server.md` + `spec/mcp-server.md` + `features/search-formatter.md` + `spec/search-formatter.md` + `features/cli-debug.md` + `spec/cli-debug.md` | **Strip the `find_symbol` tool entry** — 9 tools → 8 (5 read + 3 curation gated on `WIKI_WRITE`). |

## Cleanup debts from the treenav-mcp staging branch

These are incomplete cleanups that the move brings along. Address them
during consolidation — they fold in naturally, don't do them as standalone
commits:

1. **`find_symbol` references** still appear in `features/mcp-tools.md`,
   `spec/mcp-tools.md`. Drop the tool entry. Final tool count is **8**
   (5 read: `list_documents`, `search_documents`, `get_tree`,
   `get_node_content`, `navigate_tree`; 3 curation gated on `WIKI_WRITE=1`:
   `find_similar`, `draft_wiki_entry`, `write_wiki_entry`).
2. **`CODE_ROOT`, `CODE_COLLECTION`, `CODE_WEIGHT`, `CODE_GLOB` env var rows**
   still in `features/environment.md` and `spec/environment.md`. Drop them.
3. **Language-parser error codes** may still be in
   `features/error-taxonomy.md` and `spec/error-taxonomy.md`. Drop any
   entries scoped to `internal/parsers/*`.
4. **`docs/wiki-curation-spec.md`** (the TS-era spec for the curator feature)
   is copied in verbatim from treenav-mcp. Fold the still-relevant parts into
   `docs/curator.md` during consolidation, then delete the original file.
5. **README.md** — none exists yet for doctree-mcp. Write one during
   consolidation that:
   - Describes doctree-mcp as "the Go port of treenav-mcp's doc tree +
     curator"
   - Cross-links treenav-mcp as the TS original
   - States the code-tree scope exclusion prominently
   - Lists the MCP tool surface (8 tools)
   - Points new contributors at HANDOFF.md + PORT-PLAN.md

## What to do first (when you start a new session at doctree-mcp)

1. **Read this file, PORT-PLAN.md, adr/0002, adr/0003.** ~30 min read.
2. **Execute the consolidation pass.** Follow the mapping table above.
   Delete `docs/features/` and `docs/spec/` when done. Single clean commit.
3. **Write README.md** per the cleanup debt section.
4. **Start Phase B:** initialize `go.mod`, set up `testdata/corpus/`,
   write `scripts/dump-fixtures.ts` to generate JSON fixtures from
   treenav-mcp TS source (via git submodule — see below), write the red
   unit tests in parallel by feature group.
5. **Phase C:** implement in dependency order per `PORT-PLAN.md`.

## The oracle: how to reference treenav-mcp during the port

treenav-mcp's TS source is the parity oracle. You'll cite it often.
Recommended pattern:

- **Vendor it as a git submodule** at `scripts/oracle/treenav-mcp/`, pinned
  to a specific commit. This makes fixture generation reproducible:
  ```bash
  git submodule add https://github.com/joesaby/treenav-mcp.git scripts/oracle/treenav-mcp
  cd scripts/oracle/treenav-mcp && git checkout <known-good-sha> && cd -
  git add .gitmodules scripts/oracle/treenav-mcp
  ```
- When porting a function, cite `scripts/oracle/treenav-mcp/src/<file>.ts:<line>`
  in Go doc comments.
- When a bug is found in the oracle, fix it in treenav-mcp first, bump the
  submodule pin, regenerate fixtures, then port the fix.
- **Do not copy treenav-mcp's TS source into the doctree-mcp repo tree.**
  It stays as a submodule reference only.

## Working discipline — the non-negotiables

1. **No implementation before spec.** Every Go package gets a spec before
   any code lands. Tests are red first.
2. **Fixture-driven parity.** BM25 ranking, tokenization, snippet generation,
   and YAML round-trip must all match the TS oracle within a pinned
   tolerance (`1e-9` for scores, byte-exact for serialization).
3. **Security-critical modules get adversarial tests first.** `safepath`'s
   30-row adversarial input table ships with the package, fuzz tested
   (`go test -fuzz`), before anything else calls it.
4. **`go test -race` is a CI requirement.** Every PR runs with the race
   detector. A race in the store is a release blocker.
5. **Don't port bugs.** Found bugs go back to the treenav-mcp oracle first.
6. **Every PR leaves main shippable.** Previously-green tests stay green,
   new tests flip red → green, unrelated tests remain red.

## Moving this branch into doctree-mcp

The port work lives on branch `claude/rewrite-go-migration-LK31U` in
`github.com/joesaby/treenav-mcp`. To transplant it into a fresh
`github.com/joesaby/doctree-mcp` repo, run the following from a local
machine with git + ssh set up:

```bash
# 1. Create joesaby/doctree-mcp on GitHub via the web UI.
#    Empty repo. No README, no license, no .gitignore — we'll seed it.

# 2. Clone treenav-mcp and check out the staging branch.
git clone git@github.com:joesaby/treenav-mcp.git
cd treenav-mcp
git checkout claude/rewrite-go-migration-LK31U

# 3. Stage a clean doctree-mcp tree beside it.
mkdir -p ../doctree-mcp/docs/adr
cp docs/PORT-PLAN.md                          ../doctree-mcp/docs/
cp docs/HANDOFF.md                            ../doctree-mcp/docs/
cp docs/adr/0001-llm-curated-wiki.md          ../doctree-mcp/docs/adr/
cp docs/adr/0002-typescript-to-go-migration.md  ../doctree-mcp/docs/adr/
cp docs/adr/0003-drop-code-tree-from-go-port.md ../doctree-mcp/docs/adr/
cp docs/wiki-curation-spec.md                 ../doctree-mcp/docs/
cp -r docs/features                           ../doctree-mcp/docs/
cp -r docs/spec                               ../doctree-mcp/docs/

# 4. Init and push.
cd ../doctree-mcp
git init -b main
git add .
git commit -m "chore: scaffold doctree-mcp from treenav-mcp port staging

Seeded from treenav-mcp branch claude/rewrite-go-migration-LK31U.
Code tree (regex-based parsers, find_symbol tool, CODE_* env vars) is
intentionally omitted — see docs/adr/0003-drop-code-tree-from-go-port.md.

The initial commit includes scratch docs under docs/features/ and
docs/spec/ that the first follow-up commit will consolidate per
docs/HANDOFF.md."
git remote add origin git@github.com:joesaby/doctree-mcp.git
git push -u origin main

# 5. Start a new Claude Code session at the doctree-mcp checkout.
#    That session has its own sandbox permissions and can work with
#    the new repo. Brief it with: "Read docs/HANDOFF.md first."
```

## If you get stuck

- Read the treenav-mcp TS source. It's the oracle.
- Search this HANDOFF for the topic you're stuck on.
- Check the ADR dir for decision context.
- Don't re-litigate decisions captured above without a clear new reason.
- The original port conversation lived inside a session at treenav-mcp;
  the key artifacts from that session are all committed to the branch
  and are reachable from this file.

---

**Last updated:** Phase A consolidation pending. No Go code exists yet.
**Originating branch:** `claude/rewrite-go-migration-LK31U` in `joesaby/treenav-mcp`.
**Target repo:** `joesaby/doctree-mcp` (to be created).
