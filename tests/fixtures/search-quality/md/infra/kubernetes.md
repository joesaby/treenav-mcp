---
title: "Kubernetes Operations Guide"
description: "Day-2 Kubernetes operations: deployments, scaling, health checks, and namespace management."
tags: [kubernetes, k8s, pod, deployment, helm, namespace, autoscaling]
type: runbook
category: infrastructure
---

# Kubernetes Operations Guide

This guide covers common day-2 Kubernetes operations for production clusters.

## Deployments

### Rolling Update

Trigger a rolling update by updating the image tag in the deployment manifest:

```bash
kubectl set image deployment/api-server api=myregistry/api:v2.3.1 -n production
kubectl rollout status deployment/api-server -n production
```

Rolling updates replace pods incrementally without downtime. The default strategy
keeps maxSurge at 1 and maxUnavailable at 0.

### Rollback a Deployment

If a rolling update fails health checks:

```bash
kubectl rollout undo deployment/api-server -n production
kubectl rollout history deployment/api-server -n production
```

## Horizontal Pod Autoscaling

HPA automatically scales replicas based on CPU and memory utilization:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-server-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## Pod Health Checks

### Liveness Probe

Liveness probes restart the container if the application enters a bad state:

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3
```

### Readiness Probe

Readiness probes stop routing traffic to pods that are not ready:

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
```

## Namespace Management

Namespaces provide isolation between environments. Use separate namespaces
for production, staging, and development:

```bash
kubectl get pods -n production
kubectl describe pod api-server-xxx -n production
kubectl logs api-server-xxx -n production --tail=100
```
