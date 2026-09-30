# Production Deploy Executor Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a continuously running Railway production deploy executor that automatically consumes valid worker deployment authorizations even when GitHub scheduled Actions are delayed, while preserving exact-SHA, signed-authority, reservation, deploy-gate, and fail-closed guarantees.

**Architecture:** Keep the existing deploy executor as the single shared execution engine, but make its dispatcher identity stable across GitHub and Railway runs and allow public production-ref lookup without a GitHub token. Add a single-replica Railway daemon that invokes the executor serially every 60 seconds. Extend the Supervisor dispatch claim so the same stable dispatcher can idempotently re-claim its own exact persisted reservation after a crash, while any different dispatcher remains blocked.

**Tech Stack:** Node.js ESM, NestJS/TypeScript, Jest, Node test runner, GitHub Actions, Railway, ATLAS Supervisor, GitHub REST API.

**Spec:** `docs/superpowers/specs/2026-09-30-production-deploy-executor-liveness-design.md`

## Global Constraints

- Implementation mutation must be published by a fresh ATLAS Supervisor implementation Execution; local agents may inspect and preflight, but must not publish an authoritative candidate outside the Supervisor chain.
- Production branch remains exactly `production/atlas`.
- Supported executor services remain exactly `engineering-runner` and `engineering-verifier`.
- Railway project remains `693a96a8-fb2f-4e6d-af3b-fa2b54da49fc`.
- Railway production environment remains `62379618-8890-40fb-bff8-2db75c57027c`.
- Existing worker Railway service IDs remain unchanged.
- No database schema change.
- No reservation TTL and no reservation release endpoint.
- No cross-identity reservation takeover.
- No Ruleset bypass, force push, squash, rebase, or bootstrap merge.
- Signed Human Owner deployment authorization remains single-consumption through the existing deploy gate.
- `GITHUB_REPOSITORY` remains required and must equal `h7ysqm48cq-beep/atlas-marketing-os`.
- `GITHUB_TOKEN` becomes optional only for reading the public `production/atlas` ref.
- Stable dispatcher IDs are exactly:
  - `atlas-production-deploy-executor:engineering-runner`
  - `atlas-production-deploy-executor:engineering-verifier`
- Railway daemon interval is exactly `60_000` ms.
- Railway daemon runs as one replica with restart policy `ALWAYS`.
- GitHub Actions executor remains enabled as a backup/manual path.
- The new Railway project token is created manually in Railway Project Settings → Tokens, scoped to production, and entered directly into the new service variable; do not paste it into chat or expose its plaintext.
- The liveness closure is not 100% until negative canary, positive automatic canary, backup-path no-op canary, runtime health, and monitoring all pass.

## Review Focus

1. **Crash after reservation, before Railway deploy creation:** same stable dispatcher must recover the exact reservation and return `claimed=true`; covered in Task 1.
2. **Concurrent or later different dispatcher:** different identity must receive `already_reserved` and must never gain the reservation; covered in Task 1.
3. **Railway worker without `GITHUB_TOKEN`:** public production-ref lookup must work while repository mismatch still fails closed; covered in Task 2.
4. **Daemon cycle failure or overlap:** cycles must serialize, and unexpected executor failure must terminate the daemon so Railway can restart it rather than busy-loop; covered in Task 3.
5. **Ambiguous post-deploy crash:** a repeat deployment attempt may be created, but only one signed authorization may pass the deploy gate; covered by existing deploy-gate consumption tests plus the positive production canary in Task 6.

---

### Task 1: Make Supervisor Dispatch Reservation Re-Claim Idempotent for the Same Stable Identity

**Files:**
- Modify: `apps/api/src/agent-supervisor/gateway/agent-gateway.service.ts:438-585`
- Modify: `apps/api/src/agent-supervisor/gateway/production-deployment-dispatch.spec.ts:220-315`

**Interfaces:**
- Consumes: `ProductionDeploymentDispatchClaimInput { service, github, dispatcherId }`
- Produces: unchanged `claimProductionDeploymentDispatch(input): Promise<ProductionDeploymentDispatchClaimResult>`
- Preserves: deterministic `productionDeploymentDispatchReservationId(taskId, service, sha)`

- [ ] **Step 1: Add the failing same-identity re-claim test**

Add test:

`it('idempotently reclaims the exact reservation for the same stable dispatcher identity', ...)`

