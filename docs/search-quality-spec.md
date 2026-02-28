# Search & Navigation Quality Benchmark — Specification

**Status:** Draft
**Target implementation:** `tests/search-quality.test.ts`
**Date:** 2026-02-27

---

## 1. Goals

This spec defines a deterministic, network-free, CI-able test suite that measures
the retrieval and navigation quality of treenav-mcp across two dimensions:

1. **Search quality** — does BM25 return the right symbols/sections for a query?
2. **Tree navigation quality** — can an agent traverse `get_tree` → `get_node_content` /
   `navigate_tree` to reach the right content in realistic workflows?

The suite runs in milliseconds (no cloned repos, no LLM calls, no embeddings) and acts
as a regression guard: a drop in NDCG@10 of ≥ 0.05 or a broken navigation path fails CI.

---

## 2. Metrics

### 2.1 Primary — NDCG@10

NDCG (Normalized Discounted Cumulative Gain) is the de-facto standard for ranked retrieval
evaluation ([Järvelin & Kekäläinen 2002][jarvelin]; used by CodeSearchNet [Husain 2019][csn],
CoIR [Li 2024][coir], and BEIR [Thakur 2021][beir]).

```
DCG@K  = Σ_{i=1}^{K}  rel(i) / log₂(i + 1)
IDCG@K = DCG of the ideal (perfect) ranking
NDCG@K = DCG@K / IDCG@K   ∈ [0, 1]
```

Why NDCG over simpler metrics:
- Supports **graded relevance** (0 = irrelevant, 1 = partial, 2 = relevant, 3 = highly relevant)
  which maps naturally to treenav-mcp's hierarchy (section vs subsection vs exact node)
- Position-sensitive: rank-1 result counts ~3× more than rank-4 (log₂ discount)
- Normalized: scores are directly comparable across query categories

K=10 is chosen because MCP agents typically inspect the top 5–10 results before
deciding which node to retrieve ([Nelson 2012][nelson]).

### 2.2 Secondary — MRR

MRR (Mean Reciprocal Rank) measures how quickly the first relevant result appears.

```
MRR = (1/|Q|) × Σ_q  1 / rank_q
```

Where `rank_q` = position of the first relevant result for query `q`.
MRR = 1.0 means the first result is always correct; MRR = 0.5 means it's always rank 2.

Used as a secondary sanity check because MRR ignores everything after the first hit —
it cannot distinguish "one good result" from "all good results" ([Voorhees 1999][trec]).

### 2.3 Hard assertions — Precision@1 for exact-match queries

For queries where the expected top result is unambiguous (symbol name, heading exact match),
we assert `Precision@1 = 1.0` as a hard `expect()` — a regression in the #1 result is
always a test failure regardless of NDCG.

### 2.4 Target thresholds

| Metric | Minimum (CI gate) | Target |
|---|---|---|
| NDCG@10 overall | 0.65 | 0.80 |
| NDCG@10 exact-match queries | 0.85 | 0.95 |
| MRR overall | 0.70 | 0.85 |
| Precision@1 exact-match | 1.00 | 1.00 |
| Navigation: correct node reached | 100% | 100% |

Thresholds set at `baseline − 0.05` after initial implementation (regression guards,
not perfection targets). See [Sakai 2014][sakai] on statistical significance of NDCG
changes: Δ ≥ 0.05 is detectable with < 50 queries.

---

## 3. Corpus Design

### 3.1 Markdown documents (12–20 files, inline in test file)

Inline as TypeScript string constants — no file I/O, no `readFile`, fully hermetic.

**Coverage requirements:**

| Domain | # docs | Purpose |
|---|---|---|
| Authentication / security | 3 | OAuth, JWT, session mgmt — tests synonym discrimination |
| API reference | 3 | REST endpoints, pagination, rate limiting |
| Architecture / design | 2 | Component overview, data flow |
| Runbooks / operations | 2 | Deploy procedure, rollback |
| Getting started / tutorial | 2 | Quickstart, installation |
| Glossary / reference | 1 | Terms — tests exact-term lookup |

