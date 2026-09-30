# ATLAS Production Deploy Executor Liveness Design

Date: 2026-09-30  
Status: Approved — 2026-09-30  
Repository: h7ysqm48cq-beep/atlas-marketing-os  
Main baseline: 2767b80f07dca638608c948cefcf0019ae6a9903  
Canonical production baseline at design time: a9d22c1a4558f92d044dba01d8353d9aaff12d72

## 1. Purpose

ATLAS already has a fail-closed production deployment executor for engineering-runner and engineering-verifier. The executor is correct when invoked: it reads the canonical production/atlas SHA, claims a matching Supervisor-authorized production deployment, creates an exact-SHA Railway deployment only after a valid claim, and relies on the existing deploy gate to consume the signed Human Owner deployment authorization.

The remaining liveness gap is the trigger. The executor currently depends on GitHub Actions schedule at five-minute cadence plus manual workflow_dispatch. GitHub scheduled workflows are best-effort. ATLAS has observed successful scheduled runs, but not at a dependable five-minute cadence.

The goal of this design is to make authorization consumption continuously available even when GitHub scheduled Actions are delayed, without weakening any existing authorization, identity, exact-SHA, reservation, deploy-gate, or audit guarantees.

## 2. Success Criteria

The closure is complete only when all of the following are true:

1. A valid unconsumed production deployment authorization for engineering-runner or engineering-verifier is automatically discovered without requiring a GitHub scheduled run.
2. No valid authorization means no Railway deployment is created.
3. Only the current canonical production/atlas SHA may be deployed.
4. Only engineering-runner and engineering-verifier may be deployed by this executor.
5. The executor remains bound to the existing ATLAS Railway project and production environment.
6. A crash after reservation does not permanently strand the authorization.
7. A different dispatcher identity cannot take over an existing reservation.
8. Signed Human Owner deployment authorization remains single-consumption and is still consumed only by the existing deploy gate.
9. GitHub Actions remains a compatible backup and manual execution channel.
10. Negative and positive production canaries prove the behavior end to end.

## 3. Non-Goals

This change does not:

- add API, web, browser-worker, or any other service to the production deploy executor;
- change deployment authorization semantics;
- change the production branch from production/atlas;
- change Supervisor Human Owner approval or signature rules;
- add a Ruleset bypass;
- change database schema;
- write deployment authority directly to the database;
- weaken exact-SHA validation;
- change the existing deploy gate;
- make Railway secrets retrievable by the executor;
- replace GitHub Actions entirely;
- guarantee exactly one Railway deployment attempt after an ambiguous network failure.

The invariant remains exactly one successful authorization consumption.

## 4. Current Architecture

The current GitHub Actions executor uses:

- .github/workflows/atlas-production-deploy-executor.yml
- tools/deployment/atlas-production-deploy-executor.mjs

The executor:

1. verifies the Railway project token belongs to the exact ATLAS project and environment;
2. reads production/atlas from GitHub;
3. iterates only engineering-runner and engineering-verifier;
4. calls Supervisor production-deployment dispatch claim;
5. treats not_found and already_reserved as safe no-op results;
6. creates a Railway exact-SHA deployment only when claimed=true with valid Task, Execution, and reservation identities;
7. polls the created Railway deployment to a terminal result;
8. requires exact-SHA SUCCESS.

The Supervisor claim path persists ownerDeploymentDispatchReservation. That reservation is intentionally durable and currently has no release endpoint.

## 5. Crash-Recovery Requirement

A continuous executor exposes an existing liveness edge:

1. executor claims an authorization;
2. Supervisor persists the dispatch reservation;
3. executor crashes before Railway deployment creation;
4. later executors see already_reserved;
5. because the reservation has no release path, the authorization can remain stranded.

A reservation TTL is not the preferred solution. TTL-based takeover can create actor ambiguity and races with a slow or uncertain deployment request.

Instead, reservation recovery will be identity-based and idempotent.

## 6. Architecture

### 6.1 Railway Background Worker

Add one production Railway service named production-deploy-executor.

It runs continuously from the same repository and production/atlas branch.

Start command:

    node tools/deployment/atlas-production-deploy-executor-daemon.mjs

The daemon runs one executor cycle at a time:

1. call the shared production deploy executor;
2. wait approximately 60 seconds after a successful or no-op cycle;
3. repeat.

Cycles never overlap inside one process.

Unexpected executor errors remain fail-closed. The process exits non-zero and Railway restarts it using an ALWAYS restart policy. Because reservations become idempotently re-claimable by the stable executor identity, a process restart does not strand work.

### 6.2 Stable Dispatcher Identity

The existing GitHub executor derives dispatcherId from GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT. That makes a reservation non-recoverable by a later run.

Replace the per-run identity with a stable per-target-service identity generated by the shared executor code:

- atlas-production-deploy-executor:engineering-runner
- atlas-production-deploy-executor:engineering-verifier

The same identity is used whether the executor runs in GitHub Actions or Railway.

GitHub run IDs remain available in GitHub logs for operational correlation; they are no longer the authority or reservation identity.

### 6.3 Idempotent Same-Identity Re-Claim

Update the Supervisor dispatch claim behavior.

For an existing reservation:

- if reservation candidate, service, deterministic reservation ID, and reservedBy all exactly match the current claim, return claimed=true with the existing reservation;
- if the existing reservation belongs to any other identity or differs in candidate, service, or reservation identity, return claimed=false with reason already_reserved;
- consumed authorizations remain ineligible;
- malformed reservations remain fail-closed.

No TTL, reservation deletion, or cross-identity takeover is introduced.

This gives crash recovery while preserving exclusive ownership.

### 6.4 Ambiguous Post-Deploy Crash

There remains a narrow case:

1. Railway accepts serviceInstanceDeployV2;
2. executor loses the response or crashes before it records or observes the deployment;
3. restarted executor re-claims the same reservation and may create another exact-SHA deployment attempt.

This is safe because the existing deploy gate can consume the signed Human Owner authorization only once. At most one deployment can pass the authorization gate. Any duplicate attempt after consumption fails closed.

Exactly-once Railway deployment creation is not required for this version; exactly-once authorization consumption is preserved.

A future optimization may adopt an already-created exact-SHA Railway deployment before creating another one, but it is deliberately out of scope for this first liveness closure.

## 7. Production SHA Resolution

The repository is public.

fetchProductionSha will continue to require the exact repository identity h7ysqm48cq-beep/atlas-marketing-os, but GITHUB_TOKEN becomes optional:

- when GITHUB_TOKEN exists, send the authenticated request as today;
- when it is absent, read the public production/atlas ref without an Authorization header.

GITHUB_REPOSITORY remains required and must equal the hard-coded expected repository.

This avoids introducing an additional GitHub credential into the Railway worker.

## 8. Railway Credentials and Variables

The new Railway service receives only the minimum required values.

Non-secret:

- GITHUB_REPOSITORY=h7ysqm48cq-beep/atlas-marketing-os

Reference variables, without revealing their values:

- ATLAS_SUPERVISOR_API_URL references the API service ATLAS_SUPERVISOR_API_URL
- ATLAS_SUPERVISOR_CI_TOKEN references the API service ATLAS_SUPERVISOR_CI_TOKEN

Dedicated secret:

- ATLAS_RAILWAY_PRODUCTION_PROJECT_TOKEN

The project token must be scoped to the ATLAS production environment and used only by production-deploy-executor.

Railway currently documents project-token creation through the project Tokens UI; there is no supported API, MCP, or agent flow that creates this token and hands it directly into a variable without human handling. Therefore this token is the single expected manual bootstrap step.

After entry, it should be stored as a sealed service variable.

The existing GitHub Actions secret remains independent. The new Railway service does not need to reuse or reveal the GitHub Actions Railway token.

## 9. Railway Service Configuration

Expected service configuration:

- service name: production-deploy-executor
- source repository: h7ysqm48cq-beep/atlas-marketing-os
- source branch: production/atlas
- root: repository root
- replicas: 1
- start command: node tools/deployment/atlas-production-deploy-executor-daemon.mjs
- restart policy: ALWAYS
- no public domain required
- no database credentials
- no Human Owner token
- no merge-signing or deploy-signing private keys
- no engineering worker bootstrap credentials

The worker receives only the Supervisor CI credential and the dedicated Railway project token.

## 10. Expected Code Scope

### Deployment executor

tools/deployment/atlas-production-deploy-executor.mjs

- make GitHub token optional for public ref lookup;
- use stable dispatcher identity;
- keep service, project, environment, and SHA hard bounds unchanged.

tools/deployment/atlas-production-deploy-executor.test.mjs

- test authenticated and unauthenticated ref lookup;
- test repository mismatch rejection;
- test stable dispatcher identity;
- preserve not_found, already_reserved, exact-SHA deployment, token-scope, and polling tests.

### Daemon

tools/deployment/atlas-production-deploy-executor-daemon.mjs

- serialize cycles;
- run immediately at startup;
- sleep 60 seconds after a successful or no-op cycle;
- propagate unexpected executor failure so Railway restarts the process.

tools/deployment/atlas-production-deploy-executor-daemon.test.mjs

- immediate first cycle;
- serial cycles with no overlap;
- sleep between successful cycles;
- failure propagation;
- deterministic stop hook for tests.

### Supervisor dispatch claim

apps/api/src/agent-supervisor/gateway/agent-gateway.service.ts

- support same-identity idempotent re-claim of an exact existing reservation.

apps/api/src/agent-supervisor/gateway/production-deployment-dispatch.spec.ts