Assertions:
- create and approve one ready `engineering-runner` deployment;
- first claim uses dispatcher `atlas-production-deploy-executor:engineering-runner`;
- second claim uses the exact same dispatcher;
- both results have `claimed=true`, `reason=null`;
- second result returns the same `taskId`, `executionId`, and `reservationId` as the first;
- persisted reservation `reservedBy` stays the stable dispatcher ID;
- persisted reservation `reservedAt` is unchanged after the second claim;
- Owner deployment authorization remains unconsumed.

- [ ] **Step 2: Run the new test and verify the current implementation fails**

Run:

`npm test --workspace apps/api -- --runInBand production-deployment-dispatch.spec.ts`

Expected: the new same-identity re-claim test fails because the current code returns `claimed=false, reason='already_reserved'`.

- [ ] **Step 3: Strengthen the existing cross-identity test**

Rename or replace the existing “never claims the same approved deployment twice” case with:

`it('does not allow a different dispatcher identity to take an existing reservation', ...)`

Assertions:
- first claim uses `atlas-production-deploy-executor:engineering-runner`;
- second claim uses a different valid identity such as `other-dispatcher:engineering-runner`;
- second result is `claimed=false`, `reason='already_reserved'`;
- persisted reservation still belongs to the stable ATLAS executor identity.

- [ ] **Step 4: Implement idempotent exact re-claim**

In `claimProductionDeploymentDispatch()`:

- compute the deterministic `reservationId` before evaluating an existing reservation;
- when `ownerDeploymentDispatchReservation` exists, normalize its candidate;
- return `claimed=true` with the existing reservation only when all are exact:
  - reservation ID equals deterministic `reservationId`;
  - `reservedBy === dispatcherId`;
  - reservation service equals requested service;
  - reservation candidate equals the validated review candidate;
- otherwise return the existing safe no-op result `claimed=false, reason='already_reserved'`;
- do not rewrite `reservedAt` during an idempotent re-claim.

- [ ] **Step 5: Run Supervisor dispatch tests**

Run:

`npm test --workspace apps/api -- --runInBand production-deployment-dispatch.spec.ts`

Expected: PASS.

- [ ] **Step 6: Run production deployment resolver regression tests**

Run:

`npm test --workspace apps/api -- --runInBand production-deployment-resolver.spec.ts`

Expected: PASS, including single deploy-gate consumption after a persisted reservation.

**Supervisor implementation checkpoint:** This task is part of the single authoritative implementation Execution. Do not publish a separate candidate commit outside ATLAS Supervisor.

---

### Task 2: Make the Shared Executor Railway-Compatible Without Weakening Bounds

**Files:**
- Modify: `tools/deployment/atlas-production-deploy-executor.mjs:100-188`
- Modify: `tools/deployment/atlas-production-deploy-executor.test.mjs`

**Interfaces:**
- Produces: `export function dispatcherIdFor(service): string`
- Preserves: `fetchProductionSha(env, fetchImpl)`
- Preserves: `claimDispatch(env, service, sha, fetchImpl)`
- Preserves: `execute(env, options)`

- [ ] **Step 1: Add failing test for public ref lookup without a GitHub token**

Add test:

`test('fetchProductionSha reads the public production ref without GITHUB_TOKEN', ...)`

Assertions:
- env includes exact `GITHUB_REPOSITORY`;
- env omits `GITHUB_TOKEN`;
- request URL is the exact public production ref endpoint;
- request headers do not contain `authorization`;
- returned SHA must still match the full 40-hex production SHA rule.

- [ ] **Step 2: Add failing test that authenticated lookup still uses Bearer auth**

Add test:

`test('fetchProductionSha uses Bearer auth when GITHUB_TOKEN is present', ...)`

Assertion: request has `authorization: Bearer <token>`.

- [ ] **Step 3: Add failing repository mismatch test**

Add or preserve test:

`test('fetchProductionSha rejects any repository other than the frozen ATLAS repository', ...)`

Expected: throws `unexpected GitHub repository` before accepting a SHA.

- [ ] **Step 4: Implement optional GitHub Authorization**

In `fetchProductionSha(env, fetchImpl)`:

- continue to require and validate `GITHUB_REPOSITORY`;
- read `GITHUB_TOKEN` as optional trimmed input;
- always send `accept` and `x-github-api-version`;
- add `authorization` only when a non-empty token exists;
- preserve 15-second request timeout and full-SHA validation.

- [ ] **Step 5: Add failing stable dispatcher identity tests**

Add test:

