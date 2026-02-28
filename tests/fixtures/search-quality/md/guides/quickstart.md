---
title: "Quick Start Guide"
description: "Get started with the API in under 5 minutes: installation, configuration, and your first request"
type: guide
category: getting-started
tags: [quickstart, tutorial, installation, getting-started, setup]
---

# Quick Start Guide

This guide walks you through getting started with the API. You will be making
authenticated requests within 5 minutes.

## Installation

Install the official SDK for your language:

```bash
# Node.js / Bun
npm install @example/api-sdk

# Python
pip install example-api

# Go
go get github.com/example/api-go
```

Minimum requirements: Node 18+, Python 3.10+, or Go 1.21+.

## Configuration

Set your API key as an environment variable. Never hard-code credentials in source code.

```bash
export API_KEY="your_api_key_here"
export API_BASE_URL="https://api.example.com/v1"
```

Obtain your API key from the developer dashboard at `https://dashboard.example.com`.
Free tier keys have a rate limit of 60 requests per minute (see [Rate Limiting](../api/rate-limiting.md)).

## First Request

Verify your setup with a call to the `/auth/me` endpoint:

```bash
curl -H "Authorization: Bearer $API_KEY" \
     https://api.example.com/v1/auth/me
```

Expected response:
```json
{
  "id": "usr_abc123",
  "username": "your-username",
  "email": "you@example.com",
  "role": "user"
}
```

If you receive `401 Unauthorized`, check that your `API_KEY` is correct and has not expired.
For next steps, see the [REST API Endpoints](../api/endpoints.md) reference.
