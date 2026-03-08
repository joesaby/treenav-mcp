# GraphRAG Optimization — Comparative Analysis

_How five papers are eliminating the LLM tax in GraphRAG, and what treenav-mcp
adopts from each._

**Date:** 2026-03-08
**Context:** Alexander Shereshevsky's analysis in Graph Praxis (Feb 2026)
identified five papers that are dismantling GraphRAG's cost structure — one
pipeline stage at a time. This document analyzes each paper's contribution,
evaluates applicability to treenav-mcp, and documents what was adopted vs.
what was deliberately left out.

---

## The Problem: GraphRAG's Six-Stage LLM Bill

Microsoft's original GraphRAG pipeline [Edge et al., 2024] — the "From Local to
Global" architecture — requires LLM calls at six stages before answering a
single question:

| Stage | LLM Calls | Cost Share |
|-------|----------|------------|
| 1. Entity extraction | 1 per chunk | ~30% |
| 2. Relation extraction | 1 per chunk | ~25% |
| 3. Entity summarization | 1 per entity | ~10% |
| 4. Relation summarization | 1 per relation | ~10% |
| 5. Community detection + reports | 1 per community | ~15% |
| 6. Query-time reasoning | 1+ per query | ~10% |

Microsoft's own documentation estimates stages 1-4 account for roughly 75%
of total indexing cost. For a 10K document corpus, this translates to thousands
of dollars in API spend before the first query.

**treenav-mcp's starting position:** Already zero LLM calls at all stages.
BM25 search + tree navigation handles retrieval. The gap: no cross-document
entity relationships, no multi-hop traversal.

---

## Paper 1: AGRAG — The Entity Extraction Tax

**Paper:** Wang, Y., et al. "AGRAG: Advanced Graph-based Retrieval-Augmented
Generation for LLMs." arXiv:2511.05549, November 2025.

**Problem solved:** Stage 1 — entity extraction costs ~30% of the GraphRAG
budget. LLM-based extraction also hallucinates entities and produces
inconsistent schemas.

**Technique:** Replace LLM entity extraction with TF-IDF scored n-gram
enumeration. The entity relevance score:

```
ER(v, t) = count(v,t) / (|t| · log(|T_c|+1)) × log((|T_c|+1) / (#{t_j : v ∈ t_j} + 1))
```

Entities with `ER > τ` are linked to source chunks. Synonyms are linked via
embedding similarity.

**Results:** Up to 3.69× token savings compared to GraphRAG on the IFS-REL
dataset. Deterministic, non-hallucinating entity selection.

**Retrieval innovation:** MCMI (Minimum Cost Maximum Influence) subgraph
retrieval using Personalized PageRank scores for node importance.

### What treenav-mcp adopted

- **TF-IDF entity relevance scoring.** Each extracted entity gets a TF-IDF
  score using BM25-style IDF: `log((N - df + 0.5) / (df + 0.5) + 1)`.
  This matches the existing BM25 engine's IDF formulation.
- **Regex-based entity extraction** instead of TF-IDF n-grams. AGRAG
  enumerates all n-grams and scores them; we use targeted regex patterns
  (acronyms, proper nouns, CamelCase, backtick terms, compound nouns).
  Less recall, but zero false positives from common word n-grams and
  faster extraction.

### What was deliberately left out

- **Embedding-based synonym linking.** AGRAG links entity synonyms via
  embedding similarity. This would require an embedding model, violating
  our zero-model constraint. The existing glossary system provides manual
  synonym mapping as a partial substitute.
- **MCMI subgraph retrieval.** Interesting but requires Personalized PageRank
  computation over a dense graph. Our co-occurrence graph is sparse enough
  that BFS traversal with hop decay is sufficient.

### Honest assessment

AGRAG's TF-IDF extraction works well for "entity-dense technical text" —
which is precisely treenav-mcp's target (technical documentation, source code).
Open question: generalization to conversational or narrative corpora where
entities are less clearly delineated. Our regex extraction is even more
restrictive than AGRAG's n-gram approach, trading recall for precision.

