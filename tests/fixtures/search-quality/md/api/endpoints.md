---
title: "REST API Endpoints"
description: "Complete REST API endpoint reference for authentication, users, and token management"
type: reference
category: api
tags: [api, rest, endpoints, http, reference]
---

# REST API Endpoints

Base URL: `https://api.example.com/v1`

All endpoints require the `Authorization: Bearer <token>` header unless otherwise noted.

## Authentication Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Authenticate with username and password, returns tokens |
| POST | `/auth/logout` | Invalidate the current session or token |
| POST | `/auth/refresh` | Exchange a refresh token for a new access token |
| GET | `/auth/me` | Return the authenticated user's profile |

**Login request:**
```json
{ "username": "alice", "password": "secret" }
```

**Login response:**
```json
{ "access_token": "...", "refresh_token": "...", "expires_in": 3600 }
```

## User Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/users` | List all users (admin only) |
| GET | `/users/{id}` | Fetch a specific user by ID |
| POST | `/users` | Create a new user |
| PATCH | `/users/{id}` | Update user fields |
| DELETE | `/users/{id}` | Delete a user (admin only) |

User objects include: `id`, `username`, `email`, `role`, `created_at`, `updated_at`.

## Token Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/tokens/revoke` | Revoke a specific token |
| GET | `/tokens` | List active tokens for the authenticated user |
| DELETE | `/tokens/{id}` | Delete a token by ID |

Token revocation takes effect immediately. Any request using a revoked token returns
`401 Unauthorized`.
