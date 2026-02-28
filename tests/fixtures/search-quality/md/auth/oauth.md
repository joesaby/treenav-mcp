---
title: "OAuth 2.0 Guide"
description: "Complete guide to OAuth 2.0 authorization flows including authorization code, client credentials, and token refresh"
type: guide
category: auth
tags: [oauth, authentication, authorization, token, login]
---

# OAuth 2.0 Guide

OAuth 2.0 is the industry-standard protocol for authorization, enabling third-party
applications to obtain limited access to user accounts. Users can log in and grant
access without sharing their credentials directly.

## Authorization Code Flow

The authorization code flow is the most secure OAuth flow, designed for server-side
applications. After the user logs in and grants permission, the authorization server
redirects back to your `redirect_uri` with a temporary `authorization_code`.

Your server exchanges this code for an access token via a POST request:

```
POST /oauth/token
grant_type=authorization_code
code=<authorization_code>
redirect_uri=https://yourapp.com/callback
client_id=<your_client_id>
client_secret=<your_client_secret>
```

The server returns an `access_token` and optionally a `refresh_token`.

## Client Credentials Flow

The client credentials flow is for machine-to-machine (M2M) authentication where
no user is involved. The client authenticates directly using its `client_id` and
`client_secret`:

```
POST /oauth/token
grant_type=client_credentials
client_id=<your_client_id>
client_secret=<your_client_secret>
scope=read:data write:data
```

This flow is used for background services, daemons, and server-to-server APIs.

## Token Refresh

Access tokens expire (typically after 1 hour). Use the `refresh_token` to obtain
a new access token without requiring the user to log in again:

```
POST /oauth/token
grant_type=refresh_token
refresh_token=<your_refresh_token>
client_id=<your_client_id>
```

Refresh tokens have a longer expiry (days or weeks) and must be stored securely.

## Scopes

Scopes define the level of access requested. Common scopes:

- `read:profile` — read the user's profile
- `write:data` — write application data
- `offline_access` — request a refresh token for long-term access

Always request the minimum scopes needed (principle of least privilege).