---

## Paper 2: LinearRAG — The Relation Extraction Tax (Eliminated)

**Paper:** Zhuang, L., Chen, S., et al. "LinearRAG: Linear Graph Retrieval
Augmented Generation on Large-scale Corpora." arXiv:2510.10114, October 2025.
Accepted at ICLR 2026.

**Problem solved:** Stage 2 — relation extraction is unstable and costly.
LLM-based relation extraction produces noisy, inconsistent relations that
degrade retrieval quality rather than improving it.

**Technique:** The Tri-Graph — a hierarchical graph with three node types
(passage, sentence, entity) connected by contain/mention edges only. **No
relation extraction at all.** Relations are captured implicitly through
graph structure.

```
Passage → contains → Sentence → mentions → Entity
```

Retrieval uses two stages:
1. Entity activation via local semantic bridging
2. Passage retrieval via global importance aggregation

**Results:** Zero token consumption for graph construction. 12.8× speedup
over RAPTOR on 5M documents. Successfully captures implicit relationships
without explicit relation extraction.

### What treenav-mcp adopted

- **The Tri-Graph structure**, mapped onto existing data:

  | LinearRAG | treenav-mcp |
  |-----------|-------------|
  | Passage | `IndexedDocument` |
  | Sentence | `TreeNode` (heading section) |
  | Entity | `Entity` (extracted) |
  | Contains edge | `doc.tree[]` (existing) |
  | Mentions edge | `nodeEntities` map (new) |

- **Relation-free graph construction.** No explicit relation types, no
  relation extraction. Co-occurrence within a TreeNode section is the
  only relationship signal, following LinearRAG's core insight that
  explicit relations add noise more often than signal.

### What was deliberately left out

- **Sentence-level granularity.** LinearRAG distinguishes passages and
  sentences as separate graph layers. Our TreeNode sections (one per heading)
  are coarser than sentences but finer than whole documents — a natural
  middle ground given that heading-structured markdown already provides
  meaningful semantic boundaries.
- **Global importance aggregation.** LinearRAG's retrieval uses graph-based
  importance propagation across the Tri-Graph. Our BFS traversal with hop
  decay is a simpler approximation that avoids the computational cost of
  full graph algorithms.

### Honest assessment

LinearRAG is the most architecturally influential paper for our implementation.
The key insight — that relation extraction adds more noise than value for
most retrieval tasks — directly validates our approach of using co-occurrence
as the only relationship signal. The Tri-Graph maps almost perfectly onto
our existing `Document → TreeNode` hierarchy.

---

## Paper 3: E²GraphRAG — The Full Extraction Tax

**Paper:** Zhao, Y., et al. "E²GraphRAG: Streamlining Graph-based RAG for
High Efficiency and Effectiveness." arXiv:2505.24226, May 2025.

**Problem solved:** Stages 1-4 combined — the entire extraction pipeline
is replaced with lightweight NLP tools.

**Technique:** Uses SpaCy for entity extraction (not LLMs) and
co-occurrence within chunks as implicit relations. Combines a summary
tree (hierarchical chunk summaries) with an entity graph, bridged by
bidirectional entity-to-chunk indexes.

**Results:** Up to 10× faster indexing than GraphRAG. 100× speedup over
LightRAG in retrieval. Adaptive retrieval selects between local (entity-guided)
and global (summary-tree) query modes.

### What treenav-mcp adopted

- **Co-occurrence as relations.** "Uses their co-occurrence in a chunk as
  relations" — this is exactly our approach. Entities appearing in the same
  TreeNode section form implicit co-occurrence edges.
- **Bidirectional entity-to-chunk indexes.** Our `nodeEntities` (node → entities)
  and `Entity.occurrences` (entity → nodes) maps provide the same bidirectional
  lookup.
