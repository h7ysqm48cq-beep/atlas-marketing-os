# Deployment Automation Liveness

## Operational contract

Production deployment automation uses the Railway `production-deploy-executor`
service as the primary execution loop.

- Primary: Railway resident daemon.
- Expected daemon heartbeat cadence: approximately 60 seconds.
- Primary liveness evidence: runtime heartbeat and successful governed claim/deploy/consume cycles.
- Fallback: GitHub Actions workflow `.github/workflows/atlas-production-deploy-executor.yml`.
- Configured GitHub cron: `*/5 * * * *`.
- GitHub scheduled delivery is best-effort and MUST NOT be treated as a five-minute SLA.

## Health semantics

System Health must not mark production deployment automation incomplete solely because
GitHub scheduled workflow runs are delayed or coalesced while the Railway daemon is
healthy and emitting current heartbeat evidence.

A production automation incident requires evidence that the primary Railway daemon is
unhealthy, stale, unavailable, or unable to complete the governed
authorization -> claim -> exact-SHA deployment -> terminal verification -> consumption
chain.

## Governance boundary

This contract does not weaken Owner authorization, independent verification,
exact-SHA binding, reservation idempotency, fail-closed behavior, or deployment
authorization consumption. GitHub Actions remains a recovery/fallback surface only.