`test('claimDispatch uses the stable ATLAS executor dispatcher identity', ...)`

For each supported service assert the POST body contains exactly:
- `atlas-production-deploy-executor:engineering-runner`;
- `atlas-production-deploy-executor:engineering-verifier`.

Also assert `claimDispatch` succeeds without `GITHUB_RUN_ID` or `GITHUB_RUN_ATTEMPT`.

- [ ] **Step 6: Implement `dispatcherIdFor(service)`**

Add:

`export function dispatcherIdFor(service)`

Behavior:
- accept only an entry that matches the frozen `SERVICES` allow-list by name and ID;
- return `atlas-production-deploy-executor:${service.name}`;
- throw `unsupported executor service` for any other input.

Change `claimDispatch` to use this helper and remove the `GITHUB_RUN_ID` / `GITHUB_RUN_ATTEMPT` requirements.

- [ ] **Step 7: Run executor tests**

Run:

`node --test tools/deployment/atlas-production-deploy-executor.test.mjs`

Expected: PASS, including existing exact-SHA deploy, wrong-project token rejection, already-reserved no-op, failed Railway deployment, wrong commit evidence, and unsupported service tests.

**Supervisor implementation checkpoint:** Keep project/environment/service constants unchanged.

---

### Task 3: Add the Continuous Railway Daemon

**Files:**
- Create: `tools/deployment/atlas-production-deploy-executor-daemon.mjs`
- Create: `tools/deployment/atlas-production-deploy-executor-daemon.test.mjs`

**Interfaces:**
- Consumes: `execute(env, options)` from `atlas-production-deploy-executor.mjs`
- Produces:

`export async function runDaemon(env = process.env, { executeCycle = execute, sleep = defaultSleep, intervalMs = 60_000, logger = console, signal } = {})`

- [ ] **Step 1: Write the failing immediate-first-cycle test**

Add test:

`test('daemon executes immediately before its first sleep', ...)`

Use an injected `executeCycle`, `sleep`, and `AbortController`.

Assertions:
- `executeCycle` is called once before `sleep`;
- first sleep receives exactly `60_000`;
- abort after the first sleep stops the loop cleanly.

- [ ] **Step 2: Write the failing serial-cycle test**

Add test:

`test('daemon never overlaps executor cycles', ...)`

Assertions:
- run two cycles using injected async stubs;
- maximum observed concurrent `executeCycle` calls is exactly 1;
- second cycle starts only after the first cycle and sleep complete.

- [ ] **Step 3: Write the failing error-propagation test**

Add test:

`test('daemon propagates an unexpected executor failure without sleeping or retrying in-process', ...)`

Assertions:
- injected `executeCycle` throws a sentinel error;
- `runDaemon` rejects with the same error;
- injected `sleep` is never called.

- [ ] **Step 4: Implement `runDaemon`**

Rules:
- immediate first cycle;
- one cycle at a time;
- after a successful or no-op `executeCycle`, sleep exactly `intervalMs`;
- default `intervalMs=60_000`;
- if `signal?.aborted`, exit cleanly before starting another cycle;
- do not catch and retry executor failures inside the loop.

- [ ] **Step 5: Add CLI entrypoint behavior**

When the daemon file is executed directly:
- call `runDaemon()`;
- on rejection log `ATLAS_PRODUCTION_DEPLOY_EXECUTOR_DAEMON_FAILED` with only the safe error message;
- exit non-zero so Railway restart policy handles recovery.

- [ ] **Step 6: Run daemon tests**

Run:

`node --test tools/deployment/atlas-production-deploy-executor-daemon.test.mjs`

Expected: PASS.

**Supervisor implementation checkpoint:** No timer overlaps and no internal infinite retry on failure.

---

### Task 4: Publish One Governed Candidate and Run the Full Verification Matrix

**Files allowed in the authoritative implementation Task:**
- `apps/api/src/agent-supervisor/gateway/agent-gateway.service.ts`
- `apps/api/src/agent-supervisor/gateway/production-deployment-dispatch.spec.ts`
- `tools/deployment/atlas-production-deploy-executor.mjs`
- `tools/deployment/atlas-production-deploy-executor.test.mjs`
- `tools/deployment/atlas-production-deploy-executor-daemon.mjs`
- `tools/deployment/atlas-production-deploy-executor-daemon.test.mjs`

**Interfaces:**
- Consumes Tasks 1–3 requirements.
- Produces one Supervisor-published candidate commit based on the fresh canonical `production/atlas` SHA.

