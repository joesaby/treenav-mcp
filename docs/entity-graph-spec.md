# Entity Graph — Feature Specification

**Status:** Specified (implementation on separate branch)
**Module:** `src/entity-graph.ts`
**MCP Tool:** `traverse_entities` (Tool #7)
**Date:** 2026-03-08

---

## 1. Problem

treenav-mcp's BM25 search and tree navigation operate within single documents.
Each document is an island — no cross-document relationships, no entity linking,
no multi-hop traversal. When an agent searches for "OAuth," it finds sections
*mentioning* OAuth but cannot answer "what concepts are related to OAuth across
the entire corpus?" without searching for each related term individually.

This is the same gap that GraphRAG addresses — but standard GraphRAG solves it
with 6+ LLM calls per text chunk during indexing, consuming 75% of the token
budget before a single question is asked [Edge et al., 2024][graphrag-paper].

## 2. Goal

Add cross-document entity relationships and multi-hop traversal to treenav-mcp
while maintaining the project's core constraints:

- **Zero LLM calls** at index time
- **Zero embeddings** or external models
- **Deterministic** extraction and retrieval
- **Incremental** updates (per-document add/remove)
- **In-memory** with sub-millisecond query latency

## 3. Approach

The entity graph is an **overlay** on the existing tree structure. It does not
replace BM25 search — it adds a new retrieval dimension for relationship-based
queries.

### 3.1 Three-Phase Architecture

```
Phase 1: Entity Extraction (AGRAG-inspired)
  For each TreeNode → regex-based NLP extraction → Entity objects
  Entity types: acronym, proper_noun, technical_term, compound, code_symbol

Phase 2: TF-IDF Scoring (AGRAG-inspired)
  For each Entity → compute TF-IDF relevance score
  Formula: TF × IDF where IDF = log((N - df + 0.5) / (df + 0.5) + 1)
  Higher score = more distinctive entity (appears in fewer documents)

Phase 3: Co-Occurrence Graph (E²GraphRAG / LightRAG-inspired)
  For each TreeNode → entities in same node form co-occurrence edges
  Relation weight = number of nodes where both entities appear together
```

### 3.2 Data Model

```
                    ┌──────────────────────────────┐
                    │         EntityGraph           │
                    │                               │
                    │  entities: Map<name, Entity>  │
                    │  relations: Map<key, Relation>│
                    │  nodeEntities: Map<nodeKey,   │
                    │                Set<names>>    │
                    │  docEntities: Map<docId,      │
                    │               Set<names>>     │
                    └──────┬───────────┬────────────┘
                           │           │
              ┌────────────▼──┐    ┌───▼──────────────────┐
              │    Entity     │    │   EntityRelation      │
              │               │    │                       │
              │  name         │    │  source, target       │
              │  display_name │    │  weight (co-occur ct) │
              │  kind         │    │  shared_nodes         │
              │  occurrences  │    └───────────────────────┘
              │  doc_ids      │
              │  frequency    │
              │  tfidf_score  │
              └───────────────┘
```

### 3.3 Mapping to Existing Architecture

This follows LinearRAG's Tri-Graph model [Zhuang et al., 2025], mapped onto
treenav-mcp's existing hierarchy:

| LinearRAG Tri-Graph | treenav-mcp Mapping |
|---------------------|---------------------|
| Passage node | `IndexedDocument` (doc_id) |
| Sentence node | `TreeNode` (node_id) |
| Entity node | `Entity` (name) |
| Contain edge | doc → node (existing `tree[]`) |
| Mention edge | node → entity (`nodeEntities` map) |

No relation extraction is performed. Relations are implicit via co-occurrence
(E²GraphRAG approach): if Entity A and Entity B both appear in the same
TreeNode section, they share an implicit relationship with weight proportional
to the number of shared sections.

## 4. Entity Extraction

### 4.1 Extraction Patterns

Five regex-based extractors run in sequence, inspired by AGRAG's TF-IDF
n-gram extraction and FastGraphRAG's NLP-based noun phrase mining:

| Pattern | Regex | Entity Kind | Examples |
|---------|-------|-------------|----------|
| Acronyms | `\b[A-Z][A-Z0-9]{1,10}\b` | `acronym` | API, JWT, TLS, BM25 |
| Proper nouns | `\b[A-Z][a-zA-Z0-9]{2,}\b` (not all-caps) | `proper_noun` | OAuth, Kubernetes, TypeScript |
| Technical terms | CamelCase, snake_case, dot.notation | `technical_term` | contentHash, node_stats, bun.markdown |
| Backtick terms | `` `term` `` | `compound` or `technical_term` | `knowledge graph`, `contentHash` |
| Compound nouns | Known prefix + known suffix patterns | `compound` | knowledge graph, access token, search engine |

For code-indexed documents (facet `content_type: code`), an additional extractor
finds symbol declarations (`class`, `interface`, `function`, `def`, `struct`,
`trait`, `impl`) and PascalCase identifiers.

### 4.2 Filtering

Two stop lists prevent noise:

- **STOP_ENTITIES** (~60 entries): Common short words and code keywords
  (`the`, `and`, `true`, `false`, `return`, `import`)
- **COMMON_WORDS** (~70 entries): Words frequently capitalized at sentence
  start but not entities (`The`, `This`, `However`, `Example`)

### 4.3 Pruning

After extraction, entities with frequency = 1 and zero co-occurrence relations
are removed. This eliminates one-off mentions that add noise without providing
relationship value.

## 5. TF-IDF Scoring

Each entity receives a TF-IDF relevance score (AGRAG-inspired):

```
TF = entity.frequency / total_entity_occurrences
IDF = log((N - df + 0.5) / (df + 0.5) + 1)     // BM25-style IDF
score = TF × IDF
```

Where `N` = total documents, `df` = documents containing the entity.

This uses the same IDF formulation as BM25 (with the `+1` floor ensuring
non-zero scores for high-frequency entities), providing consistency with
the existing search engine's scoring approach.

**Interpretation:** High TF-IDF = distinctive entity (appears often but in
few documents). Low TF-IDF = ubiquitous entity (appears everywhere, less
discriminative). This mirrors AGRAG's entity relevance score which filters
entities by TF-IDF threshold.

## 6. Co-Occurrence Graph

### 6.1 Construction

For each TreeNode section containing entities `[A, B, C]`, create pairwise
co-occurrence relations: `(A,B)`, `(A,C)`, `(B,C)`. Each relation stores:

- **weight**: Number of distinct nodes where both entities co-occur
- **shared_nodes**: Set of node keys where both appear

This follows E²GraphRAG's approach: "uses their co-occurrence in a chunk as
relations" [Zhao et al., 2025], eliminating the need for LLM-based relation
extraction entirely.

### 6.2 Properties

- **Symmetric**: Relation `(A,B)` = Relation `(B,A)`, stored once with sorted key
- **Weighted**: More co-occurrences = stronger relationship
- **Incremental**: Relations update when documents are added/removed
- **No explicit relation types**: All relations are "co-occurs with" — the
  semantic interpretation is left to the agent at query time

## 7. Multi-Hop Traversal

### 7.1 Algorithm

Traversal uses importance-weighted BFS (inspired by GNN-RAG's graph neural
retrieval approach, adapted without requiring a trained GNN):

```
traverse(entity_name, max_hops=2, limit=15):
  1. Find entity by exact match or prefix match
  2. BFS from entity through co-occurrence edges:
     - Hop 1: Direct co-occurring entities (full weight)
     - Hop 2: Entities co-occurring with hop-1 entities (weight × 0.5)
     - Hop 3: Third-degree connections (weight × 0.33)
  3. Deduplicate, sort by decayed weight
  4. Return EntityGraphResult with related entities, documents, and nodes
```

### 7.2 Hop Decay

Relationship weight decays by `1 / (hop + 1)` at each hop, ensuring direct
co-occurrences are always ranked higher than transitive connections. This
prevents distant, weakly-related entities from dominating results.

## 8. Bridge Entities

Bridge entities span multiple documents — the "hub nodes" in NodeRAG's
heterogeneous graph terminology [Xu et al., 2025]. They are the concepts
that connect different parts of the knowledge base.

Identification: any entity with `doc_ids.size >= 2`.

Sorting: `doc_spread × frequency` (entities appearing in more documents
AND more frequently rank higher).

**Use case:** An agent can call `getBridgeEntities()` to discover the
concepts that link different areas of a documentation corpus, then use
`traverse_entities` to explore the connections.

## 9. MCP Tool Interface

### `traverse_entities`

```
Parameters:
  query: string     — Entity name to look up
  max_hops: 1-3     — Traversal depth (default: 2)
  limit: 1-30       — Max related entities (default: 15)

Returns:
  Entity: display_name (kind)
  Frequency: N occurrences across M documents
  Related entities (K-hop traversal):
    1. RelatedEntity (weight: X.X, in Y docs)
    ...
  Appears in documents:
    • doc_id_1
    ...
  Top sections:
    • [doc_id] Doc Title → Section Title (node_id)
    ...

Fallback (entity not found):
  Searches for similar entity names and suggests alternatives.
```

### Agent Workflow Integration

```
Step 1 — search_documents("OAuth")     → find documents mentioning OAuth
Step 2 — traverse_entities("OAuth")    → find related concepts (JWT, TLS, API)
Step 3 — traverse_entities("JWT")      → follow the graph to JWT's connections
Step 4 — get_node_content(doc_id, [node_id])  → read specific sections
```

The entity graph adds Step 2-3 as a new retrieval dimension. The agent can
now follow conceptual relationships across documents without explicit search
queries for each term.

## 10. Integration with DocumentStore

The entity graph is integrated into the DocumentStore lifecycle:

| Operation | BM25 Index | Filter Index | Entity Graph |
|-----------|-----------|-------------|-------------|
| `load()` | `buildIndex()` | `buildFilterIndex()` | `entityGraph.build()` |
| `addDocument()` | `indexDocument()` | `indexDocumentFilters()` | `entityGraph.addDocument()` |
| `removeDocument()` | `removeDocumentPostings()` | `removeDocumentFilters()` | `entityGraph.removeDocument()` |

The `getStats()` method now includes entity graph metrics:
`entity_count`, `relation_count`, `bridge_entity_count`.

## 11. Performance Characteristics

| Metric | Value |
|--------|-------|
| Extraction time (per doc) | <1ms (regex-based) |
| Graph build (1000 docs) | ~50-200ms |
| Entity lookup | O(1) exact, O(n) prefix |
| 1-hop traversal | O(R) where R = relations for entity |
| 2-hop traversal | O(R × R_avg) |
| Memory overhead | ~2-5% of base index size |

### Comparison with LLM-based GraphRAG

| Aspect | Standard GraphRAG | treenav-mcp Entity Graph |
|--------|------------------|--------------------------|
| Entity extraction | LLM call per chunk | Regex patterns (0 tokens) |
| Relation extraction | LLM call per chunk | Co-occurrence (0 tokens) |
| Community detection | Leiden + LLM summaries | Not needed (flat graph) |
| Index cost (1000 docs) | ~$5-50 (API tokens) | $0 (zero LLM calls) |
| Extraction quality | ~100% (reference) | ~60-80% (estimated) |
| Incremental updates | Full re-extraction | Per-document O(1) |

## 12. Limitations

1. **Regex extraction quality**: Cannot match LLM-based NER for ambiguous or
   domain-specific entities. Technical documentation (our target) is the best
   case for regex extraction; narrative content is worse. This aligns with
   the AGRAG paper's finding that TF-IDF works well for "entity-dense
   technical text" [Wang et al., 2025].

2. **No relation types**: All relationships are untyped co-occurrence. The
   agent cannot ask "what does OAuth *authenticate*?" — only "what co-occurs
   with OAuth?" This is the trade-off for eliminating LLM-based relation
   extraction (LinearRAG's key insight).

3. **Co-occurrence noise**: Entities in long sections may form spurious
   relations. A 500-word section mentioning both "OAuth" and "database
   migration" will create a relation between them even if unrelated.

4. **Single-hop factual queries**: As the GraphRAG-Bench finding notes
   [Edge et al., 2024], graphs can underperform vanilla RAG on simple
   factual questions. The entity graph is most valuable for multi-hop
   reasoning over entity-rich corpora — not for replacing `search_documents`.

5. **No synonym collapsing**: Unlike AGRAG (which links synonyms via embedding
   similarity), we don't merge "K8s" and "Kubernetes" as the same entity.
   The glossary system partially addresses this for known abbreviations.

## 13. Future Work

- **Glossary-informed entity merging**: Use the existing glossary to merge
  entity variants (e.g., "K8s" + "Kubernetes" → single entity). The
  incremental auto-glossary (now implemented) already extracts acronym
  definitions per-document — these can feed directly into entity merging
  when the entity graph lands.
- **Section-scoped relation weights**: Weight relations inversely by section
  length to reduce co-occurrence noise in long sections
- **Entity type facets**: Expose entity kinds as filter facets for the
  existing `search_documents` tool
- **Graph-boosted BM25**: Use entity relationships to boost search scores
  for documents sharing entities with high-scoring results (hybrid retrieval)
- **Auto-glossary → entity graph bridge**: The per-document auto-glossary
  (`autoGlossaryByDoc`) tracks acronym definitions incrementally. When the
  entity graph is integrated, acronym entities can be auto-merged with their
  expansions using this data — no separate synonym extraction needed.

---

## References

[graphrag-paper]: Edge, D., Trinh, H., Cheng, N., et al. "From Local to Global: A Graph RAG Approach to Query-Focused Summarization." arXiv:2404.16130, April 2024.

[agrag]: Wang, Y., et al. "AGRAG: Advanced Graph-based Retrieval-Augmented Generation for LLMs." arXiv:2511.05549, November 2025.

[linearrag]: Zhuang, L., Chen, S., et al. "LinearRAG: Linear Graph Retrieval Augmented Generation on Large-scale Corpora." arXiv:2510.10114, October 2025. Accepted at ICLR 2026.

[e2graphrag]: Zhao, Y., et al. "E²GraphRAG: Streamlining Graph-based RAG for High Efficiency and Effectiveness." arXiv:2505.24226, May 2025.

[gnn-rag]: Mavromatis, C. & Karypis, G. "GNN-RAG: Graph Neural Retrieval for Large Language Model Reasoning." ACL 2025 Findings, arXiv:2405.20139.

[drag]: Chen, J., et al. "DRAG: Distilling RAG for SLMs from LLMs to Transfer Knowledge and Mitigate Hallucination." ACL 2025 Main, arXiv:2506.01954.

[noderag]: Xu, T., et al. "NodeRAG: Structuring Graph-based RAG with Heterogeneous Nodes." arXiv:2504.11544, April 2025.

[practical-graphrag]: Min, C., et al. "Towards Practical GraphRAG: Efficient Knowledge Graph Construction and Hybrid Retrieval at Scale." CIKM 2025, arXiv:2507.03226.

[lightrag]: Guo, Z., Xia, L., et al. "LightRAG: Simple and Fast Retrieval-Augmented Generation." arXiv:2410.05779, October 2024.