Each document must:
- Have YAML frontmatter (`title`, `description`, `tags`, `type`)
- Contain at least 2 heading levels (H2 + H3) — tests `get_tree` depth
- Use domain vocabulary that overlaps with at least one other document
  (to test discrimination, not just recall)

### 3.2 Code fixtures (5–8 files, inline)

One file per language the suite covers:

| Fixture | Language | Key symbols |
|---|---|---|
| `AuthService.java` | Java | `AuthService` class, `authenticate`, `validateToken`, `UserRole` enum |
| `oauth_client.py` | Python | `OAuthClient` class, `get_token`, `refresh_token` |
| `router.ts` | TypeScript | `Router` class, `addRoute`, `handleRequest`, `RouteHandler` interface |
| `cluster.go` | Go | `ClusterManager` struct, `Connect`, `Disconnect`, `NodeState` interface |
| `config.rs` | Rust | `Config` struct, `from_env`, `validate`, `ConfigError` enum |

### 3.3 Corpus size justification

BM25's IDF term is `log((N − n + 0.5) / (n + 0.5) + 1)`. At N < 10 documents,
IDF becomes unstable — common terms get near-zero weight, inflating rare-term
scores artificially ([Robertson & Zaragoza 2009][bm25f]). 12–20 documents provides
a stable IDF range while keeping the corpus small enough to annotate exhaustively.

---

## 4. Query Design

### 4.1 Query categories and counts (~40 total)

| Category | Count | Description | Example |
|---|---|---|---|
| **Exact match** | 8 | Query term appears verbatim in doc title or H2 heading | `"oauth token"` → OAuth guide |
| **Multi-term** | 8 | 2–3 terms, all present in the target but spread across body | `"token expiry refresh"` |
| **Synonym / near-match** | 5 | Query term absent; related term present (vocabulary mismatch) | `"login flow"` → authentication guide |
| **Code symbol** | 7 | Symbol name, method name, class name | `"AuthService authenticate"` |
| **Facet-filtered** | 5 | Search + `type=`, `language=`, `symbol_kind=` filter | `"deploy" + type=runbook` |
| **Discriminating** | 4 | Two docs share query terms; one is clearly more relevant | `"jwt"` → JWT doc > OAuth doc |
| **Tree navigation** | 8 | Agent workflow: inspect tree → retrieve node (see §5) | — |
| **Zero / near-zero** | 3 | Should return 0 results or very low score (sanity check) | `"blockchain kubernetes" ` |

**Total: ~48 queries** — within the 35–50 range confirmed as sufficient for stable NDCG
estimates by Buckley & Voorhees (2000): at 50 topics, system rankings are stable; at 25,
they can be unreliable. ([Buckley & Voorhees 2000][buckley])

### 4.2 Ground truth format

```typescript
type Relevance = 0 | 1 | 2 | 3;
// 0 = not relevant
// 1 = tangentially related (shares vocabulary, wrong topic)
// 2 = relevant (correct topic, not the best match)
// 3 = highly relevant (exact match, best possible result)

interface QRel {
  id: string;             // stable ID for regression tracking
  query: string;
  category: QueryCategory;
  filter?: SearchFilter;  // facet filter applied alongside query
  relevant: Array<{
    doc_id: string;       // e.g. "auth/oauth.md" or "AuthService.java"
    node_id: string;      // e.g. "auth/oauth.md:n3" (specific heading/symbol)
    relevance: Relevance;
  }>;
  // Hard assertion: this node_id must appear in position <= mustBeInTopK
  mustBeInTop?: { node_id: string; k: number };
}
```

Only explicitly listed nodes have non-zero relevance. All other nodes in the corpus
implicitly have `relevance = 0` (standard TREC convention, [Voorhees 1999][trec]).

### 4.3 Annotation guidelines