- [ ] **Step 1: Fresh-read the canonical production SHA**

Read `production/atlas` immediately before Task creation.

Expected: use the current SHA, not the design-time SHA, if production has advanced.

- [ ] **Step 2: Create one fresh Supervisor implementation Task**

Task requirements:
- owner: engineering;
- allowedPaths: exactly the six files above;
- frozen base: fresh canonical production SHA;
- no database schema, migration, runtime-config, deploy, merge, rebase, squash, force-push, or branch deletion authority;
- acceptance includes every test command below.

- [ ] **Step 3: Dispatch the implementation Execution**

The engineering-runner is the only authoritative code publisher.

Expected result:
- one candidate head;
- exact allowed path set;
- no unrelated file mutation;
- candidate publication evidence present.

- [ ] **Step 4: Run the complete verification matrix against the candidate**

Run:

`node --test tools/deployment/atlas-production-deploy-executor.test.mjs`

`node --test tools/deployment/atlas-production-deploy-executor-daemon.test.mjs`

`npm test --workspace apps/api -- --runInBand production-deployment-dispatch.spec.ts production-deployment-resolver.spec.ts agent-gateway.service.spec.ts supervisor-gateway.controller.spec.ts agent-supervisor.service.spec.ts`

`npm run build --workspace apps/api`

`npm test --workspace apps/engineering-runner`

`npm run build --workspace apps/engineering-runner`

Expected: all PASS.

- [ ] **Step 5: Verify the candidate diff**

Assertions:
- base equals frozen canonical production SHA;
- exactly six changed files;
- no Railway config, workflow, DB, Ruleset, or unrelated application file changes.

- [ ] **Step 6: Dispatch independent verifier**

Verifier acceptance:
- exact base/head/path scope;
- tests/build evidence;
- implementation runner and verifier runner identities are distinct;
- `sourceVerified=true`;
- candidate publication identity exact.

- [ ] **Step 7: Adopt verifier evidence and stop at READY_FOR_REVIEW**

Do not approve or merge until human review confirms the exact candidate and evidence.

---

### Task 5: Merge the Production Change Through the Normal ATLAS Governance Chain

**Files:** No new code edits expected.

**Interfaces:**
- Consumes: Task 4 verified candidate.
- Produces: merged `production/atlas` SHA with trusted merge-attestation consumption and API runtime containing the new Supervisor dispatch behavior.

- [ ] **Step 1: Create or verify a Draft PR targeting `production/atlas`**

PR body must bind:
- Supervisor Task ID;
- implementation Execution ID;
- verification Execution ID;
- exact base SHA;
- exact head SHA;
- exact six-file scope.

- [ ] **Step 2: Human Owner approves the verified Task and signs exact merge authorization**

Authorization must bind the exact reviewed candidate.

- [ ] **Step 3: Mark the PR Ready**

- [ ] **Step 4: Wait for the latest GitHub gate run**

Required latest-run checks:
- `atlas-supervisor-gate = success`;
- `api-verification = success`.

Do not use an older successful run as substitute evidence.

- [ ] **Step 5: Fresh no-drift check**

Verify:
- production branch still equals authorized base;
- PR head still equals authorized head;
- changed file set still equals six;
- PR is mergeable;
- no Ruleset or bypass change.

- [ ] **Step 6: Merge with normal GitHub merge commit**

Use merge method `merge` only.

- [ ] **Step 7: Verify trusted merge attestation consumption**

Read Supervisor Task evidence.

Expected:
- `ownerMergeAuthorizationConsumption` exists;
- `consumedBy=ci-gate`;
- merged PR number, merge commit SHA, parents, and mergedAt are recorded.

- [ ] **Step 8: Qualify and deploy the API at the new exact production SHA**

Because Supervisor dispatch behavior changed:
- create fresh zero-diff API same-SHA qualification;
- independent verifier must return `sourceVerified=true`;
- move Task to READY_FOR_REVIEW;
- Human Owner approve and sign exact API deployment authorization;
- allow one normal Railway same-SHA API deployment or redeploy;
- verify deploy gate consumes authorization;
- verify Railway API reaches `SUCCESS` at exact SHA;
- verify `/system-health` remains healthy.

---

### Task 6: Create the Railway Continuous Executor and Prove Liveness End to End

**Railway target:**
- Project: `693a96a8-fb2f-4e6d-af3b-fa2b54da49fc`
- Environment: production `62379618-8890-40fb-bff8-2db75c57027c`
- New service: `production-deploy-executor`

