/**
 * Ground truth relevance judgements for search quality tests.
 *
 * QRels reference documents and nodes by title fragments so they remain
 * stable across doc_id format changes. The test resolves them to actual
 * node_ids at runtime using store.getTree().
 *
 * Relevance scale (following CodeSearchNet / TREC convention):
 *   3 = highly relevant  — the document was written to answer this exact query
 *   2 = relevant         — covers the topic but not the primary reference
 *   1 = tangential       — shares vocabulary; different concept
 *   0 = not relevant     — default (not listed)
 *
 * References:
 *   Husain et al. 2019 — CodeSearchNet Challenge (arXiv:1909.09436)
 *   Voorhees 1999 — TREC-8 QA Track (trec.nist.gov)
 */

export type Relevance = 0 | 1 | 2 | 3;

export type QueryCategory =
  | "exact"
  | "multi-term"
  | "synonym"
  | "code-symbol"
  | "facet-filtered"
  | "discriminating"
  | "zero-result";

export interface RawQRel {
  id: string;
  query: string;
  category: QueryCategory;
  /** Facet filters applied alongside the query (mirrors store.searchDocuments options.filters) */
  filter?: Record<string, string[]>;
  relevant: Array<{
    /** Fragment of DocumentMeta.title — case-insensitive substring match */
    docTitle: string;
    /** Fragment of TreeNode.title — if absent, use the first (root) node of the doc */
    nodeTitle?: string;
    relevance: Relevance;
  }>;
  /** Hard assertion: this node must appear within the top k results */
  mustBeInTop?: { docTitle: string; nodeTitle?: string; k: number };
}