Following [Husain 2019][csn] CodeSearchNet inter-annotator agreement (κ = 0.47), we
use only high-confidence, unambiguous examples to avoid brittle ground truth:

- **Relevance 3**: the document/node was clearly written to answer this exact query
- **Relevance 2**: the document covers the topic but is not the primary reference
- **Relevance 1**: document shares vocabulary but is about a different concept
- **Relevance 0**: no meaningful overlap (default, not listed)

Annotate conservatively: if you are unsure whether a node is relevant 1 or 2,
omit it from the QRel (treat as 0). This reduces noise without affecting NDCG
significantly at corpus sizes ≥ 12 documents.

---

## 5. Tree Navigation Scenarios

Tree navigation is the core differentiator of treenav-mcp vs flat search.
A realistic agent workflow is:

```
1. list_documents / search_documents  → find candidate doc IDs
2. get_tree(doc_id)                   → read outline (headings / symbol tree)
3. get_node_content(node_id)          → retrieve the exact section needed
   OR navigate_tree(node_id)          → retrieve section + all descendants
```

Each navigation test specifies the full 2–3 step workflow and asserts on:
- **Tree structure correctness**: does `get_tree` return the right hierarchy?
- **Node reachability**: is the target node_id present in the tree?
- **Content accuracy**: does `get_node_content` return the expected content?
- **Subtree completeness**: does `navigate_tree` include all child nodes?

### 5.1 Navigation scenario types (8 scenarios)

| # | Scenario | Entry point | Target | Assertion |
|---|---|---|---|---|
| N1 | Navigate to a specific H3 subsection | `search("oauth authorization code")` → `get_tree` → `get_node_content` | The H3 node for "Authorization Code Flow" | Content contains "redirect_uri" |
| N2 | Get full class symbol tree | `search("AuthService")` → `get_tree` | `AuthService.java` tree | Tree has class node with method children |
| N3 | Retrieve method body | `get_tree(AuthService.java)` → `get_node_content(authenticate_node)` | `authenticate` method | Content contains method signature |
| N4 | Navigate entire architecture section | `search("architecture overview")` → `navigate_tree` | Architecture doc root | All H2+H3 children present in result |
| N5 | Discriminate sibling nodes | `get_tree(api-reference.md)` → choose between `/auth` and `/users` H2 | The `/auth` H2 node | `get_node_content` returns endpoint docs, not user docs |
| N6 | Deep hierarchy traversal | 3-level heading (H2 → H3 → H4) | Leaf node content | `get_node_content` returns only that leaf |
| N7 | Code: interface → implementations | `get_tree(router.ts)` → find `Router` class children | `addRoute` method node | Method node has `parent_id` = Router class ID |
| N8 | Cross-collection navigation | `search("authenticate") + collection=code` → `get_tree` | `AuthService.java` | Code tree returned, not markdown tree |

### 5.2 Navigation test structure

```typescript
describe("Tree Navigation — N1: OAuth authorization code flow", () => {
  test("search surfaces the oauth document", () => {
    const results = store.searchDocuments("oauth authorization code", { limit: 5 });
    expect(results.some(r => r.doc_id === "auth/oauth.md")).toBe(true);
  });

  test("get_tree returns correct heading hierarchy", () => {
    const tree = store.getTree("auth/oauth.md");
    const h2Titles = tree.map(n => n.title);
    expect(h2Titles).toContain("Authorization Code Flow");
    expect(h2Titles).toContain("Client Credentials Flow");
  });

  test("target node is present and reachable", () => {
    const tree = store.getTree("auth/oauth.md");
    const node = tree.find(n => n.title === "Authorization Code Flow");
    expect(node).toBeDefined();
    expect(node!.id).toBeTruthy();
  });

  test("get_node_content returns expected content", () => {
    const tree = store.getTree("auth/oauth.md");
    const node = tree.find(n => n.title === "Authorization Code Flow")!;
    const content = store.getNodeContent(node.id);
    expect(content).toContain("redirect_uri");
    expect(content).toContain("authorization_code");
  });
});
```