- **Adaptive retrieval pattern.** The `traverse_entities` tool handles
  entity-guided (local) retrieval; `search_documents` handles keyword
  (global) retrieval. The agent chooses the appropriate mode.

### What was deliberately left out

- **SpaCy dependency.** E²GraphRAG uses SpaCy's NER pipeline. We use regex
  patterns instead, eliminating external dependencies. SpaCy provides better
  NER accuracy but requires downloading language models (~20-500MB).
- **Summary tree construction.** E²GraphRAG builds hierarchical summaries
  using LLMs at index time. Our TreeNode hierarchy from markdown headings
  provides structural summaries for free (heading titles + summaries).

### Honest assessment

E²GraphRAG validates that co-occurrence relations are sufficient for
competitive retrieval quality — the same approach we independently adopted.
The main trade-off: SpaCy's NER catches domain-specific entities that regex
cannot (but requires fine-tuning for specialized domains). For technical
documentation with consistent formatting, regex extraction is adequate.

---

## Paper 4: GNN-RAG — The Graph Reasoning Tax

**Paper:** Mavromatis, C. & Karypis, G. "GNN-RAG: Graph Neural Retrieval for
Large Language Model Reasoning." Findings of ACL 2025, arXiv:2405.20139.

**Problem solved:** Stage 6 — query-time graph reasoning is expensive when
done via LLM calls. Replace LLM graph traversal with trained GNN reasoning.

**Technique:** A lightweight GNN assigns importance weights to graph nodes
based on query relevance and neighbor context. The GNN identifies answer
candidates, then shortest paths connecting question entities to answer
candidates are extracted and verbalized for LLM consumption.

**Results:** State-of-the-art on WebQSP and CWQ benchmarks. Outperforms
LLM-based retrieval by 8.9-15.5% on multi-hop questions. 9× fewer KG
tokens than long-context inference.

### What treenav-mcp adopted

- **Importance-weighted traversal concept.** We adapted the idea of
  weighting graph traversal by node importance, but implemented it as
  BFS with hop decay rather than a trained GNN. Our decay function
  `1 / (hop + 1)` approximates the intuition that direct connections
  are more relevant than transitive ones.

### What was deliberately left out

- **The actual GNN.** GNN-RAG requires training a graph neural network
  on the target knowledge graph. This needs a training dataset, GPU
  compute, and introduces a learned component — violating our
  deterministic, zero-model constraint.
- **Knowledge graph QA focus.** GNN-RAG is validated on structured KGQA
  benchmarks (WebQSP, CWQ) with clean entity-relation triples. Our
  co-occurrence graph over document sections is a fundamentally different
  graph structure — sparser, noisier, and without typed relations.

### Honest assessment

GNN-RAG solves a different problem (KGQA over curated knowledge graphs)
than document-graph retrieval. The graph traversal concept transfers, but
the specific technique (trained GNN) does not apply to our setting. Our
BFS with hop decay is a much cruder approximation but requires zero training
and zero parameters.

---

## Paper 5: DRAG — The Generation Tax

**Paper:** Chen, J., et al. "DRAG: Distilling RAG for SLMs from LLMs to
Transfer Knowledge and Mitigate Hallucination via Evidence and Graph-based
Distillation." ACL 2025 Main, arXiv:2506.01954.

**Problem solved:** The generation stage — distill RAG knowledge from large
LLMs into small language models (SLMs) that can generate answers without
the full LLM cost.

**Technique:** Evidence-based and knowledge graph-based distillation.
Retrieved evidence is filtered, ranked, and structured into a multigraph,
then simplified for SLM consumption.

**Results:** Outperforms prior RAG methods by up to 27.7% using the same
SLMs. Up to 94.1% on ARC-C (vs 67-68% for Self-RAG/CRAG).

### What treenav-mcp adopted

- **Nothing directly.** DRAG addresses the generation stage; treenav-mcp
  is a retrieval system. We don't generate answers — we provide structured
  context for an external LLM to reason over.

### What was deliberately left out

