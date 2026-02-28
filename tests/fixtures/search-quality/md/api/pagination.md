---
title: "Pagination Guide"
description: "Cursor-based and offset-based pagination strategies for the REST API"
type: guide
category: api
tags: [pagination, cursor, offset, api, list]
---

# Pagination Guide

All list endpoints return paginated results to avoid returning unbounded data sets.
Choose the pagination strategy that matches your access pattern.

## Cursor-Based Pagination

Cursor-based pagination uses an opaque cursor to mark the current position in the
result set. Results are stable even if records are inserted or deleted between pages.

**Request:**
```
GET /users?limit=20&after=eyJpZCI6MTAwfQ==
```

**Response:**
```json
{
  "data": [...],
  "meta": {
    "next_cursor": "eyJpZCI6MTIwfQ==",
    "prev_cursor": "eyJpZCI6ODh9",
    "has_more": true
  }
}
```

Use `next_cursor` in the next request's `after` parameter.
`next_cursor` is `null` when you have reached the last page.

### When to use cursor pagination

- Real-time feeds where records are frequently inserted
- Large datasets where counting total rows is expensive
- Infinite scroll UIs

## Offset-Based Pagination

Offset-based pagination uses `page` and `limit` (or `offset`) parameters.
Results may shift if records are inserted between pages.

**Request:**
```
GET /users?page=3&limit=25
```

**Response:**
```json
{
  "data": [...],
  "meta": {
    "page": 3,
    "limit": 25,
    "total_count": 342,
    "total_pages": 14
  }
}
```

### When to use offset pagination

- Reports or exports where total count matters
- Admin UIs with page-number navigation

## Response Format

All paginated responses follow the same envelope structure:

```json
{
  "data": [ ... ],
  "meta": { "next_cursor": "...", "has_more": true },
  "links": {
    "self":  "https://api.example.com/v1/users?after=abc",
    "next":  "https://api.example.com/v1/users?after=xyz"
  }
}
```
