# ADR 0001: LLM-Curated Wiki as a Write-Side Companion to treenav-mcp

**Status:** Proposed
**Date:** 2026-04-11
**Deciders:** treenav-mcp maintainers
**Related:** [docs/wiki-curation-spec.md](../wiki-curation-spec.md), [docs/COMPETITIVE-ANALYSIS.md](../COMPETITIVE-ANALYSIS.md), [docs/DESIGN.md](../DESIGN.md)

---

## Context

treenav-mcp today is a **read-only** system. It indexes markdown and source
code the user already wrote, then exposes BM25 search and hierarchical tree
navigation via MCP. Its core architectural promise is *zero LLM calls at
index or retrieval time* — every piece of intelligence lives in the
*calling* agent (Claude Desktop, Claude Code, etc.).

Andrej Karpathy has publicly advocated for a different consumption model
for personal and organizational knowledge: an LLM acts as a **continuous
curator** of a markdown wiki. Raw inputs (articles, papers, transcripts,
commits, chat logs) flow in; the LLM distills them into structured entries
with frontmatter, tags, and cross-links; the wiki grows as a living graph
rather than an append-only pile. Retrieval works *because* curation
imposed structure — not because a vector DB papered over its absence.

The two ideas are deeply complementary. treenav-mcp already supplies every
primitive a Karpathy-style wiki needs on the read side:

| Karpathy wiki requirement | treenav-mcp today |
|---|---|
| Structured markdown with frontmatter | `src/indexer.ts` parses frontmatter; reserved-key policy enforces hygiene |
| Dedupe check before writing | BM25 engine in `src/store.ts` |
| Cross-link / "related entry" candidates | Same engine, queried with prospective content |
| Tag / type taxonomy | Facet index (`type`, `category`, `tags`) |
| Abbreviation consistency | `glossary.json` bidirectional expansion |
| Fast re-index after writes | Content hashing + incremental re-index path |
| Hierarchical reasoning over results | Tree navigation model + node IDs |

What is missing is the **write path**: MCP tools that let an agent
safely author new entries, dedupe against existing ones, propose
backlinks, and trigger incremental re-index — all without treenav itself
ever calling an LLM.

This ADR records the decision to add that write path as a first-class,
opt-in capability.

---

## Decision

We will add a **curation toolset** to treenav-mcp as an opt-in layer gated
behind a new `WIKI_WRITE=1` environment variable. The toolset exposes new
MCP tools that let a calling agent perform Karpathy-style curation using
its *own* LLM, while treenav enforces structural correctness
(frontmatter schema, path containment, dedupe thresholds, incremental
re-index).

### Guiding principle

> **treenav is the library infrastructure; the calling agent is the librarian.**

treenav does not learn to curate. It offers deterministic primitives —
similarity checks, scaffolding, validated writes, backlink suggestions,
glossary updates — that let *any* LLM agent curate cleanly, with the
guarantee that every resulting entry is immediately indexed and
retrievable.

### What changes

New MCP tools (detailed in [wiki-curation-spec.md](../wiki-curation-spec.md)):

1. `find_similar(content, threshold?)` — BM25 dedupe check
2. `draft_wiki_entry(topic, raw_content, suggested_path?)` — scaffolding (no write)
3. `write_wiki_entry(path, frontmatter, content, dry_run?)` — validated write + re-index
4. `suggest_backlinks(node_id)` — graph-maintenance helper
5. `update_glossary(term, definitions)` — keep abbreviation expansion current
6. `merge_entries(source_id, target_id)` — dedupe workflow (post-MVP)

New reserved frontmatter keys for source attribution:
`source_url`, `source_title`, `captured_at`, `curator`.

### What does **not** change

- treenav-mcp still performs **zero LLM calls** in the index or retrieval
  path. The curation tools return structural data and validation results,
  not LLM-generated content.
- Default behavior stays read-only. Absent `WIKI_WRITE=1`, the new tools
  are not registered and no write code path is reachable.
- No new runtime dependencies (no ML models, no API clients).
- The existing six read-side tools (`list_documents`, `search_documents`,
  `get_tree`, `get_node_content`, `navigate_tree`, `find_symbol`) are
  unchanged.

---

## Consequences

### Positive

- **Closes the loop.** treenav-mcp becomes both the *library* (read side)
  and the *scaffolding that keeps the library tidy* (write side) for
  agent-driven knowledge bases.
- **Philosophical coherence preserved.** Zero LLM calls inside treenav;
  the agent remains the sole locus of intelligence. The principle that
  made treenav distinctive survives intact.
- **Differentiation sharpens.** Competitor matrix in
  [COMPETITIVE-ANALYSIS.md](../COMPETITIVE-ANALYSIS.md) shows no local,
  zero-dependency MCP server currently offers structural curation tools.
  PageIndex curates via LLM calls *inside* the index pipeline; QMD and
  docs-mcp-server are read-only; GitMCP and Context7 are cloud-only.