**Interfaces:**
- Consumes: merged production code from Task 5.
- Produces: one continuously running Railway worker, production canary receipts, and updated Production Health Watch.

- [ ] **Step 1: Create the Railway service without secrets**

Create `production-deploy-executor`.

Configure:
- source repository: `h7ysqm48cq-beep/atlas-marketing-os`;
- branch: `production/atlas`;
- replicas: 1;
- start command: `node tools/deployment/atlas-production-deploy-executor-daemon.mjs`;
- restart policy: `ALWAYS`;
- no public domain.

Do not deploy successfully yet if the required project token is absent.

- [ ] **Step 2: Configure non-secret and reference variables**

Set:
- `GITHUB_REPOSITORY=h7ysqm48cq-beep/atlas-marketing-os`;
- `ATLAS_SUPERVISOR_API_URL` as a Railway reference to the API service value;
- `ATLAS_SUPERVISOR_CI_TOKEN` as a Railway reference to the API service value.

Do not expose referenced values.

- [ ] **Step 3: Human performs the one manual token bootstrap**

In Railway Project Settings → Tokens:
- create one project token scoped to the production environment;
- enter it directly into the new service variable `ATLAS_RAILWAY_PRODUCTION_PROJECT_TOKEN`;
- do not paste the token into chat.

This is the only expected manual secret bootstrap.

- [ ] **Step 4: Deploy the new service and verify startup**

Expected:
- Railway deployment reaches `SUCCESS`;
- service is sourced from the current `production/atlas` SHA;
- daemon starts without a public endpoint;
- first cycle executes automatically.

- [ ] **Step 5: Run the negative production canary**

Precondition: confirm unconsumed production deployment authorization count is 0.

Record runner/verifier latest Railway deployment IDs.

Wait for at least one daemon cycle.

Verify:
- runner claim: `claimed=false, reason=not_found`;
- verifier claim: `claimed=false, reason=not_found`;
- runner/verifier deployment IDs do not change;
- no Owner deployment authorization consumption is created.

- [ ] **Step 6: Prove restart recovery without consuming a real deployment**

Use automated tests from Task 1/3 as the authoritative crash-after-reservation proof. In production, restart the daemon only when no pending authorization exists and verify it returns to healthy polling.

Do not deliberately crash between reservation and a real deploy request in production.

- [ ] **Step 7: Create the positive production canary authorization**

Choose exactly one worker service.

Create a fresh same-SHA qualification for the current canonical production SHA:
- exact base=head=current production SHA;
- changedFiles=[];
- service exact;
- independent verifier `sourceVerified=true`;
- Human Owner approves and signs one deployment authorization.

Do **not** invoke GitHub `workflow_dispatch`.

- [ ] **Step 8: Verify automatic Railway-worker consumption**

Without manual executor trigger, verify:
- daemon discovers the authorization;
- claim is `claimed=true`;
- exact Task/Execution/reservation IDs persist;
- Railway exact-SHA worker deployment is created;
- deploy gate consumes the signed authorization;
- deployment reaches exact-SHA `SUCCESS`;
- the following daemon cycle returns `not_found`;
- only one successful authorization consumption exists.

- [ ] **Step 9: Verify GitHub backup path**

With pending authorization count back at 0:

Run one manual `atlas-production-deploy-executor.yml` `workflow_dispatch` from current main.

Expected:
- workflow succeeds;
- both services return `not_found`;
- no new worker deployment is created.

Keep the GitHub schedule enabled.

- [ ] **Step 10: Update ATLAS Production Health Watch**

Update automation ID `6ab997297c0481919ac50959f0a40cf0`.

Preserve the existing external `/system-health` check and add:
- read current Railway `production-deploy-executor` service/deployment state;
- notify only if the service is unavailable, repeatedly crashing, or unable to run cycles;
- normal `not_found` cycles are healthy and must not notify.

Do not add deployment authority to the monitoring automation.

- [ ] **Step 11: Final closure readback**

Fresh-read:
- `main`;
- `production/atlas`;
- Ruleset `21955940`;
- open PR count;
- active Supervisor Task count;
- pending deployment authorization count;
- API / web / browser-worker / runner / verifier / production-deploy-executor Railway states;
- `/system-health`;
- latest negative, positive, and backup canary receipts.

Declare scheduler liveness closure 100% only when every completion condition in the approved spec is proven.
