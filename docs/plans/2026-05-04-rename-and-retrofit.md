# Rename to `treenav` and Deep Docs Retrofit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project from `treenav-mcp` to `treenav` and retrofit every README, doc, spec, and config artifact to (a) be precise and findable for code/docs search use cases, (b) reflect that treenav is now both an MCP server *and* an embeddable library, (c) clearly acknowledge upstream projects we built on, and (d) extend competitive analysis with current comparisons.

**Architecture:** A rename + docs sweep, executed in five phases that each ship as a separate PR for clean review. Phase 1 is atomic across all rename surfaces so the repo never sits in a half-renamed state. Phases 2–5 build on that foundation.

**Tech Stack:** Bun, TypeScript, npm, Docker Hub, Fly.io, GitHub. No code-behavior changes — this is identity, configuration, and documentation work.

---

## Decisions locked

These came up during planning; record them here so the implementer doesn't re-litigate.

1. **New name:** `treenav` (verified available on npm via `npm view treenav` → 404). GitHub repo and Docker Hub tag follow.
2. **No deprecation shim for `treenav-mcp`:** the user has confirmed there are no existing consumers, so we skip the npm deprecation message + redirect package. If we discover consumers later, we can publish a one-line `treenav-mcp` package that re-exports `treenav` and prints a deprecation warning. Out of scope for this plan.
3. **GitHub repo rename:** rename `joesaby/treenav-mcp` → `joesaby/treenav` via the GitHub UI. GitHub keeps the old URL as a redirect, which protects historical backlinks (semantic-release tags, prior PRs).
4. **Fly.io app:** rename `treenav-mcp` → `treenav` via `fly apps rename`. Updates the `*.fly.dev` URL.
5. **Docker Hub:** create `joesaby/treenav` and update the release workflow to publish there. Leave `joesaby/treenav-mcp` as-is (no users; not worth deleting).
6. **Docs to leave as historical:** `docs/plans/2026-02-28-*.md`, `docs/plans/2026-03-08-*.md`, `docs/plans/2026-05-03-*.md`, and `docs/benchmark-*.md`. Those are dated artifacts. The retrofit only touches *active* docs (README, CLAUDE.md, DESIGN.md, CONFIGURATION.md, COMPETITIVE-ANALYSIS.md, ADR-0001, wiki-curation-spec, search-quality-spec). Plan files keep their original `treenav-mcp` references intact as a record.
7. **Terminology in prose:** "AI agents" in headers and structural sentences; name specific tools (Claude Code, Cursor, Cline, Continue, Goose) in a "Works with" section to capture long-tail searches.

---

## File inventory (locked)

Captured up-front so each task can reference exact paths without re-discovery.

### Identity files (Phase 1)

| Path | Has `treenav-mcp` | Notes |
|------|-------------------|-------|
| `package.json` | `name`, `mcpName`, `bin`, `homepage`, `repository.url`, `bugs.url` | Highest-impact rename target |
| `README.md` | title, install commands, repo links, "Run from source" block | |
| `server.json` | `name`, `repository.url`, `packages[].identifier` | MCP registry metadata |
| `smithery.yaml` | `name`, `description`, `homepage` | Smithery registry metadata |
| `claude_desktop_config.json` | example `bunx treenav-mcp` command | Example only |
| `CLAUDE.md` | header line | |
| `Dockerfile` | none directly (no NAME strings) | Verified — no edits needed |
| `.devcontainer/devcontainer.json` | `name: "treenav-mcp"` | |
| `fly.toml` | `app = "treenav-mcp"` | Coupled with `fly apps rename` external action |
| `.github/workflows/release.yml` | Docker Hub repo, possibly other refs | |

### Code/test files (Phase 1, mechanical)

| Path | Refs |
|------|------|
| `src/server.ts` | server-name string |
| `src/server-http.ts` | server-name string |
| `src/tools.ts` | possibly in tool descriptions |
| `src/types.ts` | possibly in comments |
| `src/indexer.ts` | possibly in comments (now also handles CSV/JSONL) |
| `src/code-indexer.ts` | possibly in comments |
| `src/curator.ts` | possibly in comments |
| `src/prompts.ts` | possibly in MCP prompt descriptions |
| `src/cli-init.ts` | `bunx treenav-mcp init` self-ref strings |
| `src/cli-lint.ts` | `bunx treenav-mcp lint` self-ref strings |
| `src/cli-index.ts` | possibly in help text |
| `src/parsers/typescript.ts` | possibly in comments |
| `src/parsers/python.ts` | possibly in comments |
| `src/parsers/go.ts` | possibly in comments |
| `src/parsers/rust.ts` | possibly in comments |
| `src/parsers/generic.ts` | possibly in comments |
| `tests/search-quality.test.ts` | fixture refs |
| `tests/fixtures/helpers.ts` | fixture refs |
| `tests/fixtures/sample-docs.ts` | fixture refs |
| `scripts/benchmark.ts` | run-command refs |

Note: any new `src/cli-*.ts` or `src/parsers/*.ts` file added between plan-write time and execution time should also be included. The implementer should run a final repo-wide grep (Task 1.5 step 1) as the source of truth, not this list.

### Active docs (Phases 2–5)