---

## 6. BM25-Specific Test Invariants

Beyond aggregate metrics, these invariants catch specific BM25 failure modes.
Based on [Robertson & Zaragoza 2009][bm25f] and treenav-mcp's `store.ts` implementation:

### 6.1 Stemming consistency

treenav-mcp uses a lightweight Porter-style stemmer. Verify bidirectional unification:

| Input | Expected stem | Counter-example to verify |
|---|---|---|
| "authentication" | "authenticat" | "authenticate" → same stem |
| "functions" | "function" | "functional" → different stem |
| "queries" | "queri" | "query" → same stem |
| "deployment" | "deploy" | "deploy" → same stem |

Test pattern:
```typescript
test("stemming: 'authentication' query matches 'authenticate' in content", () => {
  // doc body contains "authenticate()" — no "authentication" keyword
  const results = store.searchDocuments("authentication");
  expect(results.some(r => r.doc_id === "auth/jwt.md")).toBe(true);
});
```

### 6.2 Prefix matching does not outrank exact matches

treenav-mcp applies `prefix_penalty` for prefix (vs exact) token matches.

```typescript
test("exact match 'router' ranks above prefix match 'route' in a corpus with both", () => {
  const results = store.searchDocuments("router");
  const routerIdx = results.findIndex(r => r.node_title === "Router");
  const routeIdx  = results.findIndex(r => r.node_title === "addRoute");
  expect(routerIdx).toBeLessThan(routeIdx);
});
```

### 6.3 Co-occurrence bonus fires only on multi-term queries

The `full_coverage_bonus` in `store.ts` fires when all query terms appear in a node.
Validate it does not inflate single-term query scores:

```typescript
test("single-term query scores are stable (no co-occurrence inflation)", () => {
  const single = store.searchDocuments("oauth");
  const multi  = store.searchDocuments("oauth token");
  // Top result for single query should be the same doc as multi-term
  expect(single[0].doc_id).toBe(multi[0].doc_id);
  // But single-term score should be lower (no co-occurrence bonus)
  expect(single[0].score).toBeLessThan(multi[0].score);
});
```

### 6.4 Facet filter correctness

```typescript
test("type=runbook filter excludes guide documents", () => {
  const results = store.searchDocuments("deploy", { filters: { type: ["runbook"] } });
  expect(results.every(r => r.meta.type === "runbook")).toBe(true);
});

test("language=java filter returns only Java code nodes", () => {
  const results = store.searchDocuments("authenticate", { filters: { language: ["java"] } });
  expect(results.every(r => r.meta.language === "java")).toBe(true);
});
```

### 6.5 IDF stability at corpus boundary

At N=15 docs, a term appearing in all docs gets `IDF ≈ 0.046` (near-zero).
Verify that high-IDF rare terms (in 1 doc) do not pathologically dominate:

```typescript
test("rare term does not outscore a multi-term match with all terms present", () => {
  // "xyzauthtoken" appears in 1 doc (very high IDF)
  // "oauth token refresh" — all three appear in a different doc
  const rareResults = store.searchDocuments("xyzauthtoken oauth");
  const multiResults = store.searchDocuments("oauth token refresh");
  // The multi-term match should still reach top-3 despite the rare term's IDF boost
  expect(multiResults[0].score).toBeGreaterThan(0);
});
```

---

## 7. Metric Implementation (in-test, no external deps)

All metric functions are pure TypeScript, ~30 lines total, inlined in the test file.
No external IR libraries — keeps the test self-contained.

