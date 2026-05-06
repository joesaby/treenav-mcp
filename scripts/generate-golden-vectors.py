#!/usr/bin/env python3
"""
Generate the golden-vector fixture for Tier 4's tokenizer-parity gate.

Reference encoder: MinishLab's `model2vec` Python library, model
`minishlab/potion-code-16M` (256-d, mean-pooled, L2-normalized by default).

Usage:
    /tmp/tier4-venv/bin/python scripts/generate-golden-vectors.py \\
        > tests/fixtures/model2vec-golden-vectors.json

Inputs are 100 representative strings: English prose, code identifiers,
file paths, mixed-case acronyms, a sprinkling of non-ASCII characters,
and a few edge cases (single token, whitespace-only after strip).

Output JSON shape (per the PR-8 brief):
    {
      "model": "minishlab/potion-code-16M",
      "model_version": "<model2vec lib version>",
      "generated_at": "<ISO date>",
      "strings": [
        {"text": "...", "vector": [<256 float32 values>]},
        ...
      ]
    }

Vectors are encoded as float32 (cast from the library's float64 default) so
the pure-TS port can compare against the same precision it will produce.
"""

from __future__ import annotations
import datetime as dt
import json
import sys

import model2vec
from model2vec import StaticModel

# Stable order — DO NOT shuffle. The TS parity gate iterates this list
# positionally to keep failure messages comprehensible.
STRINGS = [
    # ── English prose (15) ────────────────────────────────────────
    "How does the rate limiter handle concurrent requests?",
    "Refresh tokens should rotate on every use.",
    "The deployment failed because of a missing environment variable.",
    "Retry with exponential backoff until success or max attempts reached.",
    "Cache invalidation is one of the two hardest problems in computer science.",
    "Authentication uses JSON Web Tokens signed with RS256.",
    "When the database is unreachable the service degrades gracefully.",
    "Use cursor-based pagination for large result sets.",
    "OAuth 2.0 authorization code flow with PKCE for public clients.",
    "Logs are aggregated centrally and retained for thirty days.",
    "Feature flags are evaluated per-request, never cached client-side.",
    "Secrets are read from the cloud provider's secret manager at startup.",
    "Healthchecks return 200 only when all upstream dependencies are reachable.",
    "Background jobs run on a dedicated worker fleet.",
    "Long-running migrations should be split into reversible steps.",

    # ── Code identifiers / symbols (20) ───────────────────────────
    "AuthService",
    "validateToken",
    "ConnectionPool::acquire",
    "router.handle",
    "useEffect",
    "Box<dyn Error>",
    "asyncio.gather",
    "std::shared_ptr",
    "OAuthClient.refresh_access_token",
    "UserRepository#findByEmail",
    "DocumentStore",
    "indexCodeCollection",
    "AbstractSingletonProxyFactoryBean",  # famously long Java class name
    "kFooBarBaz",
    "snake_case_function",
    "kebab-case-cli-flag",
    "PascalCaseClass",
    "camelCaseMethod",
    "SCREAMING_SNAKE_CASE_CONST",
    "ErrConnectionRefused",

    # ── File paths (10) ───────────────────────────────────────────
    "src/store.ts",
    "tests/fixtures/search-quality/code/AuthService.java",
    "/usr/local/bin/treenav",
    "node_modules/@modelcontextprotocol/sdk/dist/esm/index.js",
    "../../docs/plans/2026-05-03-semble-feature-port.md",
    "C:\\Users\\admin\\AppData\\Local\\Temp\\foo.txt",
    "scripts/measure-tier4.ts",
    "src/parsers/typescript.ts",
    "docs/adr/0001-llm-curated-wiki.md",
    "tests/fixtures/model2vec-golden-vectors.json",

    # ── Mixed-case acronyms (10) ──────────────────────────────────
    "TLS",
    "JWT",
    "K8s",
    "OAuth2",
    "SHA-256",
    "REST API",
    "gRPC streaming",
    "CRUD operations",
    "URL",
    "JSON-RPC",

    # ── Non-ASCII (10) — small sample to exercise unicode tokenizer paths
    "café",
    "naïve implementation",
    "résumé parser",
    "Привет, мир!",
    "你好,世界",
    "こんにちは",
    "Δ delta encoding",
    "—em dash—",
    "“smart quotes”",
    "emoji ✓ check mark",

    # ── Mixed natural-language + code (15) ────────────────────────
    "The validateToken method throws InvalidJwtException when the signature is bad.",
    "Use the connection_pool.acquire() helper instead of new Connection() directly.",
    "Pass `--retries 5` to the CLI to override the default of 3.",
    "Set DOCS_ROOT=./wiki to point treenav at your documentation tree.",
    "If the response contains `error.code = 'rate_limited'`, back off.",
    "Index files matching `**/*.{ts,py,go,rs}` by default.",
    "The UserRepository#findByEmail call returns Optional<User>.",
    "router.handle('/api/v1/users', authMiddleware, handler)",
    "import { DocumentStore } from 'treenav';",
    "const result = await store.searchDocuments(query, { limit: 10 });",
    "Run `bun test` to execute the suite locally.",
    "Returns a `Promise<TreeNode[]>` — the caller awaits.",
    "Set `WIKI_WRITE=1` to enable the curation toolset.",
    "Failed with HTTP 503 on attempt 4/5 — see logs/api-gateway.log.",
    "RFC 7519 defines the JWT structure; section 4.1 lists registered claims.",

    # ── Edge cases (20) ───────────────────────────────────────────
    "a",                    # single ASCII char
    "I",                    # single capital
    "x",                    # single lowercase
    "1",                    # digit
    "42",                   # number
    "...",                  # punctuation only
    "   leading and trailing spaces   ",
    "\t\ttabs and tabs",
    "newline\nin\nstring",
    "\"quoted\"",
    "(parenthesized)",
    "[bracketed]",
    "{braced}",
    "<angle-bracketed>",
    "trailing.dot.",
    "a-b",
    "a_b",
    "a/b",
    "// inline comment",
    "/* block comment */",
]

assert len(STRINGS) == 100, f"need exactly 100 strings, got {len(STRINGS)}"


def main() -> int:
    model_name = "minishlab/potion-code-16M"
    print(f"Loading {model_name} ...", file=sys.stderr)
    model = StaticModel.from_pretrained(model_name)
    print(f"  dim={model.dim}  normalize={model.normalize}  vocab={model.embedding.shape[0]}",
          file=sys.stderr)

    # encode() returns float64; cast to float32 once, deterministically.
    vectors = model.encode(STRINGS).astype("float32")
    assert vectors.shape == (100, 256), f"expected (100, 256), got {vectors.shape}"

    out = {
        "model": model_name,
        "model_version": model2vec.__version__,
        "embedding_dim": int(model.dim),
        "normalize": bool(model.normalize),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "vocab_size": int(model.embedding.shape[0]),
        "strings": [
            {"text": s, "vector": [float(x) for x in v]}
            for s, v in zip(STRINGS, vectors)
        ],
    }

    json.dump(out, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    print(f"Wrote {len(out['strings'])} entries.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