| Path | Phase | Notes |
|------|-------|-------|
| `README.md` | Phase 2 | Header + tagline + structure rewrite for findability |
| `CLAUDE.md` | Phase 2 | Update tagline + reflect code-search scope |
| `docs/DESIGN.md` | Phase 3 | Audit for accuracy after Tier 1–4 work in flight |
| `docs/CONFIGURATION.md` | Phase 3 | Already exists; audit and update env var list |
| `docs/wiki-curation-spec.md` | Phase 3 | Audit name refs |
| `docs/search-quality-spec.md` | Phase 3 | Audit name refs |
| `docs/adr/0001-llm-curated-wiki.md` | Phase 3 | Audit name refs |
| `docs/COMPETITIVE-ANALYSIS.md` | Phase 5 | Extend with new comparisons |
| `docs/ACKNOWLEDGEMENTS.md` | Phase 4 | New file — consolidate "Standing on Shoulders" content |

### Historical artifacts (LEAVE UNCHANGED)

- `docs/plans/2026-02-28-search-quality-expansion.md`
- `docs/plans/2026-03-08-*.md` (4 files)
- `docs/plans/2026-05-03-semble-feature-port.md`
- `docs/plans/2026-05-04-rename-and-retrofit.md` (this plan)
- `docs/benchmark-envoy-cpp.md`
- `docs/benchmark-prometheus-go.md`
- `docs/benchmark-wildfly-java.md`

These are dated records. Renaming inside them rewrites history.

---

## PR sequencing

Each phase ships as one PR so each piece is reviewable in isolation.

| PR | Phase | Scope | Risk |
|----|-------|-------|------|
| RA | 1 | Atomic rename across code, identity files, infra | medium — touches many files but no logic changes; smoke test gates merge |
| RB | 2 | Findability rewrite (README, package.json description + keywords, server.json, smithery.yaml, CLAUDE.md) | low — copy edits |
| RC | 3 | Active doc retrofit (DESIGN, CONFIGURATION, ADR-0001, specs) | low — copy edits |
| RD | 4 | New `docs/ACKNOWLEDGEMENTS.md` + README link | low |
| RE | 5 | Extend `docs/COMPETITIVE-ANALYSIS.md` with new comparisons | low |
| RF | 6 | Audit + delete or archive obsolete content (review-and-confirm task list inside the PR) | low — every deletion gated on user OK |

PR RA blocks all subsequent phases. PRs RB–RF are independent and can ship in parallel.

---

## Phase 1 — Atomic rename (PR RA)

### Task 1.1: Pre-flight verification

**Files:** none (inspection only)

- [ ] **Step 1: Re-confirm `treenav` is still unregistered on npm**

Run:
```bash
npm view treenav 2>&1 | head -3
```
Expected: `npm error 404 Not Found - GET https://registry.npmjs.org/treenav - Not found`