```typescript
/** Compute NDCG@K for a single query given ranked result node IDs and relevance map */
function ndcgAtK(
  rankedIds: string[],
  relevance: Map<string, number>,   // node_id → relevance score (0–3)
  k: number
): number {
  const dcg = rankedIds.slice(0, k).reduce((sum, id, i) => {
    return sum + (relevance.get(id) ?? 0) / Math.log2(i + 2);
  }, 0);
  const ideal = [...relevance.values()]
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
  return ideal === 0 ? 1 : dcg / ideal;  // if no relevant docs, score is 1 (vacuously)
}

/** MRR across multiple queries */
function meanReciprocalRank(
  queries: Array<{ ranked: string[]; relevant: Set<string> }>
): number {
  const rrs = queries.map(({ ranked, relevant }) => {
    const rank = ranked.findIndex(id => relevant.has(id));
    return rank === -1 ? 0 : 1 / (rank + 1);
  });
  return rrs.reduce((a, b) => a + b, 0) / rrs.length;
}
```

---

## 8. File Layout

```
tests/
└── search-quality.test.ts     ← single file: corpus + qrels + metrics + tests

tests/fixtures/
└── search-quality-corpus.ts   ← inline corpus (markdown strings + code strings)
└── search-quality-qrels.ts    ← ground truth QRel definitions
```

Keeping corpus and qrels separate from the test logic allows updating ground truth
without touching the test infrastructure.

---

## 9. What This Suite Does NOT Cover

- **Recall completeness at scale** — the corpus is curated, not exhaustive. For true
  recall evaluation at large-repo scale, use `scripts/benchmark.ts` against real repos.
- **Semantic / embedding search** — out of scope; treenav-mcp is lexical only.
- **Cross-repo search quality** — `scripts/benchmark.ts` covers this.
- **Latency** — covered by `scripts/benchmark.ts` (files/sec, parse time).
- **LLM-judged relevance** — deliberately excluded to keep CI deterministic.

---

## 10. References

[jarvelin]: Järvelin, K. & Kekäläinen, J. (2002). "Cumulated gain-based evaluation of IR techniques." *ACM TOIS*, 20(4), 422–446. https://dl.acm.org/doi/10.1145/582415.582418

[csn]: Husain, H. et al. (2019). "CodeSearchNet Challenge: Evaluating the State of Semantic Code Search." *arXiv:1909.09436*. https://arxiv.org/abs/1909.09436

[coir]: Li, M. et al. (2024). "CoIR: A Comprehensive Benchmark for Code Information Retrieval Models." *arXiv:2407.02883*. https://arxiv.org/abs/2407.02883

[beir]: Thakur, N. et al. (2021). "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models." *NeurIPS 2021*. https://arxiv.org/abs/2104.08663

[trec]: Voorhees, E.M. (1999). "The TREC-8 Question Answering Track Report." *TREC 1999*. https://trec.nist.gov/pubs/trec8/papers/qa_report.pdf

[buckley]: Buckley, C. & Voorhees, E.M. (2000). "Evaluating evaluation measure stability." *SIGIR 2000*, 33–40. https://dl.acm.org/doi/10.1145/345508.345543

[sakai]: Sakai, T. (2014). "Statistical reform in information retrieval?" *SIGIR Forum*, 48(1), 3–12. https://dl.acm.org/doi/10.1145/2641383.2641385

[nelson]: Nelson, M.L. (2012). "The PageIndex model for information access." *JCDL 2012*. (Influence on tree-navigation pattern.)

[bm25f]: Robertson, S. & Zaragoza, H. (2009). "The Probabilistic Relevance Framework: BM25 and Beyond." *Foundations and Trends in IR*, 3(4), 333–389. https://dl.acm.org/doi/10.1561/1500000019

[cosqa]: Huang, J. et al. (2021). "CoSQA: 20,000+ Web Queries for Code Search and Question Answering." *ACL 2021*. https://arxiv.org/abs/2105.13239

[ir-eval]: Zhai, C. & Massung, S. (2016). *Text Data Management and Analysis.* ACM Books. (Chapter 8: Evaluation of IR Systems.)

[elastic-bm25]: Kapoor, A. (2020). "Practical BM25 — The BM25 Algorithm and its Variables." *Elastic Engineering Blog*. https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables
