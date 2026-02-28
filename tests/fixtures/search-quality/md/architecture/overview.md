---
title: "System Architecture"
description: "High-level component overview, communication patterns, and scalability design"
type: architecture
category: system
tags: [architecture, components, design, overview, system]
---

# System Architecture

The system follows a layered microservices architecture. Each service owns its data
and communicates via well-defined APIs or asynchronous events.

## Components

The core services are:

- **API Gateway** — single ingress point; handles TLS termination, routing, and
  rate limiting before requests reach downstream services
- **Auth Service** — issues and validates tokens; owns the user credential store
- **User Service** — manages user profiles, roles, and permissions
- **Data Service** — business logic and persistence layer (PostgreSQL)
- **Event Bus** — Kafka-based async messaging between services

Each service is independently deployable and scaled horizontally behind a load balancer.

## Communication Patterns

Services communicate in two modes:

**Synchronous (REST)**: Used for request/response flows where the caller needs an
immediate result. The API Gateway routes REST calls to the appropriate service.
Keep synchronous calls short — under 200 ms p99 latency.

**Asynchronous (Events)**: Used for operations that can tolerate eventual consistency —
audit logging, notifications, cache invalidation. Producers publish events to Kafka topics;
consumers process independently and at their own pace.

Avoid synchronous chains longer than 2 hops to prevent cascading failures.

## Scalability

Each stateless service scales horizontally. Guidelines:

- **CPU-bound** services (data processing): auto-scale on CPU utilisation > 70%
- **I/O-bound** services (gateway, auth): auto-scale on request rate (RPS)
- **Stateful** services (databases, Kafka): scale via partitioning and read replicas

The load balancer distributes traffic using least-connection routing with health checks
every 5 seconds. Unhealthy instances are removed from rotation within 15 seconds.
