---
title: "Session Management"
description: "Server-side session storage, cookie configuration, and session lifecycle management"
type: guide
category: auth
tags: [session, cookie, authentication, login, storage]
---

# Session Management

Session-based authentication stores the user's login state on the server. When a user
logs in, the server creates a session and returns a session ID as a cookie. On subsequent
requests, the browser sends the cookie and the server looks up the session to authenticate
the user.

## Cookie Configuration

Configure session cookies securely to prevent common attacks:

```
Set-Cookie: session_id=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600
```

- **HttpOnly** — prevents JavaScript from reading the cookie (mitigates XSS)
- **Secure** — transmit only over HTTPS
- **SameSite=Strict** — prevents CSRF attacks by blocking cross-site requests
- **Max-Age** — sets the session expiry in seconds

## Server-Side Storage

Session data must be stored on the server, not in the cookie:

| Backend | Use case |
|---|---|
| Redis | High-performance, distributed; ideal for production |
| Database (PostgreSQL) | Persistent sessions that survive restarts |
| In-memory | Development only — not suitable for multi-node deployments |

For horizontally scaled deployments, always use a shared storage backend (Redis or DB)
so any server instance can validate any session.

## Session Lifecycle

**Creation**: After successful login, generate a cryptographically random session ID
(minimum 128 bits of entropy) and store the session data server-side.

**Validation**: On each request, look up the session ID, verify it has not expired,
and confirm the associated user is still active.

**Invalidation**: Destroy the session on logout and after idle timeout. Rotate the
session ID after privilege escalation (e.g., after the user re-enters their password)
to prevent session fixation attacks.

**Expiry**: Implement both absolute expiry (hard limit) and idle timeout (reset on
activity). Warn users before their session expires to avoid data loss.
