---
title: "Rollback Procedure"
description: "Emergency rollback steps for failed or harmful production deployments"
type: runbook
category: operations
tags: [rollback, emergency, recovery, deployment, incident]
---

# Rollback Procedure

Execute this runbook when a deployment causes elevated errors, latency spikes, or
data integrity issues and the issue cannot be resolved quickly in production.

**Time to rollback target: under 5 minutes from decision.**

## When to Rollback

Trigger a rollback if any of the following occur within 30 minutes of deployment:

- `5xx` error rate exceeds 1% for more than 2 consecutive minutes
- p99 latency exceeds 1 second for more than 2 consecutive minutes
- Critical business metric drops > 10% (login rate, order completion, etc.)
- On-call engineer or incident commander makes the call

When in doubt, roll back first and investigate later. It is faster to recover from
an unnecessary rollback than from a prolonged outage.

## Rollback Steps

1. **Notify the team** — post in `#incidents`: "Rolling back to v<previous-version>"
2. **Revert the Helm release:**
   ```bash
   helm rollback app 0   # 0 = previous revision
   kubectl rollout status deployment/app --timeout=5m
   ```
3. **Verify the previous image is running:**
   ```bash
   kubectl get pods -l app=api -o jsonpath='{.items[*].spec.containers[*].image}'
   ```
4. **Check error rate** — confirm `5xx` rate falls below 0.1% within 2 minutes
5. **Revert database migrations** (if applicable):
   ```bash
   kubectl exec -it <migrator-pod> -- ./migrate down 1
   ```

## Post-Rollback Actions

After the system is stable:

1. **Write an incident record** — document timeline, impact, and root cause hypothesis
2. **Preserve evidence** — collect logs, traces, and metrics from the failed deployment window
3. **Fix forward** — create a new branch from the last good commit, apply the fix
4. **Post-mortem** — schedule a blameless post-mortem within 48 hours
5. **Update this runbook** — if anything in this procedure was unclear or wrong, fix it now
