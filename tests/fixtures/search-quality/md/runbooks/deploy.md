---
title: "Deployment Runbook"
description: "Step-by-step production deployment procedure including pre-deploy checks, deploy steps, and verification"
type: runbook
category: operations
tags: [deployment, production, runbook, procedure, release]
---

# Deployment Runbook

Follow these steps in order for every production deployment. Do not skip steps.
Estimated total time: 20–40 minutes.

## Pre-Deploy Checks

Before starting the deployment:

- [ ] CI pipeline is green on the release branch
- [ ] All required reviewers have approved the PR
- [ ] Database migrations are backwards-compatible (old code can run against new schema)
- [ ] Feature flags are configured for staged rollout if needed
- [ ] Runbook is reviewed by a second engineer
- [ ] On-call engineer is aware and available

If any check fails, **stop** and resolve the issue before proceeding.

## Deploy Procedure

1. **Tag the release** — `git tag v<version> && git push origin v<version>`
2. **Apply database migrations** — `kubectl exec -it <migrator-pod> -- ./migrate up`
3. **Deploy to staging** — `helm upgrade app ./chart --values staging.yaml --wait`
4. **Smoke test staging** — run the smoke test suite (`bun run test:smoke --env staging`)
5. **Deploy to production** — `helm upgrade app ./chart --values production.yaml --wait`
6. **Verify rollout** — `kubectl rollout status deployment/app --timeout=5m`

### Rollback Decision

If the rollout fails or smoke tests fail: proceed immediately to the
[Rollback Procedure](./rollback.md). Do not attempt to patch in production.

## Post-Deploy Verification

After a successful rollout:

1. **Check error rate** — confirm `5xx` rate is below 0.1% for 5 minutes
2. **Check p99 latency** — confirm p99 < 300 ms for 5 minutes
3. **Check key metrics** — login success rate, token issuance rate, DB connection pool
4. **Alert on anomalies** — if any metric deviates by > 20% from the baseline, page on-call

Mark the deployment as complete in the incident tracking system.
