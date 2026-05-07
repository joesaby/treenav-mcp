# ADR 0002: Multi-Intent Composition Is Out of Scope for compile_context

**Status:** Accepted — v1 ships single-intent only; multi-intent deferred under explicit reopening criteria
**Date:** 2026-05-06
**Deciders:** treenav maintainers
**Related:** [docs/superpowers/specs/2026-05-06-compile-context-design.md](../superpowers/specs/2026-05-06-compile-context-design.md), [docs/adr/0001-llm-curated-wiki.md](0001-llm-curated-wiki.md), [docs/COMPETITIVE-ANALYSIS.md](../COMPETITIVE-ANALYSIS.md)

---

## Context

In May 2026, Pinecone announced "Pinecone Nexus" with a declarative query
language (KnowQL) that frames agent retrieval as compilation of
"task-optimized specialized contexts" with primitives `intent | filter |
provenance | output shape | confidence | budget`. The framing reignited an
internal question: should treenav add a structured composition primitive
of its own, and if so, how expressive?

A brainstorming pass produced the design for `compile_context` — a single
new MCP tool that orchestrates the existing read-side primitives
(`search_documents`, `grep_documents`, `get_tree`, `get_node_content`,
`lookup_row`, `find_symbol`) behind one call and returns ranked hits
partitioned by source, with bundled outline trees for the top hits and
explicit budget metadata. That design is captured in
[docs/superpowers/specs/2026-05-06-compile-context-design.md](../superpowers/specs/2026-05-06-compile-context-design.md).

A specific shape question came up during design and is the subject of
this ADR: should `compile_context` accept **multi-intent input** — i.e.,
a list of *distinct* sub-queries (different intent strings, possibly
different modes, possibly different filters) executed in one call and
merged into a single response?

A schematic multi-intent call would look like:

```jsonc
{
  "queries": [
    { "intent": "auth token rotation", "mode": "search", "filters": { "type": "runbook" } },
    { "intent": "INC-104",             "mode": "lookup" },
    { "intent": "parseAuthHeader",     "mode": "symbol" }
  ],
  "output": { "merge": "interleave", "max_tokens": 3000 }
}
```

This is closer to KnowQL's vision of an agent declaring an entire
knowledge need in one document and the system compiling the answer. It
is also adjacent to the "give me docs AND code AND the tree" flow that
came up during brainstorming.

That flow turned out, on closer inspection, to be a single intent
applied across two corpora plus an output-shape choice — handled by the
`sources` and `include_outlines_for_top` knobs in the v1 design without
any multi-intent machinery. The genuinely multi-intent case — three or
more *disjoint* queries fused into one decision context — is rarer and
harder.

This ADR records the decision to **not** support multi-intent in v1 or
the planned v2 of `compile_context`, and defines the explicit criteria
under which a future ADR could reopen it.

---

## Decision

`compile_context` accepts **exactly one intent string per call**.

Skills that need several distinct queries make several calls. The
"rich single intent" shape — one query string, source-partitioned
output, bundled outline trees for top hits — is the supported way to
satisfy multi-step retrieve loops.

### Guiding principle (carried forward from ADR-0001)

> **treenav is the library infrastructure; the calling agent is the librarian.**

Multi-intent composition is *workflow logic*. It belongs in the agent
runtime (or in a skill template that issues multiple calls), not in the
library. treenav exposes deterministic primitives; agents and skills
sequence them.

### What this ADR rejects

- A `queries: [...]` array on `compile_context` input.
- Per-sub-query budgeting (which sub-query gets to keep its full
  content when the total exceeds `max_tokens`).
- Cross-sub-query merge ordering (interleave by score, round-robin,
  group-by-source — all contestable).
- Cross-sub-query citation disambiguation in the response format.

### What this ADR does **not** reject

- The single-intent `compile_context` design itself (that lives in the
  v1 design spec; this ADR is silent on it except to anchor scope).
- The "rich single intent" affordances: multiple `sources`, source
  partitioning, bundled outlines, `mode: auto`. These collapse the
  most common multi-step flows without introducing multi-intent.
- A future, separately-named tool (e.g. a hypothetical
  `compile_context_batch`) if reopening criteria below are met. This
  ADR does not preclude that — it only states that
  `compile_context`'s contract is single-intent and will not change.

---

## Consequences

### Positive

- **Tool surface stays small and predictable.** One Zod schema, one
  validation path, one budget arithmetic. Skill authors and agents
  reason about a single shape.
- **Determinism is straightforward.** With one ranking pass per call,
  output ordering is trivially stable. Multi-intent merge ordering is
  its own design problem we do not need to solve.
- **Budget arithmetic is tractable.** The v1 design spec defines a
  single trim order (drop lower-ranked hits → shorten snippets → drop
  outlines). Multi-intent would force per-sub-query budget
  arbitration, which is contestable in different directions for
  different skills.
- **Citations stay clean.** Every hit traces unambiguously to one
  query. Multi-intent would force the response to label which
  sub-query each citation served, and skills would have to
  disambiguate.
- **YAGNI honored.** No real skill in this repo or its competitor
  surface (PageIndex, docs-mcp-server, QMD, Context7) has been
  demonstrated to genuinely need disjoint queries fused in one call.
  Most "multi" use cases collapse to single-intent + partitioned
  output once examined.