- **Enterprise story strengthens.** Regulated environments that already
  value treenav-mcp's offline, no-external-call posture can now use it
  as a curation surface without opening any new network holes.
- **Composable.** The MVP (tools 1–3) is independently useful even if
  the later tools never ship.

### Negative / risks

- **New failure surface.** Any write path introduces the risk of
  corrupting `DOCS_ROOT`. Mitigations: opt-in flag, path containment,
  dry-run mode, git-as-undo convention documented in the spec, no
  implicit overwrites.
- **Schema drift.** Reserved frontmatter keys and validation rules
  become a public contract. Changing them later is a breaking change.
  Mitigation: land the schema conservatively, add keys additively,
  document the reserved list in `CLAUDE.md`.
- **Scope creep pressure.** Once a write path exists, users will ask for
  auto-`git add`, LLM-inside-treenav distillation, scheduled curation,
  web capture, etc. Mitigation: each request is evaluated against the
  zero-LLM-calls principle. Scheduled curation and web capture belong in
  a sibling tool or the agent harness, not in treenav-mcp.
- **Dedupe is approximate.** BM25 overlap cannot detect semantic
  duplication (same idea, different vocabulary). Users whose corpora
  have high vocabulary variance will still get near-duplicates. This is
  the same BM25 limitation already acknowledged in
  `COMPETITIVE-ANALYSIS.md:252-268` and is accepted as a known gap.

### Neutral

- The project gains its first ADR, establishing a lightweight
  `docs/adr/NNNN-slug.md` convention for future architecturally
  significant decisions.

---

## Alternatives considered

### A. Do nothing — stay read-only
Keep treenav-mcp purely read-side and let users curate with any editor or
external tool.

*Rejected because:* it misses an opportunity to complete a workflow that
treenav is uniquely positioned to support. A Karpathy-style agent
librarian needs exactly the primitives treenav already has (BM25 dedupe,
frontmatter validation, tree model, glossary) — shipping them as MCP
tools is a small lift relative to the workflow it unlocks. Leaving them
unexposed forces every agent to reimplement them.

### B. Embed an LLM inside treenav-mcp for curation
Add a configurable LLM client (OpenAI, Anthropic, Ollama) that treenav
calls during curation to generate summaries, tags, and cross-links.

*Rejected because:* it violates the "zero LLM calls" principle that
differentiates treenav-mcp from PageIndex, QMD, and docs-mcp-server. It
introduces runtime dependencies, API-key management, cost surface, and
network requirements — all of which the project deliberately avoids.
The calling agent already has an LLM; duplicating it inside treenav
provides no new capability at significant architectural cost.

### C. Ship curation as MCP prompts/resources only
Use MCP's `prompt` and `resource` primitives to expose a curation
workflow as instructions the agent follows using *existing* read-side
tools (e.g., "run `search_documents` to dedupe, then write the file
yourself via your filesystem tool").

*Rejected for the MVP* (but preserved as a documentation add-on): the
agent still has no way to trigger incremental re-index, validate
frontmatter against the reserved-key policy, or enforce path
containment. It would work, but it pushes correctness guarantees onto
every agent prompt rather than centralizing them in treenav. A
`curate` prompt may still ship *alongside* the tools as a convenience.

### D. Build a separate `treenav-curate` binary
A standalone CLI that ingests raw files, calls a user-configured LLM,
and writes to `DOCS_ROOT`.

*Rejected because:* it duplicates the indexer and bypasses MCP. Users
would run two processes with overlapping state and risk index drift. The
in-process MCP-tool approach keeps one source of truth for the index.

---

## Implementation

Implementation detail lives in [wiki-curation-spec.md](../wiki-curation-spec.md).
MVP ordering from that spec:

1. `find_similar` + `write_wiki_entry` (dry-run first) — minimum viable
2. `draft_wiki_entry` scaffolding — structural quality upgrade
3. `suggest_backlinks` — graph maintenance
4. `update_glossary` — vocabulary maintenance
5. `merge_entries` + `delete_wiki_entry` — full dedupe workflow

Stop after step 3 if user feedback indicates the core Karpathy workflow
is satisfied.

---

## References

- Karpathy's advocacy for LLM-curated markdown wikis over vector-DB RAG
  (public posts on personal knowledge management and the "LLM OS" line
  of thinking).
- [docs/COMPETITIVE-ANALYSIS.md](../COMPETITIVE-ANALYSIS.md) — positions
  treenav-mcp against PageIndex and others; motivates the write-path
  differentiation.
- [docs/DESIGN.md](../DESIGN.md) — existing architecture this layer
  builds on.
- [CLAUDE.md](../../CLAUDE.md) — reserved frontmatter keys, environment
  variables, and the zero-LLM-calls principle this ADR preserves.
