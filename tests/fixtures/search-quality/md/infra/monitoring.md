---
title: "Monitoring and Alerting"
description: "Prometheus metrics, Grafana dashboards, and alert routing for production services."
tags: [prometheus, grafana, alerting, metrics, slo, observability]
type: reference
category: infrastructure
---

# Monitoring and Alerting

Production observability requires three pillars: metrics, logs, and traces.
This guide covers the metrics layer using Prometheus and Grafana.

## Prometheus Metrics

### Instrument Your Service

Add metrics to your application using the Prometheus client library:

```go
var (
  requestDuration = prometheus.NewHistogramVec(
    prometheus.HistogramOpts{
      Name:    "http_request_duration_seconds",
      Help:    "HTTP request duration in seconds",
      Buckets: prometheus.DefBuckets,
    },
    []string{"method", "path", "status"},
  )
  requestTotal = prometheus.NewCounterVec(
    prometheus.CounterOpts{
      Name: "http_requests_total",
      Help: "Total HTTP requests",
    },
    []string{"method", "path", "status"},
  )
)
```

### Scrape Configuration

Add your service to Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: api-server
    static_configs:
      - targets: ["api-server:9090"]
    scrape_interval: 15s
```

## Alerting Rules

Define SLO-based alert rules in Prometheus:

```yaml
groups:
  - name: api-slo
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Error rate exceeds 1% SLO"
```

## Grafana Dashboards

### Key Panels

- **Request rate** — rate of requests per path per second
- **Error rate** — 5xx responses as percentage of total
- **P99 latency** — 99th percentile response time
- **Pod restarts** — container restart counter

## Incident Response

When an alert fires:
1. Check Grafana dashboard for the affected service
2. Review recent deployments
3. Check pod logs: `kubectl logs -l app=api-server --tail=200 -n production`
4. If needed: `kubectl rollout undo deployment/api-server -n production`