- **Coherent with ADR-0001.** treenav remains the deterministic
  primitive layer; orchestration lives in the calling agent.

### Negative / risks

- **Some real skills will eventually need disjoint queries.** A flow
  like "find the auth runbook AND last October's incident postmortem
  AND the deploy-freeze policy" is three different intents with no
  shared ranking. Today such a skill issues three `compile_context`
  calls (or three primitive-tool chains). The cost is roughly 3×
  model turns for that subset of skills.
- **Pinecone framing pressure.** KnowQL's vision is broader.
  Evaluators comparing treenav to Nexus may find `compile_context`
  less expressive. Mitigation: be explicit in
  [COMPETITIVE-ANALYSIS.md](../COMPETITIVE-ANALYSIS.md) and the v1
  design spec that `compile_context` is *composition*, not a query
  language; the gap is intentional.
- **Retrofit risk.** Adding multi-intent later, once skills depend on
  single-intent semantics, may require a new tool name (e.g.
  `compile_context_batch`) rather than extending `compile_context`'s
  contract. Mitigation: that is acceptable — a sibling tool keeps the
  v1 contract stable and signals the semantic break clearly.

### Neutral

- This decision is **reversible** under the explicit criteria below.
  This ADR is not a permanent prohibition; it is a bar set high enough
  that we do not build multi-intent on hypothetical demand.

---

## Alternatives considered

### A. Multi-intent as a v1 feature
Ship `compile_context` with a `queries: [...]` array on day one.

*Rejected because:* the consequences above (per-sub-query budgeting,
merge ordering, citation disambiguation, increased schema surface)
compound v1's risk. v1 already needs to clear three measurement gates
(principle, accuracy, value). Adding multi-intent to v1 makes those
gates harder to read — a regression could come from composition logic
or from multi-intent merge logic, and we would not be able to tell
which.

### B. Multi-intent as a v2 feature
Ship single-intent in v1; commit v2 to multi-intent.

*Rejected because:* v2 is already committed to skill integration (see
the v1 design spec, Section 6). Adding multi-intent to v2 doubles its
scope and pre-commits to a feature whose justification is still
hypothetical. v2 should land cleanly first; multi-intent waits for
evidence.

### C. KnowQL-style declarative DSL
Adopt a fuller declarative query language with primitives modeled on
`intent | filter | provenance | output shape | confidence | budget`.

*Rejected because:* most KnowQL primitives have no analog in treenav.
*Confidence* is undefined for deterministic BM25. *Budget* is local
CPU, not API spend, and is already covered by `max_tokens`.
*Provenance* is already mandatory in `compile_context`'s output by
design. *Output shape* is captured by the four `output.*` knobs.
*Filter* is already a first-class input. The remaining novelty would
be multi-intent — which this ADR rejects on its own merits — and a
parser for a tiny set of features that do not justify the parser.

### D. Skill-registered named tools
Skills register themselves as named MCP tools at install time, each
one a fixed multi-intent compilation (e.g.
`incident_runbook_lookup` exposes a pre-baked three-query merge).

*Rejected (this was Option B in the design brainstorm):* introduces a
registry, naming policy, hot-reload semantics, and per-install
variability in the agent's tool surface. The v1 design favors a
single generic tool (`compile_context`) precisely for portability and
to keep the agent's tool surface stable. Multi-intent inside a
registered skill would shift this complexity into the registration
layer rather than remove it.

---

## Reopening criteria

This ADR can be revisited and superseded if **all three** of the
following hold:

1. **Demonstrated demand.** ≥ 3 real skills (in this repo or partner
   repos) where authors are observably chaining `compile_context`
   calls back-to-back to assemble one decision context, *and* the
   queries are genuinely disjoint — different intent strings, not just
   different modes or sources for one intent.
2. **Material savings.** Measurement shows the chained pattern costs
   > 50% more tokens or > 1 additional round trip vs. a hypothetical
   multi-intent merge. Marginal savings do not meet this bar.
3. **Sound design.** A multi-intent design exists that preserves the
   v1 contract's determinism guarantees, citation cleanliness, and
   budget tractability — i.e., the merge-ordering and per-sub-query
   budgeting questions have concrete, defensible answers, not
   handwaves.

If all three are met, write ADR-0003 introducing
`compile_context_batch` (or equivalent) as a sibling tool, leaving
`compile_context`'s single-intent contract intact. Until then, this
decision stands.

---

## References

- [docs/superpowers/specs/2026-05-06-compile-context-design.md](../superpowers/specs/2026-05-06-compile-context-design.md)
  — v1 design (same change set as this ADR)
- [docs/adr/0001-llm-curated-wiki.md](0001-llm-curated-wiki.md) —
  establishes the ADR convention and the "treenav is library, agent is
  librarian" principle that this decision preserves
- [docs/DESIGN.md](../DESIGN.md) — existing architecture
- [docs/COMPETITIVE-ANALYSIS.md](../COMPETITIVE-ANALYSIS.md) —
  positions treenav against PageIndex / Pinecone Nexus /
  docs-mcp-server and motivates intentional scope discipline
- [CLAUDE.md](../../CLAUDE.md) — zero-LLM-calls principle, current
  tool surface, environment variables
- Pinecone Nexus / KnowQL announcement, May 2026 —
  https://www.pinecone.io/blog/knowledge-infrastructure-for-agents/
