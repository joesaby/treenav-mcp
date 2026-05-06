# Remove Wiki Curation Toolset — Design

**Status:** Approved (brainstorming)
**Date:** 2026-05-06
**Type:** Breaking removal
**Release:** Single PR with one `feat!:` commit on the branch (with `BREAKING CHANGE:` trailer); merge to `main` lands one commit. semantic-release cuts a major version automatically.

---

## 1. Goal

Remove the entire wiki curation / management surface from treenav. After this change, treenav is purely a read-side search and navigation MCP server: 8 read tools, 1 prompt family (`doc-read`), no writes, no wiki-specific linter, no `WIKI_*` env vars.

The decision is "not relevant to this project" — wiki curation was an opt-in write-side companion (per ADR 0001) that we no longer want to maintain. The repo is pre-release with no external users, so no migration path is needed.

## 2. Non-Goals

- No replacement feature. We are not building a generic frontmatter linter or any other write tool.
- No deprecation period. The code, tests, env vars, and docs go in a single commit.
- No changes to indexing, search, BM25 scoring, code parsing, or the existing read tools. Their behavior must be byte-identical after this change.
- No changes to active plans (`docs/plans/2026-05-04-rename-and-retrofit.md`, `docs/plans/2026-05-06-tier4-decision-review.md`) or archived plans. They remain as historical record.

## 3. Scope

### 3.1 Removed surface

| Surface | What goes |
|---|---|
| MCP tools | `find_similar`, `draft_wiki_entry`, `write_wiki_entry` |
| MCP prompts | `doc-write`; any wiki branches in other prompts (verify `doc-lint` during implementation — remove unless a non-wiki use case is clear) |
| Source files (deleted whole) | `src/curator.ts`, `src/cli-lint.ts` |
| `treenav` CLI | `lint` subcommand and its dispatcher entry |
| Source code (edits) | `WikiOptions` import + `WIKI_WRITE` config block in `src/server.ts` and `src/server-http.ts`; `registerCurationTools` and `options.wiki` plumbing in `src/tools.ts`; `wikiEnabled` option and `doc-write` in `src/prompts.ts` |
| `treenav init` | `WIKI_CONVENTIONS` constant, `docs/wiki/` directory scaffolding, `getting-started.md` template, `WIKI_WRITE: "1"` in `MCP_ENV`, and every `write_wiki_entry` / `bunx treenav lint` hook entry across hosts (Claude Code, Cursor, Windsurf, OpenCode, Codex). All host-MCP-config wiring stays. |
| Env vars | `WIKI_WRITE`, `WIKI_ROOT`, `WIKI_DUPLICATE_THRESHOLD`, `LINT_MIN_WORDS` |
| Tests | `tests/curator.test.ts`, `tests/cli-lint.test.ts`; pruned wiki cases in `tests/cli-init.test.ts`, `tests/e2e.test.ts`, `tests/bin-dispatch.test.ts` |
| Docs | `docs/wiki-curation-spec.md`, `docs/adr/0001-llm-curated-wiki.md` (and `docs/adr/` itself if empty after deletion). Wiki references stripped from `README.md`, `CLAUDE.md`, `docs/CONFIGURATION.md`, `docs/DESIGN.md`, `docs/COMPETITIVE-ANALYSIS.md`. |

### 3.2 Preserved surface

- 8 read tools: `list_documents`, `search_documents`, `grep_documents`, `get_tree`, `get_node_content`, `navigate_tree`, `lookup_row`, `find_symbol`.
- The `doc-read` prompt and any prompts that have no wiki coupling.
- `treenav init` for host MCP config wiring (Claude Code, Claude Desktop, Cursor, OpenCode, Codex), with all wiki-specific work removed.
- All indexing (`indexer.ts`, `code-indexer.ts`, `parsers/*`), search and BM25 (`store.ts`), formatting (`search-formatter.ts`), and types (`types.ts`) — **untouched**.

## 4. Implementation Order

Each step leaves the tree compiling and the read-tool tests green.

