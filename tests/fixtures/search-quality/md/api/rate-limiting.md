---
title: "Rate Limiting"
description: "API rate limiting rules, throttling behaviour, response headers, and retry strategies"
type: reference
category: api
tags: [rate-limiting, throttling, 429, retry, api]
---

# Rate Limiting

The API enforces rate limits to ensure fair use and protect against abuse.
Requests that exceed the limit are throttled and return `429 Too Many Requests`.

## Limits by Tier

| Plan | Requests / minute | Requests / day | Burst |
|---|---|---|---|
| Free | 60 | 5,000 | 10 |
| Pro | 600 | 100,000 | 50 |
| Enterprise | 6,000 | Unlimited | 200 |

Throttling is applied per API key. Batch operations (e.g., bulk create) count as
multiple requests proportional to the number of items.

## HTTP Headers

Every response includes rate-limit headers so clients can track their usage:

```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 423
X-RateLimit-Reset: 1700000060
Retry-After: 37
```

- `X-RateLimit-Limit` — total requests allowed in the current window
- `X-RateLimit-Remaining` — requests remaining before throttling
- `X-RateLimit-Reset` — Unix timestamp when the window resets
- `Retry-After` — seconds to wait before retrying (only present on 429 responses)

## Handling 429 Errors

When you receive a `429 Too Many Requests` response:

1. **Read `Retry-After`** — wait exactly this many seconds before retrying
2. **Exponential backoff** — if `Retry-After` is absent, double the wait time on each retry
3. **Jitter** — add random jitter (±20%) to avoid thundering-herd problems when many
   clients retry simultaneously

**Python example:**
```python
import time, random

def request_with_retry(fn, max_retries=5):
    delay = 1.0
    for attempt in range(max_retries):
        resp = fn()
        if resp.status_code != 429:
            return resp
        retry_after = float(resp.headers.get("Retry-After", delay))
        time.sleep(retry_after + random.uniform(0, retry_after * 0.2))
        delay *= 2
    raise Exception("Rate limit exceeded after retries")
```