export const QRELS: RawQRel[] = [
  // ── Exact match (8) ────────────────────────────────────────────────────────
  // Term appears verbatim in the document title or a top-level heading.

  {
    id: "E1",
    query: "oauth",
    category: "exact",
    relevant: [
      { docTitle: "OAuth 2.0", relevance: 3 },
      { docTitle: "OAuth 2.0", nodeTitle: "Authorization Code Flow", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "OAuth 2.0", k: 3 },
  },
  {
    id: "E2",
    query: "jwt authentication",
    category: "exact",
    relevant: [
      { docTitle: "JWT Authentication", relevance: 3 },
      { docTitle: "JWT Authentication", nodeTitle: "Token Structure", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "JWT Authentication", k: 3 },
  },
  {
    id: "E3",
    query: "rate limiting",
    category: "exact",
    relevant: [
      { docTitle: "Rate Limiting", relevance: 3 },
      { docTitle: "Rate Limiting", nodeTitle: "HTTP Headers", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "Rate Limiting", k: 3 },
  },
  {
    id: "E4",
    query: "deployment runbook",
    category: "exact",
    relevant: [
      { docTitle: "Deployment Runbook", relevance: 3 },
      { docTitle: "Deployment Runbook", nodeTitle: "Deploy Procedure", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "Deployment Runbook", k: 3 },
  },
  {
    id: "E5",
    query: "quick start",
    category: "exact",
    relevant: [
      { docTitle: "Quick Start", relevance: 3 },
      { docTitle: "Quick Start", nodeTitle: "Installation", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "Quick Start", k: 3 },
  },
  {
    id: "E6",
    query: "system architecture",
    category: "exact",
    relevant: [
      { docTitle: "System Architecture", relevance: 3 },
      { docTitle: "System Architecture", nodeTitle: "Components", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "System Architecture", k: 3 },
  },
  {
    id: "E7",
    query: "pagination",
    category: "exact",
    relevant: [
      { docTitle: "Pagination", relevance: 3 },
      { docTitle: "Pagination", nodeTitle: "Cursor", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "Pagination", k: 3 },
  },
  {
    id: "E8",
    query: "session management",
    category: "exact",
    relevant: [
      { docTitle: "Session Management", relevance: 3 },
      { docTitle: "Session Management", nodeTitle: "Session Lifecycle", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "Session Management", k: 3 },
  },

  // ── Multi-term (8) ──────────────────────────────────────────────────────────
  // 2–3 terms present in body of the target, spread across body text.

  {
    id: "M1",
    query: "token expiry refresh",
    category: "multi-term",
    relevant: [
      { docTitle: "JWT Authentication", nodeTitle: "Token Expiry", relevance: 3 },
      { docTitle: "OAuth 2.0", nodeTitle: "Token Refresh", relevance: 2 },
    ],
  },
  {
    id: "M2",
    query: "redirect uri authorization code callback",
    category: "multi-term",
    relevant: [
      { docTitle: "OAuth 2.0", nodeTitle: "Authorization Code Flow", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "OAuth 2.0", nodeTitle: "Authorization Code Flow", k: 5 },
  },
  {
    id: "M3",
    query: "cursor next_cursor has_more",
    category: "multi-term",
    relevant: [
      { docTitle: "Pagination", nodeTitle: "Cursor", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "Pagination", nodeTitle: "Cursor", k: 5 },
  },
  {
    id: "M4",
    query: "429 too many requests retry after",
    category: "multi-term",
    relevant: [
      { docTitle: "Rate Limiting", nodeTitle: "Handling 429", relevance: 3 },
      { docTitle: "Rate Limiting", nodeTitle: "HTTP Headers", relevance: 2 },
    ],
  },
  {
    id: "M5",
    query: "rollback previous version helm",
    category: "multi-term",
    relevant: [
      { docTitle: "Rollback Procedure", nodeTitle: "Rollback Steps", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "Rollback Procedure", k: 5 },
  },
  {
    id: "M6",
    query: "environment variable secret API_KEY",
    category: "multi-term",
    relevant: [
      { docTitle: "Configuration Reference", nodeTitle: "Environment Variables", relevance: 3 },
      { docTitle: "Configuration Reference", nodeTitle: "Secret Management", relevance: 2 },
    ],
  },
  {
    id: "M7",
    query: "request lifecycle caching Redis",
    category: "multi-term",
    relevant: [
      { docTitle: "Data Flow", nodeTitle: "Request Lifecycle", relevance: 3 },
      { docTitle: "Data Flow", nodeTitle: "Caching Strategy", relevance: 2 },
    ],
  },
  {
    id: "M8",
    query: "HS256 RS256 signing algorithm",
    category: "multi-term",
    relevant: [
      { docTitle: "JWT Authentication", nodeTitle: "Signing Algorithms", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "JWT Authentication", nodeTitle: "Signing Algorithms", k: 5 },
  },

  // ── Synonym / near-match (5) ────────────────────────────────────────────────
  // Query term not in title; BM25 must rely on body vocabulary or stemming.

  {
    id: "S1",
    query: "login flow",
    category: "synonym",
    // "login" appears in session.md body ("When a user logs in") and oauth.md body
    relevant: [
      { docTitle: "Session Management", relevance: 2 },
      { docTitle: "OAuth 2.0", relevance: 2 },
    ],
  },
  {
    id: "S2",
    query: "bearer token",
    category: "synonym",
    // jwt.md body explicitly uses "Bearer token" in the Authorization header example
    relevant: [
      { docTitle: "JWT Authentication", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "JWT Authentication", k: 5 },
  },
  {
    id: "S3",
    query: "throttling api requests",
    category: "synonym",
    // rate-limiting.md mentions "throttling" in body and title
    relevant: [
      { docTitle: "Rate Limiting", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "Rate Limiting", k: 5 },
  },
  {
    id: "S4",
    query: "getting started",
    category: "synonym",
    relevant: [
      { docTitle: "Quick Start", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "Quick Start", k: 5 },
  },
  {
    id: "S5",
    query: "deployment steps procedure",
    category: "synonym",
    relevant: [
      { docTitle: "Deployment Runbook", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "Deployment Runbook", k: 5 },
  },

  // ── Code symbol (7) ────────────────────────────────────────────────────────
  // Queries targeting specific code symbols (class, method, function names).

  {
    id: "C1",
    query: "AuthService authenticate",
    category: "code-symbol",
    relevant: [
      { docTitle: "AuthService", nodeTitle: "authenticate", relevance: 3 },
      { docTitle: "AuthService", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "AuthService", nodeTitle: "authenticate", k: 5 },
  },
  {
    id: "C2",
    query: "validateToken",
    category: "code-symbol",
    relevant: [
      { docTitle: "AuthService", nodeTitle: "validateToken", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "AuthService", nodeTitle: "validateToken", k: 5 },
  },
  {
    id: "C3",
    query: "OAuthClient get_token",
    category: "code-symbol",
    relevant: [
      { docTitle: "oauth_client", nodeTitle: "get_token", relevance: 3 },
      { docTitle: "oauth_client", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "oauth_client", nodeTitle: "get_token", k: 5 },
  },
  {
    id: "C4",
    query: "Router addRoute",
    category: "code-symbol",
    relevant: [
      { docTitle: "router", nodeTitle: "addRoute", relevance: 3 },
      { docTitle: "router", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "router", nodeTitle: "addRoute", k: 5 },
  },
  {
    id: "C5",
    query: "ClusterManager Connect",
    category: "code-symbol",
    relevant: [
      { docTitle: "cluster", nodeTitle: "Connect", relevance: 3 },
      { docTitle: "cluster", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "cluster", nodeTitle: "Connect", k: 5 },
  },
  {
    id: "C6",
    query: "from_env validate config",
    category: "code-symbol",
    relevant: [
      { docTitle: "config", nodeTitle: "from_env", relevance: 3 },
      { docTitle: "config", nodeTitle: "validate", relevance: 2 },
    ],
  },
  {
    id: "C7",
    query: "RouteHandler interface",
    category: "code-symbol",
    relevant: [
      { docTitle: "router", nodeTitle: "RouteHandler", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "router", nodeTitle: "RouteHandler", k: 5 },
  },

  // ── Facet-filtered (5) ──────────────────────────────────────────────────────
  // Query combined with a facet filter — tests filter correctness and score stability.

  {
    id: "F1",
    query: "deploy",
    category: "facet-filtered",
    filter: { type: ["runbook"] },
    relevant: [
      { docTitle: "Deployment Runbook", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "Deployment Runbook", k: 3 },
  },
  {
    id: "F2",
    query: "authentication token",
    category: "facet-filtered",
    filter: { language: ["java"] },
    relevant: [
      { docTitle: "AuthService", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "AuthService", k: 3 },
  },
  {
    id: "F3",
    query: "token refresh",
    category: "facet-filtered",
    filter: { language: ["python"] },
    relevant: [
      { docTitle: "oauth_client", nodeTitle: "refresh_token", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "oauth_client", k: 5 },
  },
  {
    id: "F4",
    query: "rollback",
    category: "facet-filtered",
    filter: { type: ["runbook"] },
    relevant: [
      { docTitle: "Rollback Procedure", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "Rollback Procedure", k: 3 },
  },
  {
    id: "F5",
    query: "environment variables settings",
    category: "facet-filtered",
    filter: { type: ["reference"] },
    relevant: [
      { docTitle: "Configuration Reference", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "Configuration Reference", k: 5 },
  },

  // ── Discriminating (4) ─────────────────────────────────────────────────────
  // Two docs share query terms; test that the more relevant one ranks higher.

  {
    id: "D1",
    query: "jwt token signing",
    category: "discriminating",
    // jwt.md is the primary reference; oauth.md mentions tokens tangentially
    relevant: [
      { docTitle: "JWT Authentication", relevance: 3 },
      { docTitle: "OAuth 2.0", relevance: 1 },
    ],
    mustBeInTop: { docTitle: "JWT Authentication", k: 3 },
  },
  {
    id: "D2",
    query: "rollback previous deployment",
    category: "discriminating",
    // rollback.md is the primary reference; deploy.md mentions rollback in one section
    relevant: [
      { docTitle: "Rollback Procedure", relevance: 3 },
      { docTitle: "Deployment Runbook", relevance: 1 },
    ],
    mustBeInTop: { docTitle: "Rollback Procedure", k: 3 },
  },
  {
    id: "D3",
    query: "client credentials machine-to-machine",
    category: "discriminating",
    // oauth.md has a full section on client credentials; jwt.md does not
    relevant: [
      { docTitle: "OAuth 2.0", nodeTitle: "Client Credentials", relevance: 3 },
      { docTitle: "JWT Authentication", relevance: 1 },
    ],
    mustBeInTop: { docTitle: "OAuth 2.0", nodeTitle: "Client Credentials", k: 5 },
  },
  {
    id: "D4",
    query: "cursor offset pagination limit",
    category: "discriminating",
    // pagination.md is primary; rate-limiting.md also has "limit" but in a different context
    relevant: [
      { docTitle: "Pagination", relevance: 3 },
      { docTitle: "Rate Limiting", relevance: 1 },
    ],
    mustBeInTop: { docTitle: "Pagination", k: 3 },
  },

  // ── Zero-result / near-zero (3) ────────────────────────────────────────────
  // These queries should return no relevant results (sanity check).
  // Not included in aggregate NDCG (vacuous relevance).

  {
    id: "Z1",
    query: "blockchain distributed ledger",
    category: "zero-result",
    relevant: [], // nothing in the corpus is relevant
  },
  {
    id: "Z2",
    query: "machine learning neural network gradient descent",
    category: "zero-result",
    relevant: [],
  },
  {
    id: "Z3",
    query: "xyzunknownterm987",
    category: "zero-result",
    relevant: [],
  },

  // ── C# code symbols (3) ──────────────────────────────────────────
  {
    id: "CS1",
    query: "UserService CreateUserAsync",
    category: "code-symbol",
    relevant: [
      { docTitle: "UserService", nodeTitle: "CreateUserAsync", relevance: 3 },
      { docTitle: "UserService", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "UserService", nodeTitle: "CreateUserAsync", k: 5 },
  },
  {
    id: "CS2",
    query: "IUserRepository FindByEmail",
    category: "code-symbol",
    relevant: [
      { docTitle: "UserService", nodeTitle: "IUserRepository", relevance: 3 },
    ],
    mustBeInTop: { docTitle: "UserService", nodeTitle: "IUserRepository", k: 5 },
  },
  {
    id: "CS3",
    query: "change password hash verify",
    category: "multi-term",
    relevant: [
      { docTitle: "UserService", nodeTitle: "ChangePasswordAsync", relevance: 3 },
      { docTitle: "UserService", nodeTitle: "IPasswordHasher", relevance: 2 },
    ],
    mustBeInTop: { docTitle: "UserService", nodeTitle: "ChangePasswordAsync", k: 5 },
  },
];