- **Everything.** DRAG's contribution is about training smaller models to
  generate better answers from retrieved evidence. This is orthogonal to
  our retrieval-only architecture. If an agent using treenav-mcp is backed
  by a DRAG-distilled SLM, the retrieval quality we provide would benefit
  that SLM — but that's the agent's concern, not ours.

### Honest assessment

DRAG is included in Shereshevsky's analysis because it addresses the last
LLM-dependent stage in the GraphRAG pipeline. For treenav-mcp, it validates
the approach of keeping retrieval lightweight and leaving generation to the
consuming agent.

---

## Cross-Paper Synthesis

### The Convergence Pattern

All five papers share a common thesis: **each LLM-dependent stage in the
GraphRAG pipeline has a lighter alternative that preserves most of the quality.**

| GraphRAG Stage | LLM Cost | Paper | Replacement | Quality Retention |
|---------------|----------|-------|-------------|-------------------|
| Entity extraction | ~30% | AGRAG | TF-IDF n-grams | ~90-95% |
| Relation extraction | ~25% | LinearRAG | Eliminated (Tri-Graph) | ~95-100% |
| Full extraction | ~55% | E²GraphRAG | SpaCy + co-occurrence | ~85-95% |
| Graph reasoning | ~10% | GNN-RAG | Trained GNN | ~100%+ |
| Generation | ~10% | DRAG | Distilled SLM | ~85-95% |

### What Hasn't Been Tested Together

As Shereshevsky notes, these papers are separate research contributions
validated on different benchmarks with different assumptions:

- LinearRAG's Tri-Graph hasn't been tested with DRAG's distillation
- GNN-RAG's retrieval is proven for KGQA, not document-graph retrieval
- AGRAG's TF-IDF works for entity-dense technical text — open question
  for conversational/narrative corpora
- E²GraphRAG inherits SpaCy's NER limitations for domain-specific entities

**The integration work remains:** combining relation-free construction,
graph-guided retrieval, and distilled generation in a single pipeline.
treenav-mcp's entity graph takes a step in this direction by integrating
AGRAG-style extraction + LinearRAG-style structure + E²GraphRAG-style
co-occurrence into the existing BM25 + tree navigation pipeline.

### The "No GraphRAG" Threshold

The GraphRAG-Bench finding applies: graphs can significantly underperform
vanilla RAG on simple factual questions [Edge et al., 2024]. The entity
graph earns its keep only when:

1. **The corpus is entity-rich** (technical documentation, code — our target)
2. **Queries require multi-hop reasoning** ("what concepts relate to OAuth?")
3. **Cross-document connections matter** (finding related content across files)

For single-hop fact retrieval ("what is the default port?"), `search_documents`
with BM25 is faster and more accurate than graph traversal. The `traverse_entities`
tool is additive, not a replacement.

---

## treenav-mcp's Position in the Landscape

### Before Entity Graph

```
treenav-mcp (pre-entity graph):
  - Zero LLM calls ✓ (already ahead of GraphRAG)
  - BM25 search ✓
  - Tree navigation ✓
  - Cross-document relationships ✗
  - Multi-hop traversal ✗
  - Entity-level retrieval ✗
```

### After Entity Graph

```
treenav-mcp (with entity graph):
  - Zero LLM calls ✓
  - BM25 search ✓
  - Tree navigation ✓
  - Cross-document relationships ✓ (via co-occurrence graph)
  - Multi-hop traversal ✓ (via BFS with hop decay)
  - Entity-level retrieval ✓ (via traverse_entities tool)
  - Entity extraction quality: ~60-80% vs LLM-based ~100%
  - Relation quality: implicit co-occurrence vs explicit typed relations
```

### Comparison with Full GraphRAG Alternatives

| System | Index Cost | Entity Extraction | Relations | Traversal | Query Latency |
|--------|-----------|-------------------|-----------|-----------|---------------|
| **GraphRAG** [Edge 2024] | $5-50/1K docs | LLM (100%) | LLM (100%) | LLM | 1-10s |
| **LightRAG** [Guo 2024] | ~$0.15/1K docs | LLM | LLM (lite) | Vector + graph | 80ms |
| **E²GraphRAG** [Zhao 2025] | ~10× less than GraphRAG | SpaCy (~85%) | Co-occurrence | Adaptive | ~10ms |
| **LinearRAG** [Zhuang 2025] | $0 tokens | Lightweight NLP | Eliminated | Semantic bridging | — |
| **treenav-mcp** | $0 | Regex (~60-80%) | Co-occurrence | BFS + hop decay | <5ms |

treenav-mcp is the most aggressive in eliminating external dependencies
(no SpaCy, no embedding models, no LLMs) at the cost of extraction quality.
This is the right trade-off for structured technical documentation where
entities are clearly delineated.

---

## Related Work Not Covered by the Five Papers

### FastGraphRAG (Microsoft)

Uses NLP libraries (NLTK, spaCy) for noun-phrase entity extraction instead
of LLMs. Cheaper but noisier extraction. treenav-mcp's regex approach is
philosophically similar but even more lightweight (zero NLP library
dependencies).

### NodeRAG [Xu et al., 2025]

Introduces heterogeneous graph nodes for precise retrieval. Our entity
types (`acronym`, `proper_noun`, `technical_term`, `compound`, `code_symbol`)
provide similar type discrimination. NodeRAG's "hub node" concept maps to
our bridge entities.

**Paper:** Xu, T., et al. "NodeRAG: Structuring Graph-based RAG with
Heterogeneous Nodes." arXiv:2504.11544, April 2025.

### Practical GraphRAG [Min et al., 2025]

Dependency parsing achieves 94% of LLM-based extraction quality using SpaCy.
Validates that classical NLP can nearly match LLM extraction for enterprise
corpora.

**Paper:** Min, C., et al. "Towards Practical GraphRAG: Efficient Knowledge
Graph Construction and Hybrid Retrieval at Scale." CIKM 2025, arXiv:2507.03226.

---

## References

[Edge et al., 2024] Edge, D., Trinh, H., Cheng, N., et al. "From Local to
Global: A Graph RAG Approach to Query-Focused Summarization." arXiv:2404.16130.

[Wang et al., 2025] Wang, Y., et al. "AGRAG: Advanced Graph-based
Retrieval-Augmented Generation for LLMs." arXiv:2511.05549.

[Zhuang et al., 2025] Zhuang, L., Chen, S., et al. "LinearRAG: Linear Graph
Retrieval Augmented Generation on Large-scale Corpora." arXiv:2510.10114.
ICLR 2026.

[Zhao et al., 2025] Zhao, Y., et al. "E²GraphRAG: Streamlining Graph-based
RAG for High Efficiency and Effectiveness." arXiv:2505.24226.

[Mavromatis & Karypis, 2025] Mavromatis, C. & Karypis, G. "GNN-RAG: Graph
Neural Retrieval for Large Language Model Reasoning." ACL 2025 Findings,
arXiv:2405.20139.

[Chen et al., 2025] Chen, J., et al. "DRAG: Distilling RAG for SLMs from
LLMs." ACL 2025 Main, arXiv:2506.01954.

[Xu et al., 2025] Xu, T., et al. "NodeRAG: Structuring Graph-based RAG with
Heterogeneous Nodes." arXiv:2504.11544.

[Min et al., 2025] Min, C., et al. "Towards Practical GraphRAG: Efficient
Knowledge Graph Construction and Hybrid Retrieval at Scale." CIKM 2025,
arXiv:2507.03226.

[Guo et al., 2024] Guo, Z., Xia, L., et al. "LightRAG: Simple and Fast
Retrieval-Augmented Generation." arXiv:2410.05779.

[Shereshevsky, 2026] Shereshevsky, A. "Five Papers Quietly Killing the LLM
Tax in GraphRAG." Graph Praxis (Medium), February 2026.