1. **Pre-flight.** `git log --all --oneline | head -40` and `gh pr list` to confirm no in-flight wiki work. Branch off a clean `main`.
2. **Branch.** `git checkout -b chore/remove-wiki-curation`.
3. **Strip MCP wiring** in `src/server.ts`, `src/server-http.ts`, `src/tools.ts`, `src/prompts.ts`. Remove `WikiOptions` imports, `WIKI_WRITE` blocks, the `wiki` arg from `registerTools`/`registerPrompts`, the entire `registerCurationTools` function, the `doc-write` prompt, and the `wikiEnabled` plumbing. (Type-check will still fail until step 4 — expected.)
4. **Delete** `src/curator.ts` and `tests/curator.test.ts`. Run `bunx tsc --noEmit` — expect clean. Run `bun test` — expect green minus the deleted file.
5. **Strip wiki bits from `src/cli-init.ts`.** Remove `WIKI_CONVENTIONS`, `docs/wiki/` scaffolding, `getting-started.md` template, `WIKI_WRITE: "1"`, and `write_wiki_entry` / `bunx treenav lint` hook entries for every host. Update `tests/cli-init.test.ts` to drop wiki assertions.
6. **Delete** `src/cli-lint.ts` and `tests/cli-lint.test.ts`. Drop the `lint` subcommand from the bin dispatcher. Update `tests/bin-dispatch.test.ts`.
7. **Prune `tests/e2e.test.ts`** of wiki tool/prompt cases.
8. **Grep guard (interim).** `grep -rn -E 'WIKI_WRITE|WIKI_ROOT|WIKI_DUPLICATE|LINT_MIN_WORDS|find_similar|draft_wiki_entry|write_wiki_entry|WikiOptions|registerCurationTools|WIKI_CONVENTIONS|wikiEnabled' src/ tests/` — expect zero hits.
9. **Delete docs.** `docs/wiki-curation-spec.md`, `docs/adr/0001-llm-curated-wiki.md`. Remove `docs/adr/` if empty.
10. **Strip remaining doc references.** `README.md`, `CLAUDE.md`, `docs/CONFIGURATION.md`, `docs/DESIGN.md`, `docs/COMPETITIVE-ANALYSIS.md` — drop wiki sections, env-var rows, and tool references.
11. **Final grep guard** across `src/`, `tests/`, and all `*.md` (excluding `docs/plans/` which is historical record). Expect zero hits.
12. **Full verification.** `bunx tsc --noEmit`, `bun test`, manual smoke tests (see §5).
13. **Commit.** Single commit titled `feat!: remove wiki curation toolset` with a `BREAKING CHANGE:` trailer naming the removed tools and env vars.
14. **PR + merge.** Open PR, confirm CI green, merge to `main`. semantic-release cuts the major version automatically.

## 5. Verification

### 5.1 Static & test

- `bunx tsc --noEmit` — clean.
- `bun test` — full suite green. The 109-test search-quality suite (NDCG@10 ≥ 0.65 overall, ≥ 0.83 exact-match, MRR ≥ 0.70) is the load-bearing regression check; it has no wiki coupling and must pass unchanged.
- Record before/after test count in PR description.

### 5.2 Manual smoke tests (before commit)

- `bun run serve` — stdio MCP starts; client `tools/list` returns exactly 8 tools, none of `find_similar` / `draft_wiki_entry` / `write_wiki_entry`.
- `bun run serve:http` — same on HTTP variant.
- `bun run serve` with `WIKI_WRITE=1` set — confirms env var is unread (not "supported with warning"; just ignored).
- `bunx treenav init --dry-run` against a scratch dir — output mentions only host MCP config, no `docs/wiki/`, no `WIKI_WRITE`, no `write_wiki_entry` hook.
- `bunx treenav lint` — subcommand is gone (dispatcher exits with unknown-command behavior).

### 5.3 Final grep guard

```
grep -rn -E 'WIKI_WRITE|WIKI_ROOT|WIKI_DUPLICATE|LINT_MIN_WORDS|find_similar|draft_wiki_entry|write_wiki_entry|WikiOptions|registerCurationTools|WIKI_CONVENTIONS|wikiEnabled' src/ tests/ README.md CLAUDE.md docs/
```

Expected: zero hits. Any hit is a missed cleanup site. (Historical plans in `docs/plans/` are excluded by scope — they are read-only history.)

### 5.4 No new tests

This is pure removal. Adding tests for "thing no longer exists" is dead weight. Coverage of the regression surface is the existing read-tool tests plus the grep guard.

## 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| In-flight branch / external work touching `curator.ts` | Low — solo project, no external users | Pre-flight `git log --all` + `gh pr list` check at step 1. |
| `doc-lint` prompt has a non-wiki use case we miss | Low | Open the file in step 3 and decide explicitly: remove if wiki-only, keep with wiki language stripped if generic. Default is remove. |
| `treenav init`-generated host configs in the wild reference removed env vars / hooks | Not applicable per user — pre-release, no external deployments | None needed. |
| Recovering the code later | Trivial — git history at `c3c3eca` and earlier | The deletion commit becomes the landmark. |

## 7. Out of Scope

- Rebuilding `treenav lint` as a generic frontmatter linter. The codebase has no read-only equivalent, and there's no immediate need.
- Adding an MCP "writer" tool of a different shape. If we ever want write capability back, design it from scratch — don't resurrect the curator.
- Refactoring `cli-init.ts` beyond removing wiki bits. The host-config wiring is left as-is even if it could be tidier.

## 8. Acceptance Criteria

- All items in §3.1 are removed; all items in §3.2 are present and unchanged in behavior.
- §5.1, §5.2, §5.3 all pass.
- A single commit lands on `main` with subject `feat!: remove wiki curation toolset` and a `BREAKING CHANGE:` trailer.
- semantic-release publishes a major version bump on merge.
- Docker Hub `:latest` and `:<version>` tags update automatically per the existing release pipeline.
