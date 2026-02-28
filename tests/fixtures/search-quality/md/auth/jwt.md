---
title: "JWT Authentication"
description: "JSON Web Token structure, signing algorithms, validation, and expiry handling"
type: reference
category: auth
tags: [jwt, token, authentication, signing, bearer]
---

# JWT Authentication

JSON Web Tokens (JWT) are a compact, URL-safe means of representing claims between
two parties. Include the JWT as a Bearer token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## Token Structure

A JWT consists of three Base64URL-encoded parts separated by dots:

```
header.payload.signature
```

- **Header**: algorithm (`alg`) and token type (`typ: JWT`)
- **Payload**: claims — `sub` (subject), `iat` (issued at), `exp` (expiry), `aud` (audience)
- **Signature**: HMAC or RSA signature over header + payload

## Signing Algorithms

Choose the appropriate signing algorithm for your security requirements:

| Algorithm | Type | Key | Use case |
|---|---|---|---|
| HS256 | Symmetric | Shared secret | Internal services |
| RS256 | Asymmetric | Public/private key pair | Public APIs |
| ES256 | Asymmetric | ECDSA key pair | Mobile/embedded |

**HS256**: Fast, simple — use when both signer and verifier are trusted.
**RS256**: The public key can be distributed safely; verify without the signing secret.

## Token Validation

Always validate the following claims on receipt:

1. **Signature** — verify using the signing secret or public key
2. **Expiry** (`exp`) — reject tokens past their expiry timestamp
3. **Issuer** (`iss`) — confirm the token was issued by the expected authority
4. **Audience** (`aud`) — confirm the token is intended for your service

Reject any token that fails validation — do not trust the payload claims without it.

## Token Expiry

Short-lived tokens reduce the window of exposure if a token is compromised:

- **Access token**: 15 minutes to 1 hour (`exp` = `iat` + TTL)
- **Refresh token**: 7–30 days; issue a new access token on refresh
- **Sliding expiry**: extend the token on each valid request (session-like behaviour)

Implement token renewal transparently in your HTTP client to avoid user disruption.