- same reservation plus same stable dispatcher returns claimed=true;
- same reservation plus different dispatcher returns already_reserved;
- service, candidate, or reservation mismatch fails closed;
- consumed authorization remains unavailable.

No change is expected to the reservation type or database schema.

## 11. Concurrency and Race Behavior

GitHub Actions and Railway may occasionally execute concurrently.

Both use the same stable dispatcher identity. The Supervisor reservation remains the serialization point.

If both race before the first reservation write commits, the existing optimistic task-write guard may cause one request to fail while the other succeeds. A later cycle sees the persisted exact reservation and idempotently re-claims it.

No new distributed lock is required.

The existing GitHub workflow concurrency group remains enabled.

## 12. Error Handling

Fail closed on:

- unexpected repository;
- invalid production SHA;
- Supervisor identity mismatch;
- unsupported service;
- missing or invalid reservation proof;
- Railway token project or environment mismatch;
- Railway deployment identity mismatch;
- Railway deployment SHA mismatch;
- non-success terminal deployment;
- malformed persisted reservation;
- cross-identity reservation ownership.

Safe no-op on:

- no matching authorization: not_found;
- reservation owned by a different identity: already_reserved.

Unexpected errors terminate the daemon process. Railway ALWAYS restart policy restores polling; stable reservation identity allows work to resume.

## 13. Testing

Before production rollout:

1. executor unit tests;
2. daemon unit tests;
3. Supervisor production-deployment dispatch tests;
4. relevant Supervisor gateway and service tests;
5. API build;
6. engineering-runner full tests and build;
7. existing production deploy executor workflow tests.

The implementation PR must use the normal ATLAS chain:

Task → implementation Execution → independent verifier → READY_FOR_REVIEW → Human Owner approval → signed merge authorization → GitHub gate → normal merge → trusted attestation consumption.

No bootstrap merge is permitted.

## 14. Rollout

### Phase A — Code

1. Implement and independently verify the code changes.
2. Merge normally to production/atlas.
3. Deploy the API through a fresh same-SHA qualification and signed production deployment authorization because Supervisor claim behavior changes.
4. Verify API production health.

### Phase B — Railway Worker

1. Create production-deploy-executor.
2. Bind the source to current production/atlas.
3. Configure non-secret repository identity.
4. Add Supervisor URL and CI-token reference variables.
5. Human creates one dedicated production-environment project token in Railway project settings.
6. Store the token as sealed ATLAS_RAILWAY_PRODUCTION_PROJECT_TOKEN.
7. Apply and deploy the new service.
8. Confirm terminal Railway SUCCESS.

### Phase C — Negative Canary

Precondition: no unconsumed deployment authorization exists.

Verify:

- Railway executor runs automatically;
- both services return claimed=false with reason not_found;
- no new runner or verifier Railway deployment ID is created.

### Phase D — Positive Canary

Create one fresh exact same-SHA qualification for one worker service and obtain normal Human Owner signed deployment authorization.

Do not trigger GitHub workflow_dispatch.

Verify:

1. Railway executor automatically discovers it;
2. claim returns claimed=true;
3. exact reservation is persisted;
4. exact-SHA Railway deployment is created;
5. deploy gate consumes the authorization;
6. deployment reaches SUCCESS;
7. the following daemon cycle returns not_found;
8. no second successful authorization consumption exists.

### Phase E — Backup Path

Run one manual GitHub workflow_dispatch with no pending authorization.

Verify it remains a no-op and is compatible with the stable dispatcher identity.

The GitHub schedule remains enabled as a secondary trigger unless a later design explicitly removes it.

## 15. Operational Monitoring

After rollout:

- extend the existing ATLAS Production Health Watch to include the new Railway service deployment and runtime state;
- notify only when the service is unavailable, repeatedly crashing, or unable to execute cycles;
- do not alert on normal not_found cycles.

This is monitoring only; it does not gain deployment authority.

## 16. Security Properties Preserved

The design preserves:

- Human Owner approval for production deployment;
- signed deployment authorization;
- exact candidate identity;
- canonical production SHA;
- service allow-list;
- project and environment token scope verification;
- atomic persisted dispatch reservation;
- single authorization consumption;
- existing deploy gate;
- independent implementation and verifier identities;
- no Ruleset bypass;
- no direct database authority mutation.

The liveness improvement changes who can resume the same authorized dispatch, not what may be deployed.

## 17. Completion Definition

This automation closure is complete only when:

- the continuous Railway executor is running in production;
- negative no-op canary passes;
- positive automatic claim, deploy, and consumption canary passes without manual GitHub dispatch;
- crash and restart reservation recovery is covered by tests;
- API and worker runtime are healthy;
- the backup GitHub executor remains fail-closed;
- the ATLAS Production Health Watch monitors the new executor.

Until those conditions are met, this design must not be reported as 100% liveness closure.