If anything other than 404, **stop**. The implementer must surface this to the maintainer and revisit the name choice (fallback options: `treenav-search`, `treenav-engine`, or a fresh name from the prior brainstorm — see notes in PR #11 history).

- [ ] **Step 2: Confirm no in-flight PRs would conflict with a sweep of `src/`**

Run:
```bash
gh pr list --state open --json number,title,headRefName
```

Any open PR that touches files in the Phase 1 inventory (especially `src/`, `tests/`, `package.json`, `README.md`) will get conflicts from the rename sweep. Cross-check each open PR's diff:

```bash
gh pr view <PR#> --json files | head -40
```

If conflicts are unavoidable: **stop and coordinate with the maintainer**. Either merge the open PRs first, or rebase them after Phase 1 lands. Do not attempt the rename in parallel — the Phase 1 sed sweep over `src/` will hit every file and force-rebase pain on every open PR's diff.

The Semble-port chain (PRs #14 onward at plan-write time) was the largest known concurrent work; check `git log origin/main` to see how much has merged since.

- [ ] **Step 3: Reserve the npm name**

Reserving requires a publish. We do this *after* Phase 1 lands, not before — publishing an empty placeholder that doesn't match the actual code creates registry confusion. Just verify the name is still free at the moment of merge, and have the maintainer publish v2.0.0 from `main` immediately post-merge.

### Task 1.2: Update `package.json` core identity

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update name and metadata fields**

Apply these exact changes to `package.json`:

```diff
-  "name": "treenav-mcp",
-  "version": "1.0.2",
-  "mcpName": "io.github.joesaby/treenav-mcp",
+  "name": "treenav",
+  "version": "2.0.0",
+  "mcpName": "io.github.joesaby/treenav",
```

```diff
-  "repository": {
-    "type": "git",
-    "url": "https://github.com/joesaby/treenav-mcp.git"
-  },
-  "homepage": "https://github.com/joesaby/treenav-mcp#readme",
-  "bugs": {
-    "url": "https://github.com/joesaby/treenav-mcp/issues"
-  },
+  "repository": {
+    "type": "git",
+    "url": "https://github.com/joesaby/treenav.git"
+  },
+  "homepage": "https://github.com/joesaby/treenav#readme",
+  "bugs": {
+    "url": "https://github.com/joesaby/treenav/issues"
+  },
```

```diff
-  "bin": {
-    "treenav-mcp": "bin.ts"
-  },
+  "bin": {
+    "treenav": "bin.ts"
+  },
```

The version bump to `2.0.0` signals the rename as a breaking change to anyone polling the registry, even though we have no consumers. semantic-release will pick this up via `BREAKING CHANGE:` footer in the commit message (Step 5 below).

- [ ] **Step 2: Verify package.json parses and `npm pack --dry-run` shows new name**

Run:
```bash
bun -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))"
npm pack --dry-run 2>&1 | grep -E "name:|filename:" | head -5
```
Expected:
- First command: silent (parse OK)
- Second command: shows `filename: treenav-2.0.0.tgz` and `name: treenav`

If either fails, fix the JSON before continuing.

### Task 1.3: Replace `treenav-mcp` across remaining identity files

**Files:**
- Modify: `server.json`
- Modify: `smithery.yaml`
- Modify: `claude_desktop_config.json`
- Modify: `CLAUDE.md`
- Modify: `.devcontainer/devcontainer.json`
- Modify: `fly.toml`
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`

- [ ] **Step 1: Mechanical replace `treenav-mcp` → `treenav` in identity files only**

Run from repo root:
```bash
for f in server.json smithery.yaml claude_desktop_config.json CLAUDE.md .devcontainer/devcontainer.json fly.toml .github/workflows/release.yml README.md; do
  if [ -f "$f" ]; then
    # Replace the bare token "treenav-mcp" with "treenav" everywhere in these files
    sed -i.bak 's/treenav-mcp/treenav/g' "$f"
    rm "$f.bak"
  fi
done
```

This is a blunt instrument — Phase 2 will rewrite README content properly. For now, all we want is for the rename to be consistent so Phase 1 ships clean.

- [ ] **Step 2: Hand-verify each file after sed**

Each of the eight files modified by sed needs a quick eyeball pass — sed will replace `treenav-mcp` *anywhere* it appears (including URLs that genuinely should stay, e.g. historical commit messages embedded in CHANGELOG that we may not have).

Read each file and confirm:
- URLs point to the new `joesaby/treenav` repo, not lingering `treenav-mcp` URLs
- No accidental edits inside larger words (`treenav-mcp-something` should not become `treenav-something` if such a token exists — `grep -i "mcp" <file>` to spot)
- `server.json`'s `packages[].identifier` field now reads `treenav`, not `treenav-mcp`
- `fly.toml` has `app = "treenav"`
- `.github/workflows/release.yml` references the correct Docker Hub repo (likely `joesaby/treenav` after sed; confirm this matches what will be created on Docker Hub in Task 1.6)

- [ ] **Step 3: Run grep to find any stragglers in identity files**

Run:
```bash
grep -l "treenav-mcp" server.json smithery.yaml claude_desktop_config.json CLAUDE.md .devcontainer/devcontainer.json fly.toml .github/workflows/release.yml README.md 2>/dev/null
```
Expected: no output (empty = clean).

If any file is listed, open it and decide whether the remaining ref is intentional (rare — historical link) or a sed miss.

### Task 1.4: Replace `treenav-mcp` in code and tests

**Files:**
- Modify: `src/server.ts`
- Modify: `src/server-http.ts`
- Modify: `src/tools.ts`
- Modify: `src/types.ts`
- Modify: `src/code-indexer.ts`
- Modify: `src/parsers/typescript.ts`
- Modify: `src/parsers/python.ts`
- Modify: `tests/search-quality.test.ts`
- Modify: `tests/fixtures/helpers.ts`
- Modify: `tests/fixtures/sample-docs.ts`
- Modify: `scripts/benchmark.ts`

- [ ] **Step 1: Replace `treenav-mcp` → `treenav` in code and tests**

Run from repo root. This loops over every `.ts` file under `src/`, `tests/`, and `scripts/`, so files added since this plan was written are still covered:

```bash
find src tests scripts -name "*.ts" -type f | while read -r f; do
  if grep -q "treenav-mcp" "$f"; then
    sed -i.bak 's/treenav-mcp/treenav/g' "$f"
    rm "$f.bak"
    echo "updated: $f"
  fi
done
```

Note: this catches CLI self-refs like `bunx treenav-mcp init` and `bunx treenav-mcp lint` inside `src/cli-init.ts` and `src/cli-lint.ts`. After the rename, those strings will read `bunx treenav init` and `bunx treenav lint`, matching the new `bin` entry from Task 1.2.

- [ ] **Step 2: Run the full test suite**

Run:
```bash
bun test 2>&1 | tail -20
```
Expected: all 109+ tests pass (per `MEMORY.md`, search-quality.test.ts has 109 tests). Watch for tests that asserted on the old name string.

If any test fails because it asserts on a literal `treenav-mcp` string, update the assertion to `treenav` and re-run. **Do not** patch tests that fail for any other reason — investigate the regression.

- [ ] **Step 3: Smoke-test the stdio server**

Run:
```bash
DOCS_ROOT=./docs timeout 3 bun run serve 2>&1 | head -5 || true
```
Expected: server logs the new name in its startup message (e.g. `treenav MCP server running on stdio`), then times out after 3s — that's expected, stdio MCP servers run until the client disconnects.

- [ ] **Step 4: Smoke-test the HTTP server**

Run:
```bash
DOCS_ROOT=./docs PORT=3199 bun run serve:http &
SERVER_PID=$!
sleep 2
curl -s http://localhost:3199/health 2>&1 || curl -s http://localhost:3199/ 2>&1 | head -3
kill $SERVER_PID 2>/dev/null
```
Expected: a JSON or plain-text response that doesn't 500. The exact endpoint depends on `src/server-http.ts`; if `/health` doesn't exist, the root path should at least respond with something.

### Task 1.5: Final grep + commit Phase 1

**Files:** none (verification + commit)

- [ ] **Step 1: Repo-wide grep for stragglers**

Run from repo root:
```bash
grep -rln "treenav-mcp" \
  --include="*.ts" --include="*.json" --include="*.yml" --include="*.yaml" \
  --include="*.toml" --include="Dockerfile*" \
  README.md CLAUDE.md \
  src/ tests/ scripts/ .github/ .devcontainer/ \
  package.json server.json smithery.yaml claude_desktop_config.json \
  fly.toml Dockerfile \
  2>/dev/null | sort -u
```
Expected: empty output, OR only files we deliberately left alone (none in Phase 1's scope).

If the output lists any file in scope, open it, fix manually, re-run grep until clean.

- [ ] **Step 2: Verify historical docs were not touched**

Run:
```bash
grep -l "treenav-mcp" docs/plans/*.md docs/benchmark-*.md 2>/dev/null
```
Expected: every plan and benchmark file still contains the old name (we deliberately left those alone).

If any is missing the old name, sed went too far. Restore from git: `git checkout <file>`.

- [ ] **Step 3: Commit Phase 1**

```bash
git checkout -b rename/treenav
git add -A
git commit -m "$(cat <<'EOF'
feat!: rename treenav-mcp to treenav across all identity and code surfaces

Project is now positioned as both an MCP server AND an embeddable library
for code+docs retrieval. The -mcp suffix overconstrained the identity.

- package.json: name, mcpName, bin, repo URLs (npm 2.0.0 signals the rename)
- server.json + smithery.yaml: registry metadata
- README + CLAUDE.md: header refs only (Phase 2 rewrites prose for findability)
- src/, tests/, scripts/: server-name strings, fixture refs, run-command refs
- fly.toml + .devcontainer + .github/workflows: infra/CI

Historical docs (docs/plans/*, docs/benchmark-*) deliberately untouched —
they record the project at its old name.

BREAKING CHANGE: npm package name changes from treenav-mcp to treenav. No
existing consumers, so no deprecation shim. Anyone using bunx treenav-mcp
must switch to bunx treenav once 2.0.0 publishes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Open PR RA**

```bash
git push -u origin rename/treenav
gh pr create --title "feat!: rename treenav-mcp to treenav (Phase 1: atomic rename)" --body "$(cat <<'EOF'
## Summary
Phase 1 of `docs/plans/2026-05-04-rename-and-retrofit.md`.

Renames every internal reference from `treenav-mcp` to `treenav`. No prose rewrites — Phase 2 (separate PR) handles the README/description findability rewrite.

`treenav` was verified available on npm at planning time.

## Out of band, before merging
- [ ] Confirm `npm view treenav` still 404s (Task 1.1 step 1 will be re-run)
- [ ] Confirm in-flight Semble-port PRs (#14–#19) are merged or rebased onto this — they will conflict on src/ files

## Out of band, after merging
- [ ] Rename GitHub repo `joesaby/treenav-mcp` → `joesaby/treenav` (UI)
- [ ] `fly apps rename treenav-mcp treenav`
- [ ] Create Docker Hub repo `joesaby/treenav` (release workflow will publish on next tag)
- [ ] Publish 2.0.0 to npm (semantic-release will fire from the merge commit's BREAKING CHANGE footer)

## Test plan
- [x] `bun test` passes (109+ tests)
- [x] stdio server boots
- [x] HTTP server boots
- [ ] (post-merge) `bunx treenav` works after npm publish

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 2 — Findability rewrite (PR RB)

### Task 2.1: Rewrite `package.json` description and keywords

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace description**

Apply this exact edit:

```diff
-  "description": "Agentic document retrieval over markdown — BM25 search + tree navigation via MCP. Inspired by PageIndex and Pagefind.",
+  "description": "Local search backend for code, docs, and structured data that AI agents can navigate. BM25 search, regex grep, AST tree navigation, and O(1) row lookup over markdown, source code, and CSV/JSONL. No embeddings, no vector DB, no LLM calls. Use as an MCP server or embed as a library. TypeScript, Python, Go, Rust, Java, C++, and more.",
```

- [ ] **Step 2: Replace keywords block**

Apply this exact edit:

```diff
-  "keywords": [
-    "mcp",
-    "model-context-protocol",
-    "rag",
-    "bm25",
-    "markdown",
-    "documentation",
-    "llm",
-    "ai",
-    "search",
-    "tree-navigation",
-    "claude"
-  ],
+  "keywords": [
+    "mcp",
+    "mcp-server",
+    "model-context-protocol",
+    "code-search",
+    "code-indexing",
+    "code-navigation",
+    "ast",
+    "documentation",
+    "documentation-search",
+    "search",
+    "local-search",
+    "bm25",
+    "grep",
+    "regex-search",
+    "rag",
+    "rag-alternative",
+    "tree-navigation",
+    "csv",
+    "jsonl",
+    "structured-data",
+    "data-search",
+    "agents",
+    "ai-agents",
+    "llm",
+    "ai",
+    "claude",
+    "claude-code",
+    "cursor",
+    "cline",
+    "continue",
+    "library",
+    "embeddable",
+    "typescript",
+    "javascript",
+    "python",
+    "golang",
+    "rust",
+    "java",
+    "cpp",
+    "pagefind",
+    "pageindex",
+    "bun",
+    "markdown"
+  ],
```

- [ ] **Step 3: Verify the edit**

Run:
```bash
bun -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log(p.description.length, 'chars'); console.log(p.keywords.length, 'keywords');"
```
Expected: description length is reported (likely ~250 chars; npm has no hard limit but anything under 300 is comfortable for search snippets); keyword count is 36+.

### Task 2.2: Rewrite README header and tagline

**Files:**
- Modify: `README.md` (lines 1–13)

- [ ] **Step 1: Replace lines 1–13 with the new header**

Open `README.md`. Replace the current title block and tagline (`# treenav` plus the next ~12 lines through the "Why not just grep or RAG?" header) with this exact content. **Preserve everything from "Why not just grep or RAG?" onward** — Phase 2 only rewrites the header.

```markdown
# treenav

**A local search backend for code, docs, and structured data that AI agents can navigate.**

BM25 search, literal/regex grep, AST-based tree navigation, and O(1) row lookup — over markdown documentation, source code, and CSV/JSONL data. Code parsers cover TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Scala, C, C++, C#, Ruby, Swift, PHP, and more. Use it as an MCP server, an HTTP service, or a library you embed in your own MCP. No vector DB, no embeddings, no LLM calls at index or query time.

**Works with:** [Claude Code](https://claude.com/claude-code), [Claude Desktop](https://claude.ai), [Cursor](https://cursor.sh), [Cline](https://github.com/cline/cline), [Continue](https://continue.dev), [Goose](https://github.com/block/goose), or any MCP-compatible client. Also runnable as a standalone HTTP service, as a TypeScript library imported into your own MCP server, or via `bunx treenav init` to wire treenav into a host's MCP config in one command.

## Why not just grep or RAG?
```

(The rest of the file continues from "**vs grep/glob:**" as before, unchanged.)

- [ ] **Step 2: Verify the file still renders**

Run:
```bash
head -20 README.md
```
Expected: the new tagline, no orphaned heading levels, no leftover "BM25 search + hierarchical tree navigation..." line that the new tagline replaces.

### Task 2.3: Update `server.json` description

**Files:**
- Modify: `server.json`

- [ ] **Step 1: Replace the description field**

Apply:
```diff
-  "description": "BM25 search + tree navigation over markdown docs for AI agents. No embeddings, no LLM calls.",
+  "description": "Local BM25 + AST tree-navigation search backend for code and docs, for AI agents. MCP server or embeddable TypeScript library. No embeddings, no vector DB, no LLM calls.",
```

- [ ] **Step 2: Validate JSON**

Run:
```bash
bun -e "JSON.parse(require('fs').readFileSync('server.json','utf8'))"
```
Expected: silent (parse OK).

### Task 2.4: Update `smithery.yaml` description

**Files:**
- Modify: `smithery.yaml`

- [ ] **Step 1: Replace the description line**

Apply:
```diff
-description: Agentic document retrieval over markdown — BM25 search + tree navigation via MCP. No vector DB, no embeddings, no LLM calls at index time.
+description: Local search backend for code and docs that AI agents can navigate — BM25 + AST tree navigation. MCP server or embeddable library. No vector DB, no embeddings, no LLM calls. TypeScript, Python, Go, Rust, Java, C++, and more.
```

- [ ] **Step 2: Validate YAML**

Run:
```bash
bun -e "const yaml=require('node:fs').readFileSync('smithery.yaml','utf8'); console.log(yaml.split('\n').length, 'lines');"
```
Expected: prints line count > 0 (no parse since Bun has no built-in YAML, but read-success suffices). For deeper validation: `bunx js-yaml smithery.yaml` if `js-yaml` is available.

### Task 2.5: Update `CLAUDE.md` header sentence

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the project-overview tagline and top heading**

Open `CLAUDE.md`. The Phase 1 sed will already have changed `# CLAUDE.md — treenav-mcp` to `# CLAUDE.md — treenav`. Now find the `## Project Overview` section and replace its first paragraph with text that adds the "MCP server / HTTP service / library" framing while preserving every accurate scope detail (grep, CSV/JSONL, lookup_row, language list):

```markdown
## Project Overview

treenav is a local search backend for code, docs, and structured data that AI agents can navigate. Available as an MCP server (`treenav serve`), an HTTP service (`treenav serve:http`), or a TypeScript library you import into your own MCP server. It provides BM25 search, literal/regex grep, hierarchical tree navigation, and O(1) row lookup over markdown documentation, source code, and CSV/JSONL data. Agents get a table of contents they can reason over — for docs, code, and tabular data — then retrieve only the sections, symbols, or rows they need. Supports AST-based code navigation for TypeScript, Python, Go, Rust, Java, C/C++, and more. No vector DB, no embeddings, no LLM calls at index or retrieval time.
```

The rest of `CLAUDE.md` (Architecture, Data Flow, Environment Variables, MCP Tools, CLI Wrappers, etc.) should be left intact unless a stale ref is found in the next step.

- [ ] **Step 2: Grep for any remaining stale phrasing**

Run:
```bash
grep -n -E "agentic document retrieval|treenav-mcp is" CLAUDE.md
```
Expected: empty output. Any match indicates a stale phrase to manually rewrite.

### Task 2.6: Commit and open PR RB

- [ ] **Step 1: Smoke-test**

Run:
```bash
bun test 2>&1 | tail -5
```
Expected: all tests still pass — Phase 2 is text-only, no behavior changes.

- [ ] **Step 2: Commit**

```bash
git add package.json README.md server.json smithery.yaml CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: rewrite description and README header for findability

Repositions treenav as a local search backend for code AND docs (not
just markdown), with explicit "MCP server or library" framing and a
"Works with" section naming Claude Code / Cursor / Cline / Continue /
Goose to capture long-tail searches.

- package.json: description rewritten, keywords expanded from 11 to 36+
  (adds code-search, code-indexing, ast, agents, ai-agents, library,
  embeddable, language names, pagefind, pageindex, claude-code, cursor,
  cline, continue)
- README.md: new tagline + language list + Works-with section
- server.json + smithery.yaml: registry descriptions match new framing
- CLAUDE.md: project overview reflects code-search scope and library use

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Open PR RB**

```bash
git push origin rename/treenav-phase2  # branch off rename/treenav after PR RA merges
gh pr create --title "docs: rewrite description and README header for findability (Phase 2)" --body "Phase 2 of \`docs/plans/2026-05-04-rename-and-retrofit.md\`. Depends on PR RA being merged."
```

---

## Phase 3 — Active doc retrofit (PR RC)

Phase 3 audits each active doc against the current code and updates anything stale. Most edits will be small; the new framing introduces "library" and "code search" as first-class concerns that older docs may not reflect.

### Task 3.1: Audit `docs/DESIGN.md`

**Files:**
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: Read the file**

Read the entire `docs/DESIGN.md`. Note any place that says:
- "treenav-mcp" → already handled in Phase 1, but recheck.
- "for markdown" without acknowledging code → update to "for code and docs."
- Implies indexing is markdown-only → update to mention AST indexing.
- References tools/files no longer present → flag for the maintainer.

- [ ] **Step 2: Apply targeted edits**

For each finding, make the smallest possible edit that corrects the stale statement. **Do not** restructure the document — its current organization (BM25 engine → tree model → code indexer → attribution) is sound.

If no edits are needed, that is a valid outcome — record it in the commit message.

- [ ] **Step 3: Verify links resolve**

Run:
```bash
grep -oE "\]\([^)]+\)" docs/DESIGN.md | sort -u
```
Inspect each link. Any that point to old `treenav-mcp` paths or removed files need fixing.

### Task 3.2: Audit `docs/CONFIGURATION.md`

**Files:**
- Modify: `docs/CONFIGURATION.md`

- [ ] **Step 1: Cross-check env-var list against the source of truth**

The authoritative env-var list lives in `CLAUDE.md`'s "Environment Variables" table. Compare it against `docs/CONFIGURATION.md`. Flag every discrepancy.

Run:
```bash
grep -E "^\| \`[A-Z_]+\`" CLAUDE.md > /tmp/claude-vars.txt
grep -E "^\| \`[A-Z_]+\`" docs/CONFIGURATION.md > /tmp/config-vars.txt
diff /tmp/claude-vars.txt /tmp/config-vars.txt
```
Expected: small diff or no diff. Any var in `CLAUDE.md` but not `CONFIGURATION.md` (or vice versa) is the gap.

- [ ] **Step 2: Apply edits**

For every gap: copy the missing var into `docs/CONFIGURATION.md` with the same description as `CLAUDE.md`. If a var listed in `CONFIGURATION.md` no longer exists in code, **flag for maintainer review** rather than silently deleting — verify with `grep -r "VAR_NAME" src/` first.

### Task 3.3: Audit `docs/wiki-curation-spec.md` and `docs/adr/0001-llm-curated-wiki.md`

**Files:**
- Modify: `docs/wiki-curation-spec.md`
- Modify: `docs/adr/0001-llm-curated-wiki.md`

- [ ] **Step 1: Verify name and tool-list accuracy**

Both docs describe the curation toolset (`find_similar`, `draft_wiki_entry`, `write_wiki_entry`). Verify against `src/curator.ts` that these tool names are still accurate and that no curation tools have been added or removed.

Run:
```bash
grep -E "name: \"[a-z_]+\"" src/tools.ts | head -20
```
Expected: see the actual registered tool names. Cross-check against the spec and ADR.

- [ ] **Step 2: Apply edits**

Fix any name drift, capitalization issue, or out-of-date tool description.

### Task 3.4: Audit `docs/search-quality-spec.md`

**Files:**
- Modify: `docs/search-quality-spec.md`

- [ ] **Step 1: Confirm metric thresholds match code**

Per `MEMORY.md`:
- 109 tests, 0 failures as of 2026-02-28
- NDCG@10 ≥ 0.65 overall, ≥ 0.83 exact-match, MRR ≥ 0.70
- Per-language NDCG ≥ 0.65 (8 languages)
- Per-repo-type NDCG ≥ 0.65 (7 domains)

Verify the spec doc reflects these numbers. If thresholds in code (`tests/search-quality.test.ts`) have shifted since the spec was last updated, update the spec to match.

- [ ] **Step 2: Apply edits**

### Task 3.5: Commit Phase 3

- [ ] **Step 1: Smoke**

```bash
bun test 2>&1 | tail -3
```
Expected: tests still pass.

- [ ] **Step 2: Commit**

```bash
git add docs/DESIGN.md docs/CONFIGURATION.md docs/wiki-curation-spec.md docs/adr/0001-llm-curated-wiki.md docs/search-quality-spec.md
git commit -m "$(cat <<'EOF'
docs: retrofit active design + spec docs for current scope

Audit pass after the rename and findability rewrite. Updates each active
doc to reflect that treenav is now a search backend for code AND docs,
exposed as both an MCP server and an embeddable library.

- DESIGN.md: corrected stale "markdown only" framings
- CONFIGURATION.md: env-var list reconciled with CLAUDE.md
- wiki-curation-spec.md + ADR-0001: tool-name drift checked against src/
- search-quality-spec.md: metric thresholds confirmed against tests

Historical artifacts in docs/plans/ and docs/benchmark-*.md deliberately
left as-is — those record the project at its old name and old scope.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Acknowledgements (PR RD)

### Task 4.1: Create `docs/ACKNOWLEDGEMENTS.md`

**Files:**
- Create: `docs/ACKNOWLEDGEMENTS.md`

- [ ] **Step 1: Write the file**

Create `docs/ACKNOWLEDGEMENTS.md` with this exact content:

```markdown
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
```

- [ ] **Step 2: Replace the README "Standing on Shoulders" section with a pointer**

Open `README.md`, find the `## Standing on Shoulders` section near the bottom, and replace its content with:

```markdown
## Standing on Shoulders

treenav builds on direct ideas from [PageIndex](https://pageindex.ai), [Pagefind](https://pagefind.app), [Semble](https://github.com/MinishLab/semble), and [Model2Vec](https://github.com/MinishLab/model2vec). The full record — what we borrowed, from whom, where it lives in the code — is in [`docs/ACKNOWLEDGEMENTS.md`](docs/ACKNOWLEDGEMENTS.md).
```

This keeps the README short while still giving credit at the surface level.

### Task 4.2: Commit Phase 4

- [ ] **Step 1: Verify the new file**

Run:
```bash
wc -l docs/ACKNOWLEDGEMENTS.md
head -20 docs/ACKNOWLEDGEMENTS.md
```
Expected: ~70+ lines, header reads "# Acknowledgements".

- [ ] **Step 2: Commit**

```bash
git add docs/ACKNOWLEDGEMENTS.md README.md
git commit -m "$(cat <<'EOF'
docs: add ACKNOWLEDGEMENTS.md consolidating upstream credits

Single canonical record of every project treenav borrows ideas from:
PageIndex (workflow), Pagefind (BM25 engine), Semble (ranking pipeline),
Model2Vec (Tier 4 embedder), Bun (runtime), MCP SDK (protocol).

README's "Standing on Shoulders" trimmed to a pointer at the new file.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Extend competitive analysis (PR RE)

### Task 5.1: Read existing analysis and identify gaps

**Files:**
- Modify: `docs/COMPETITIVE-ANALYSIS.md`

- [ ] **Step 1: Read existing comparisons**

Read `docs/COMPETITIVE-ANALYSIS.md` end-to-end. Note which projects it currently compares against.

- [ ] **Step 2: Identify projects to add**

The README mentions PageIndex, QMD, GitMCP, Code-Index-MCP. The acknowledgements doc adds Semble and Model2Vec. Other projects worth comparing against:

- [`mcp-server-filesystem`](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) (official Anthropic MCP) — agents read files, no search index, no AST. Useful as the "what you get if you do nothing" baseline.
- [`mcp-server-grep`](https://www.npmjs.com/search?q=mcp-grep) and similar grep wrappers — fast but no structural understanding.
- [Sourcegraph Cody](https://sourcegraph.com/cody) — heavyweight, hosted, embedding-based. Useful as the "industrial RAG" comparison.
- [Aider's repo map](https://aider.chat/docs/repomap.html) — different shape (token-budget-aware repo summary), but adjacent enough to be worth noting.
- [LlamaIndex's TreeIndex](https://docs.llamaindex.ai) — predecessor of the tree-navigation idea, in a different stack.

For each project the implementer thinks is worth adding, follow Step 3.

- [ ] **Step 3: Append a comparison row per project**

Match the format already used in `docs/COMPETITIVE-ANALYSIS.md`. For each new comparison:

- One paragraph on what the project is and how it works
- A "vs treenav" subsection covering: indexing model, query model, embedding requirement, code/docs scope, MCP support, library use, latency, install footprint
- A clear "when to pick which" sentence

Do not write filler. If a comparison adds nothing — e.g., the project is identical in scope, or so different the comparison is meaningless — skip it.

### Task 5.2: Commit Phase 5

- [ ] **Step 1: Commit**

```bash
git add docs/COMPETITIVE-ANALYSIS.md
git commit -m "$(cat <<'EOF'
docs: extend competitive analysis with current comparable projects

Adds rows for mcp-server-filesystem (baseline), Sourcegraph Cody
(industrial RAG), Aider repo map (token-budget-aware summarization),
and LlamaIndex TreeIndex (tree-navigation predecessor in a different
stack). Where appropriate, updates existing rows to reflect the
new "code + docs, library + MCP" framing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Audit and delete obsolete (PR RF)

This phase is a review-and-confirm sweep. Each candidate deletion is gated on a maintainer signoff.

### Task 6.1: Build the candidate list

**Files:** none (review only)

- [ ] **Step 1: Inspect plan documents for superseded plans**

Run:
```bash
ls -la docs/plans/
```

For each file, ask: was this plan executed? If yes, are the artifacts in code? If yes, is the plan still useful as a reference, or is the code the canonical record now?

Likely candidates for *archival* (move into `docs/plans/archive/`, not delete):
- `docs/plans/2026-03-08-semantic-release-design.md` and `docs/plans/2026-03-08-semantic-release.md` — semantic-release is shipped, design is captured in `CLAUDE.md`'s Releases section
- `docs/plans/2026-03-08-enhanced-search-formatter.md` and `docs/plans/2026-03-08-search-formatter-impl.md` — superseded if the formatter shipped

Likely candidates to *keep in active*:
- `docs/plans/2026-02-28-search-quality-expansion.md` — references the test suite that's still in flux
- `docs/plans/2026-05-03-semble-feature-port.md` — actively in flight (PRs #14–#19+)
- `docs/plans/2026-05-04-rename-and-retrofit.md` — this plan

- [ ] **Step 2: Inspect benchmark docs**

Run:
```bash
ls -la docs/benchmark-*.md
```

These are dated benchmark snapshots. They are evergreen as a record but lose value if the underlying code has changed dramatically. Check the dates inside each file. If the benchmark is still representative, keep. If not, archive.

- [ ] **Step 3: Search for orphaned config or test files**

Run:
```bash
git log --diff-filter=D --summary --pretty=format: --name-only | sort -u | head -40
find . -name "*.bak" -o -name ".DS_Store" -o -name "*.orig" 2>/dev/null
```
Expected (second command): empty. Any output is a stray file to delete.

- [ ] **Step 4: Compile the candidate list**

Produce a markdown checklist of every file proposed for deletion or archival, with one line of justification per item. Post it as a comment on PR RF for maintainer review **before** running any `git rm` or `git mv`.

### Task 6.2: Execute the approved deletions

**Files:** as approved by maintainer

- [ ] **Step 1: Wait for explicit maintainer approval per file**

Do not delete or move any file until the maintainer has checked the box for it on the PR comment.

- [ ] **Step 2: Apply approved changes**

```bash
mkdir -p docs/plans/archive
git mv docs/plans/<approved-file>.md docs/plans/archive/<approved-file>.md
# OR for true deletions:
git rm <approved-file>
```

- [ ] **Step 3: Smoke-test**

```bash
bun test 2>&1 | tail -3
grep -r "<deleted-file>" --include="*.md" --include="*.ts" 2>/dev/null
```
Expected: tests pass; second grep is empty (no broken links to deleted files).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs: archive superseded plans and remove stale artifacts

Per maintainer review on PR RF, the following are archived to
docs/plans/archive/ or removed entirely:

<list approved items here>

Active plans, benchmarks, and ADRs are unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification across all phases

After every PR merges, the implementer should run this checklist:

- [ ] `bun test` passes (109+ tests)
- [ ] `bun run serve` boots the stdio server with the new name in startup logs
- [ ] `bun run serve:http` boots the HTTP server
- [ ] `npm pack --dry-run` reports `treenav` as the package name (after PR RA)
- [ ] No file matches `grep -rln "treenav-mcp" --include='*.ts' --include='*.json' --include='*.yml' --include='*.yaml' --include='*.toml' README.md CLAUDE.md src/ tests/ scripts/ .github/ .devcontainer/` (after PR RA — historical docs in `docs/plans/` and `docs/benchmark-*.md` should still match)
- [ ] README's first 20 lines contain: "local search backend", "code and docs", "AI agents", "MCP server", "library", at least 3 language names
- [ ] `docs/ACKNOWLEDGEMENTS.md` exists, lists PageIndex, Pagefind, Semble, Model2Vec, Bun, MCP SDK
- [ ] `docs/COMPETITIVE-ANALYSIS.md` has at least 3 net-new comparison rows beyond the original set

---

## Out-of-band actions for the maintainer

These cannot be done from inside the PR; the implementer should leave them as a checklist on PR RA's body.

- [ ] **GitHub repo rename**: from settings → "Rename repository" → `treenav-mcp` → `treenav`. GitHub auto-redirects old URLs.
- [ ] **Fly app rename**: `fly apps rename treenav-mcp treenav`. Updates the `*.fly.dev` URL.
- [ ] **Docker Hub repo create**: `joesaby/treenav` (visibility = public). The release workflow will publish on the next semantic-release tag.
- [ ] **npm publish 2.0.0**: triggered automatically by semantic-release once PR RA's BREAKING CHANGE commit lands on `main`. Verify with `npm view treenav` ~5 minutes after merge.
- [ ] **Smithery registry**: re-submit if the existing entry is keyed on the old name. Most registries auto-pick up `smithery.yaml` changes.
- [ ] **MCP registry**: same — re-submit if needed; otherwise the next push of `server.json` updates the entry.
