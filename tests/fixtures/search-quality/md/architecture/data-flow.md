---
title: "Data Flow"
description: "Request lifecycle, caching strategy, and event processing pipeline through system components"
type: architecture
category: system
tags: [data-flow, request-lifecycle, pipeline, caching, events]
---

# Data Flow

This document traces how data moves through the system — from an incoming HTTP request
through authentication, business logic, caching, and async event processing.

## Request Lifecycle

A typical authenticated API request flows as follows:

1. **Ingress** — TLS termination at the load balancer; request forwarded to API Gateway
2. **Rate limiting** — Gateway checks the caller's rate-limit bucket (Redis counter)
3. **Authentication** — Gateway validates the Bearer token with the Auth Service
4. **Routing** — Gateway forwards the authenticated request to the target service
5. **Business logic** — Service reads from the cache (Redis) or database (PostgreSQL)
6. **Response** — Service returns JSON; Gateway adds CORS headers and returns to client
7. **Audit event** — Service publishes an audit record to the event bus asynchronously

Total p99 latency target: under 250 ms for read operations, 500 ms for writes.

## Caching Strategy

The system uses a cache-aside pattern with Redis as the cache layer:

1. **Cache hit**: return the cached value immediately (no DB query)
2. **Cache miss**: query the database, populate the cache, return the result
3. **Cache invalidation**: publish a `cache.invalidate` event when data changes;
   all service instances listen and evict the affected keys

TTL values by data type:
- User profile: 5 minutes
- Token validation result: 1 minute (short to react quickly to revocations)
- Configuration: 30 minutes

## Event Processing

Events published to Kafka are processed by consumer groups:

- **Audit consumer** — writes to the audit log database
- **Notification consumer** — sends emails and webhooks
- **Search indexer** — updates the search index when entities change

Consumers checkpoint their offset after successful processing. On failure, the
consumer retries with exponential backoff. After 3 failures, the event is written
to a dead-letter topic for manual inspection.
