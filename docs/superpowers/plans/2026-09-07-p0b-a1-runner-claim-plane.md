# P0B-A1 Runner Claim Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P0B-A1 transport/security/concurrency foundation so a dedicated Railway `engineering-runner` can safely claim one synthetic `IMPLEMENTATION` execution, maintain a lease, receive fenced execution capabilities, heartbeat, and submit a server-enforced no-op completion without launching a real Engineering Agent or mutating the repository.

**Architecture:** The API remains the only database authority. A Railway worker process authenticates with a dedicated Runner bootstrap credential, atomically claims the oldest eligible `A1_SYNTHETIC` `DISPATCHED` execution using PostgreSQL `FOR UPDATE SKIP LOCKED`, receives a capability bound to `runnerId + claimEpoch`, renews the lease every 30 seconds, and is immediately fenced when database ownership changes. Claim-plane endpoints are distinct from Worker Capability endpoints. The production Runner is disabled by default and A1 never enables `STANDARD` work.

**Tech Stack:** NestJS 11, TypeScript 5.7, Prisma 7.9.1, PostgreSQL, Jest 29, Node.js 22, Railway.

**Spec:** `docs/superpowers/specs/2026-09-07-p0b-a1-runner-claim-plane-design.md`

**Approved security amendment V1 (2026-09-07):** `engineering-runner` must never receive `ATLAS_SUPERVISOR_CI_TOKEN`. Add a separate read-only `ATLAS_SUPERVISOR_DEPLOY_RESOLVER_TOKEN` credential for `POST /engineering/supervisor/gateway/production-deployment/resolve`; this credential cannot create/revoke authorization, claim work, complete work, merge, deploy, or impersonate Owner/CI/Runner identities.

## Global Constraints

- Canonical implementation base is the exact approved `production/atlas` SHA selected at execution time; do not implement directly on the design branch.
- Before implementation, use `superpowers:using-git-worktrees` and create an isolated worktree/branch from the frozen base.
- P0B-A1 must not launch Codex, ChatGPT Work coding, or any other real Engineering Agent.
- P0B-A1 Runner must not perform Git checkout/worktree creation, source edits, commit, push, PR creation, merge, or deployment execution.
- Runner has no Owner credential, no CI credential, no GitHub write credential, and no production deployment authorization material.
- `ATLAS_SUPERVISOR_RUNNER_TOKEN` authorizes only claim-plane operations.
- `ATLAS_SUPERVISOR_DEPLOY_RESOLVER_TOKEN` authorizes only read-only production-deployment resolution.
- Lease duration is exactly 120 seconds; normal heartbeat interval is exactly 30 seconds; idle polling is exactly 5 seconds.
- Every new claim/reclaim increments `claimEpoch`; heartbeat never increments it.
- Claim does not change `DISPATCHED` to `RUNNING`; only explicit Worker API `mark-running` does.
- Expired `DISPATCHED` may be reclaimed; expired `RUNNING` must never be automatically reclaimed or replayed.
- A Runner process may own at most one live `DISPATCHED` execution or any `RUNNING` execution at a time. An expired same-runner `DISPATCHED` claim is recoverable only by reclaiming that same execution with a higher epoch.
- A1 production claim eligibility is exactly `executionPurpose=IMPLEMENTATION` plus `runnerEligibility=A1_SYNTHETIC`; missing eligibility fails closed; `STANDARD` remains unclaimable.
- Synthetic completion must enforce zero changed files, deployment `NONE`, Git `UNCHANGED`, no review candidate, no merge/deployment authorization evidence, and must not advance the parent task.
- No credential, capability token, authorization signature, or raw credential header may enter logs.
- Ambiguous writes are reconciled before retry. `mark-running`, `complete`, `fail`, and `release` are never blindly retried after an ambiguous network outcome. Heartbeat is the only claim-plane write that may be repeated within the same `runnerId + claimEpoch` because it is a bounded lease renewal and cannot create a second execution or increment epoch.
- Deployment authorization, deployment, Runner enablement, and real execution remain separate future governance actions.
- This implementation plan does not authorize Railway variable changes. Switching the shared preDeploy resolver script to V1 creates a future rollout dependency: every production service that executes that script must receive `ATLAS_SUPERVISOR_DEPLOY_RESOLVER_TOKEN` before its next deployment. That Railway mutation requires separate authorization.

---

## File Structure

### API domain and persistence

- Modify `apps/api/src/agent-supervisor/execution/supervisor-execution.types.ts` — Runner eligibility and persisted claim fields.
- Modify `apps/api/src/agent-supervisor/worker/supervisor-worker-capability.types.ts` — capability claims bind Runner identity and epoch.
- Modify `apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.ts` — preserve execution purpose, eligibility, capability metadata, and claim fields across DB round-trips.
- Create `apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.spec.ts` — focused mapper round-trip contract.
- Modify `apps/api/src/agent-supervisor/stores/memory-supervisor-execution.store.ts` and its spec — clone new claim fields correctly.

### Prisma

- Modify `apps/api/prisma/schema.prisma` — five claim fields plus claim-selection index.
- Create `apps/api/prisma/migrations/20260907090000_p0b_a1_runner_claim_plane/migration.sql` — columns, claim index, and partial unique active-owner index.
- Regenerate committed Prisma client under `apps/api/src/generated/prisma/**` using the repository’s pinned Prisma 7.9.1 flow.

### Runner authentication and claim plane

- Create `apps/api/src/agent-supervisor/runner/supervisor-runner.guard.ts` and spec — validate dedicated Runner token and per-process Runner ID.
- Create `apps/api/src/agent-supervisor/runner/supervisor-runner-claim.service.ts` and spec — atomic claim, heartbeat, release, fencing, audit events.
- Create `apps/api/src/agent-supervisor/runner/supervisor-runner.controller.ts` and spec — HTTP contract.
- Modify `apps/api/src/agent-supervisor/agent-supervisor.module.ts` and module spec — register new controller/guards/services.

### Worker Capability and execution lifecycle

- Modify `apps/api/src/agent-supervisor/worker/supervisor-worker-capability.service.ts` and spec — issue/authorize claim-bound capability version 2.
- Modify `apps/api/src/agent-supervisor/worker/supervisor-worker.guard.ts` and spec — DB-current `claimedBy + claimEpoch + lease` are mandatory for Worker writes.
- Modify `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.ts` and spec — explicit `runnerEligibility`, no dispatch-time Runner capability, synthetic evidence contract.
- Modify `apps/api/src/agent-supervisor/agent-supervisor.controller.ts` and controller spec — Owner dispatch can explicitly create synthetic execution while defaulting normal dispatch to `STANDARD`.

### Deployment resolver amendment V1

- Create `apps/api/src/agent-supervisor/gateway/supervisor-deploy-resolver.guard.ts` and spec.
- Modify `apps/api/src/agent-supervisor/gateway/supervisor-gateway.controller.ts` and spec — `/production-deployment/resolve` uses only resolver credential; other gateway routes remain CI-authenticated.
- Modify `apps/api/src/agent-supervisor/agent-supervisor.types.ts` — add `engineering-runner` to `ProductionDeploymentService`.
- Modify `apps/api/src/agent-supervisor/deployment/production-deployment-gate.service.ts` and spec — accept exact `engineering-runner` service identity.
- Modify `apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.ts` — allow persisted deployment authorization service `engineering-runner`.
- Modify `apps/api/scripts/check-production-deployment-gate.cjs` and create `apps/api/scripts/check-production-deployment-gate.test.cjs` — use deploy-resolver credential/header and include `engineering-runner`.

### Railway engineering Runner skeleton

- Create `apps/engineering-runner/package.json`.
- Create `apps/engineering-runner/tsconfig.json`.
- Create `apps/engineering-runner/Dockerfile`.
- Create `apps/engineering-runner/railway.json`.
- Create `apps/engineering-runner/src/runner-client.ts` and spec.
- Create `apps/engineering-runner/src/runner-loop.ts` and spec.
- Create `apps/engineering-runner/src/index.ts`.

### Real PostgreSQL verification

- Create `apps/api/src/agent-supervisor/runner/supervisor-runner-claim.integration.spec.ts` — real PostgreSQL concurrency/lease/index tests using a dedicated local Prisma Postgres instance only.

---

### Task 1: Freeze Runner Domain Types and Persistence Round-Trip

**Files:**
- Modify: `apps/api/src/agent-supervisor/execution/supervisor-execution.types.ts`
- Modify: `apps/api/src/agent-supervisor/worker/supervisor-worker-capability.types.ts`
- Modify: `apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.ts`
- Create: `apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.spec.ts`
- Modify: `apps/api/src/agent-supervisor/stores/memory-supervisor-execution.store.ts`
- Modify: `apps/api/src/agent-supervisor/stores/memory-supervisor-execution.store.spec.ts`

**Interfaces:**
- Produces: `RunnerEligibility`, claim-bearing `SupervisorExecution`, capability claims containing `runnerId` and `claimEpoch`.
- Consumed by: every later claim/capability/controller task.

- [ ] **Step 1: Write failing mapper/type tests**

Add fixtures that contain all of the following and assert no field is dropped after mapping/cloning:

```ts
const execution: SupervisorExecution = {
  id: 'ATLAS-EXEC-TEST',
  taskId: 'ATLAS-TASK-TEST',
  workerRole: 'engineering',
  status: 'DISPATCHED',
  assignment: {
    executionId: 'ATLAS-EXEC-TEST',
    taskId: 'ATLAS-TASK-TEST',
    workerRole: 'engineering',
    executionPurpose: 'IMPLEMENTATION',
    runnerEligibility: 'A1_SYNTHETIC',
    objective: 'validate runner claim plane',
    allowedPaths: [],
    forbiddenActions: ['merge'],
    dependencies: [],
    acceptance: ['synthetic lifecycle passes'],
    requiredEvidence: ['rootCause'],
    workerCapability: {
      version: 2,
      assignmentDigest: 'a'.repeat(64),
      allowedOperations: ['mark_running', 'complete'],
      issuedAt: '2026-09-07T00:00:00.000Z',
      expiresAt: '2026-09-07T00:05:00.000Z',
    },
  },
  result: null,
  error: null,
  claimedBy: 'engineering-runner:11111111-1111-4111-8111-111111111111',
  claimEpoch: 4,
  claimedAt: new Date('2026-09-07T00:00:00.000Z'),
  leaseExpiresAt: new Date('2026-09-07T00:02:00.000Z'),
  lastHeartbeatAt: new Date('2026-09-07T00:00:30.000Z'),
  createdAt: new Date('2026-09-07T00:00:00.000Z'),
  startedAt: null,
  completedAt: null,
};
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/persistence/supervisor-persistence.mapper.spec.ts \
  agent-supervisor/stores/memory-supervisor-execution.store.spec.ts
```

Expected: FAIL because claim/eligibility/capability-v2 fields do not yet exist or are dropped.

- [ ] **Step 3: Add exact domain fields**

```ts
export type RunnerEligibility = 'A1_SYNTHETIC' | 'STANDARD';

export interface WorkerAssignmentEnvelope {
  executionId: string;
  taskId: string;
  workerRole: SupervisorWorkerRole;
  executionPurpose?: SupervisorExecutionPurpose;
  runnerEligibility?: RunnerEligibility;
  objective: string;
  allowedPaths: string[];
  forbiddenActions: SupervisorAction[];
  dependencies: string[];
  acceptance: string[];
  requiredEvidence: RequiredEvidenceField[];
  workerCapability?: SupervisorWorkerCapabilityMetadata;
}

export interface SupervisorExecution {
  id: string;
  taskId: string;
  workerRole: SupervisorWorkerRole;
  status: SupervisorExecutionStatus;
  assignment: WorkerAssignmentEnvelope;
  result: WorkerExecutionResult | null;
  error: string | null;
  claimedBy: string | null;
  claimEpoch: number;
  claimedAt: Date | null;
  leaseExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}
```

Capability metadata/claims become version 2:

```ts
export interface SupervisorWorkerCapabilityMetadata {
  version: 2;
  assignmentDigest: string;
  allowedOperations: SupervisorWorkerCapabilityOperation[];
  issuedAt: string;
  expiresAt: string;
}

export interface SupervisorWorkerCapabilityClaims
  extends SupervisorWorkerCapabilityMetadata {
  taskId: string;
  executionId: string;
  workerRole: SupervisorWorkerRole;
  executionPurpose: SupervisorExecutionPurpose;
  runnerId: string;
  claimEpoch: number;
}
```

Extend `SupervisorWorkerCapabilityAuthorizationInput` with:

```ts
claimedBy: string | null;
claimEpoch: number;
leaseExpiresAt: Date | null;
```

- [ ] **Step 4: Fix persistence mapping and memory cloning**

`mapAssignment()` must preserve `executionPurpose`, `runnerEligibility`, and the complete `workerCapability` metadata. `mapExecutionRecord()` must preserve all five claim fields. Missing `runnerEligibility` remains `undefined`; never infer it as synthetic.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 6: Commit the independently testable domain/persistence contract**

```bash
git add apps/api/src/agent-supervisor/execution \
  apps/api/src/agent-supervisor/worker/supervisor-worker-capability.types.ts \
  apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.ts \
  apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.spec.ts \
  apps/api/src/agent-supervisor/stores/memory-supervisor-execution.store.ts \
  apps/api/src/agent-supervisor/stores/memory-supervisor-execution.store.spec.ts
git commit -m "refactor(supervisor): model runner claim ownership"
```

---

### Task 2: Add Minimal Prisma Claim Persistence

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260907090000_p0b_a1_runner_claim_plane/migration.sql`
- Regenerate: `apps/api/src/generated/prisma/**`
- Modify: `apps/api/src/agent-supervisor/persistence/prisma-supervisor-execution.store.ts`
- Modify: `apps/api/src/agent-supervisor/persistence/prisma-supervisor-execution.store.spec.ts`

**Interfaces:**
- Consumes: Task 1 claim-bearing `SupervisorExecution`.
- Produces: database columns and uniqueness/index guarantees required by atomic claim.

- [ ] **Step 1: Write failing Prisma-store tests for claim fields**

Extend fake delegate records and create/update assertions so all five claim fields are round-tripped.

- [ ] **Step 2: Run the Prisma-store test and verify RED**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/persistence/prisma-supervisor-execution.store.spec.ts
```

Expected: FAIL because create/update record shapes omit the claim fields.

- [ ] **Step 3: Extend `SupervisorExecution` schema exactly**

```prisma
claimedBy       String?
claimEpoch      Int       @default(0)
claimedAt       DateTime?
leaseExpiresAt  DateTime?
lastHeartbeatAt DateTime?

@@index([status, leaseExpiresAt, createdAt])
```

Keep the existing task indexes unchanged.

- [ ] **Step 4: Create migration SQL**

```sql
ALTER TABLE "SupervisorExecution"
  ADD COLUMN "claimedBy" TEXT,
  ADD COLUMN "claimEpoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);

CREATE INDEX "SupervisorExecution_status_leaseExpiresAt_createdAt_idx"
ON "SupervisorExecution"("status", "leaseExpiresAt", "createdAt");

CREATE UNIQUE INDEX "SupervisorExecution_one_active_per_runner"
ON "SupervisorExecution"("claimedBy")
WHERE "claimedBy" IS NOT NULL
  AND "status" IN ('DISPATCHED', 'RUNNING');
```

Do not replace the existing `SupervisorExecution_one_active_per_task` partial unique index.

- [ ] **Step 5: Update Prisma store record/create/update shapes**

Add the five claim fields to `SupervisorExecutionRecord`, create data, update data, and mapping. Preserve `claimEpoch` on release and terminal records.

- [ ] **Step 6: Regenerate committed Prisma client with pinned Prisma CLI**

From `apps/api`:

```bash
npx prisma generate --config ../../prisma.config.ts
npm run check:prisma-generated --workspace apps/api
```

Expected: reproducibility guard PASS with no second-generation drift.

- [ ] **Step 7: Run focused persistence tests and build**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/persistence/prisma-supervisor-execution.store.spec.ts \
  agent-supervisor/persistence/supervisor-persistence.mapper.spec.ts
npm run build --workspace apps/api
```

Expected: PASS.

- [ ] **Step 8: Commit schema + migration + generated client together**

```bash
git add apps/api/prisma \
  apps/api/src/generated/prisma \
  apps/api/src/agent-supervisor/persistence/prisma-supervisor-execution.store.ts \
  apps/api/src/agent-supervisor/persistence/prisma-supervisor-execution.store.spec.ts
git commit -m "feat(supervisor): persist runner claim leases"
```

---

### Task 3: Add Dedicated Runner and Deploy-Resolver Machine Guards

**Files:**
- Create: `apps/api/src/agent-supervisor/runner/supervisor-runner.guard.ts`
- Create: `apps/api/src/agent-supervisor/runner/supervisor-runner.guard.spec.ts`
- Create: `apps/api/src/agent-supervisor/gateway/supervisor-deploy-resolver.guard.ts`
- Create: `apps/api/src/agent-supervisor/gateway/supervisor-deploy-resolver.guard.spec.ts`
- Modify: `apps/api/src/agent-supervisor/gateway/supervisor-gateway.controller.ts`
- Modify: `apps/api/src/agent-supervisor/gateway/supervisor-gateway.controller.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.module.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.module.spec.ts`

**Interfaces:**
- Produces: validated `x-atlas-runner-id` + Runner bootstrap authentication; read-only deployment resolver authentication.
- Does not authorize Worker API writes.

- [ ] **Step 1: Write guard tests first**

Runner guard cases:

```text
missing configured ATLAS_SUPERVISOR_RUNNER_TOKEN -> runner_credential_not_configured
missing supplied token -> runner_credential_required
wrong token -> runner_credential_invalid
missing runner id -> runner_id_required
malformed runner id -> runner_id_required
valid token + engineering-runner:<uuid-v4> -> true
Owner token in Runner header -> rejected
CI token in Runner header -> rejected
```

Deploy resolver guard cases:

```text
missing configured ATLAS_SUPERVISOR_DEPLOY_RESOLVER_TOKEN -> deploy_resolver_credential_not_configured
missing supplied token -> deploy_resolver_credential_required
wrong token -> deploy_resolver_credential_invalid
valid resolver token -> true
CI token header alone -> rejected by resolver route
Owner/Runner token headers -> rejected
```

- [ ] **Step 2: Verify RED**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/runner/supervisor-runner.guard.spec.ts \
  agent-supervisor/gateway/supervisor-deploy-resolver.guard.spec.ts
```

Expected: FAIL because guards do not exist.

- [ ] **Step 3: Implement constant-time comparison and exact Runner ID validation**

Follow the existing CI guard pattern: SHA-256 both values then `timingSafeEqual` the fixed-length digests. Never log supplied/configured values.

Runner ID regex:

```ts
/^engineering-runner:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
```

- [ ] **Step 4: Split gateway route guards explicitly**

Remove class-wide CI guard from `SupervisorGatewayController`. Apply `@UseGuards(SupervisorCiGuard)` to `validate-worker`, `review-candidate`, and `production-deployment`. Apply `@UseGuards(SupervisorDeployResolverGuard)` only to `production-deployment/resolve`.

- [ ] **Step 5: Register providers in `AgentSupervisorModule`**

Register both new guards. Do not export credentials or config values.

- [ ] **Step 6: Run guard/controller/module tests**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/runner/supervisor-runner.guard.spec.ts \
  agent-supervisor/gateway/supervisor-deploy-resolver.guard.spec.ts \
  agent-supervisor/gateway/supervisor-gateway.controller.spec.ts \
  agent-supervisor/agent-supervisor.module.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit machine-identity boundary**

```bash
git add apps/api/src/agent-supervisor/runner/supervisor-runner.guard* \
  apps/api/src/agent-supervisor/gateway/supervisor-deploy-resolver.guard* \
  apps/api/src/agent-supervisor/gateway/supervisor-gateway.controller* \
  apps/api/src/agent-supervisor/agent-supervisor.module*
git commit -m "feat(supervisor): isolate runner machine identities"
```

---

### Task 4: Bind Worker Capability Version 2 to Runner Ownership

**Files:**
- Modify: `apps/api/src/agent-supervisor/worker/supervisor-worker-capability.service.ts`
- Modify: `apps/api/src/agent-supervisor/worker/supervisor-worker-capability.service.spec.ts`
- Modify: `apps/api/src/agent-supervisor/worker/supervisor-worker.guard.ts`
- Modify: `apps/api/src/agent-supervisor/worker/supervisor-worker.guard.spec.ts`

**Interfaces:**
- Consumes: current DB `claimedBy`, `claimEpoch`, `leaseExpiresAt`.
- Produces: capability token unusable after ownership epoch changes even before cryptographic expiry.

- [ ] **Step 1: Add failing capability tests**

```text
issue on unclaimed execution -> worker_capability_claim_required
issue with claimEpoch <= 0 -> worker_capability_claim_required
issue with expired lease -> runner_lease_expired
claims include runnerId and claimEpoch
wrong runnerId -> stale_runner_fenced
wrong claimEpoch -> stale_runner_fenced
expired DB lease -> runner_lease_expired
old epoch token after reclaim -> stale_runner_fenced
heartbeat-style reissue at same epoch -> valid
```

- [ ] **Step 2: Verify RED**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/worker/supervisor-worker-capability.service.spec.ts \
  agent-supervisor/worker/supervisor-worker.guard.spec.ts
```

- [ ] **Step 3: Upgrade capability format to version 2**

```ts
const CAPABILITY_VERSION = 2 as const;
```

`issue()` requires `execution.claimedBy`, positive integer `execution.claimEpoch`, and unexpired `execution.leaseExpiresAt`. Claims include exact current owner and epoch.

- [ ] **Step 4: Fence against DB-current ownership during authorization**

```ts
if (
  input.claimedBy !== claims.runnerId ||
  input.claimEpoch !== claims.claimEpoch
) {
  throw new ForbiddenException('stale_runner_fenced');
}

if (!input.leaseExpiresAt || now.getTime() >= input.leaseExpiresAt.getTime()) {
  throw new ForbiddenException('runner_lease_expired');
}
```

- [ ] **Step 5: Make Worker Guard pass DB ownership state**

Worker bootstrap token is never accepted here. Existing Bearer Worker Capability remains mandatory.

- [ ] **Step 6: Run focused tests**

Use Step 2 command. Expected: PASS.

- [ ] **Step 7: Commit capability fencing**

```bash
git add apps/api/src/agent-supervisor/worker
git commit -m "feat(supervisor): fence worker capabilities by runner epoch"
```

---

### Task 5: Implement Atomic `claim-next`

**Files:**
- Create: `apps/api/src/agent-supervisor/runner/supervisor-runner-claim.service.ts`
- Create: `apps/api/src/agent-supervisor/runner/supervisor-runner-claim.service.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.module.ts`

**Interfaces:**
- Produces:

```ts
type ClaimNextResult =
  | { claimed: false }
  | {
      claimed: true;
      execution: SupervisorExecution;
      assignment: WorkerAssignmentEnvelope;
      claimEpoch: number;
      leaseExpiresAt: string;
      capability: string;
    };
```

Service methods accept an optional test clock only internally:

```ts
claimNext(runnerId: string, now?: Date): Promise<ClaimNextResult>;
heartbeat(executionId: string, runnerId: string, claimEpoch: number, now?: Date): Promise<HeartbeatResult>;
release(executionId: string, runnerId: string, claimEpoch: number, now?: Date): Promise<SupervisorExecution>;
```

- [ ] **Step 1: Write failing claim-selection tests**

```text
oldest A1_SYNTHETIC IMPLEMENTATION DISPATCHED wins
missing runnerEligibility -> skipped
STANDARD -> skipped
INDEPENDENT_VERIFICATION -> skipped
unexpired existing lease -> skipped
expired DISPATCHED -> reclaimable
RUNNING -> never selected even when lease expired
same runner + live DISPATCHED -> runner_already_holds_active_execution
same runner + any RUNNING -> runner_already_holds_active_execution
same runner + expired DISPATCHED -> reclaim that same execution, not another row
no eligible row -> {claimed:false}
reclaim increments epoch exactly once
claim leaves status DISPATCHED
claim writes workerCapability metadata atomically with lease ownership
```

- [ ] **Step 2: Verify RED**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/runner/supervisor-runner-claim.service.spec.ts
```

- [ ] **Step 3: Implement same-runner recovery first inside the transaction**

Inside `PrismaService.$transaction(async tx => { ... })`, lock any row already owned by `runnerId` with status `DISPATCHED` or `RUNNING`.

Decision:

```text
RUNNING, regardless of lease -> 409 runner_already_holds_active_execution
DISPATCHED + lease > now -> 409 runner_already_holds_active_execution
DISPATCHED + lease <= now -> only that same row may be reclaimed; epoch + 1
```

This is the recovery path for a claim that committed but whose HTTP response was lost. It prevents the same Runner from obtaining unrelated work while an old ownership record exists.

- [ ] **Step 4: If no same-runner recovery row exists, lock oldest eligible candidate**

Use a parameterized Prisma raw query equivalent to:

```sql
SELECT *
FROM "SupervisorExecution"
WHERE "status" = 'DISPATCHED'
  AND (
    "claimedBy" IS NULL
    OR "leaseExpiresAt" <= $1
  )
  AND "assignment"->>'executionPurpose' = 'IMPLEMENTATION'
  AND "assignment"->>'runnerEligibility' = 'A1_SYNTHETIC'
ORDER BY "createdAt" ASC
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

Do not construct SQL from untrusted text.

- [ ] **Step 5: Allocate ownership and capability while the row lock is held**

```text
nextEpoch = current claimEpoch + 1
claimedBy = runnerId
claimedAt = now
leaseExpiresAt = now + 120 seconds
lastHeartbeatAt = now
status remains DISPATCHED
```

Construct a temporary `SupervisorExecution` with those values, call capability `issue()`, persist its metadata in `assignment.workerCapability`, update the locked row, then commit. Return the token only after transaction success.

- [ ] **Step 6: Emit structured security events without secrets**

Required events:

```text
runner.claim.succeeded
runner.claim.empty
runner.claim.reclaimed
runner.claim.rejected
runner.fenced
```

Allowed metadata: event, reason, taskId, executionId, runnerId, claimEpoch, status, executionPurpose, claimedAt, leaseExpiresAt, timestamp. Never include token/signature/header values.

- [ ] **Step 7: Run tests and build**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/runner/supervisor-runner-claim.service.spec.ts
npm run build --workspace apps/api
```

- [ ] **Step 8: Commit atomic claim**

```bash
git add apps/api/src/agent-supervisor/runner/supervisor-runner-claim.service* \
  apps/api/src/agent-supervisor/agent-supervisor.module.ts
git commit -m "feat(supervisor): add atomic runner claim"
```

---

### Task 6: Implement Heartbeat, Capability Rotation, and Safe Release

**Files:**
- Modify: `apps/api/src/agent-supervisor/runner/supervisor-runner-claim.service.ts`
- Modify: `apps/api/src/agent-supervisor/runner/supervisor-runner-claim.service.spec.ts`

**Interfaces:**
- Produces:

```ts
interface HeartbeatResult {
  execution: SupervisorExecution;
  claimEpoch: number;
  leaseExpiresAt: string;
  capability: string;
}
```

- [ ] **Step 1: Add failing heartbeat/release tests**

Heartbeat:

```text
DISPATCHED current owner + epoch + live lease -> renew 120s and rotate capability
RUNNING current owner + epoch + live lease -> renew + rotate
heartbeat never increments epoch
wrong runnerId -> stale_runner_fenced
wrong epoch -> stale_runner_fenced
expired lease -> runner_lease_expired
terminal execution -> rejected
DB update failure -> fresh token not returned
repeated heartbeat with same runnerId+epoch -> safe renewal, no new execution
```

Release:

```text
DISPATCHED own current live claim -> clear claimedBy/claimedAt/lease/heartbeat/capability metadata; keep epoch
RUNNING -> running_execution_release_denied
wrong owner/epoch -> stale_runner_fenced
expired lease -> runner_lease_expired
```

- [ ] **Step 2: Verify RED**

Run Task 5 Jest command.

- [ ] **Step 3: Implement heartbeat as one transaction**

Lock execution row, validate `status in (DISPATCHED,RUNNING)`, exact `claimedBy`, exact `claimEpoch`, and unexpired lease. Reissue capability for same owner/epoch, then persist in the same transaction:

```text
leaseExpiresAt = now + 120s
lastHeartbeatAt = now
assignment.workerCapability = fresh metadata
```

Return fresh token only after commit.

- [ ] **Step 4: Implement release before start only**

For `DISPATCHED` only, clear `claimedBy`, `claimedAt`, `leaseExpiresAt`, `lastHeartbeatAt`, and `assignment.workerCapability`. Keep `claimEpoch` unchanged. Do not auto-release RUNNING work.

- [ ] **Step 5: Add audit events**

```text
runner.heartbeat.succeeded
runner.heartbeat.rejected
runner.lease.expired
runner.release.succeeded
runner.release.rejected
runner.fenced
```

- [ ] **Step 6: Verify GREEN and commit**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/runner/supervisor-runner-claim.service.spec.ts
git add apps/api/src/agent-supervisor/runner/supervisor-runner-claim.service*
git commit -m "feat(supervisor): renew and release runner leases"
```

---

### Task 7: Expose Runner Claim HTTP API

**Files:**
- Create: `apps/api/src/agent-supervisor/runner/supervisor-runner.controller.ts`
- Create: `apps/api/src/agent-supervisor/runner/supervisor-runner.controller.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.module.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.module.spec.ts`

**Interfaces:**
- Produces:

```text
POST /engineering/supervisor/runner/claim-next
POST /engineering/supervisor/runner/executions/:executionId/heartbeat
POST /engineering/supervisor/runner/executions/:executionId/release
```

- [ ] **Step 1: Write controller tests**

Use `@Public()` + `@UseGuards(SupervisorRunnerGuard)`. Read validated `x-atlas-runner-id`. Heartbeat/release body is exactly:

```ts
{ claimEpoch: number }
```

Reject non-positive/non-integer epoch before service invocation with `runner_claim_epoch_required`.

- [ ] **Step 2: Verify RED**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/runner/supervisor-runner.controller.spec.ts \
  agent-supervisor/agent-supervisor.module.spec.ts
```

- [ ] **Step 3: Implement controller and module registration**

`claim-next` returns HTTP 200 `{claimed:false}` when idle. Do not translate idle to an error.

- [ ] **Step 4: Run tests and commit**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/runner/supervisor-runner.controller.spec.ts \
  agent-supervisor/runner/supervisor-runner.guard.spec.ts \
  agent-supervisor/agent-supervisor.module.spec.ts
git add apps/api/src/agent-supervisor/runner/supervisor-runner.controller* \
  apps/api/src/agent-supervisor/agent-supervisor.module*
git commit -m "feat(supervisor): expose runner claim API"
```

---

### Task 8: Route `STANDARD` vs `A1_SYNTHETIC` and Enforce Synthetic Evidence

**Files:**
- Modify: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.ts`
- Modify: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.controller.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.controller.spec.ts`

**Interfaces:**
- Produces: new execution assignments with explicit eligibility.
- Default Owner dispatch remains `STANDARD`; A1 smoke must explicitly request `A1_SYNTHETIC`.

- [ ] **Step 1: Add failing dispatch tests**

```text
default dispatch -> runnerEligibility STANDARD
explicit A1 synthetic -> runnerEligibility A1_SYNTHETIC
A1 synthetic + INDEPENDENT_VERIFICATION -> runner_execution_not_eligible
dispatch does not issue a Runner-bound Worker Capability before claim
new execution claim fields initialize to null/0
```

- [ ] **Step 2: Add failing synthetic completion tests**

Accepted evidence:

```ts
{
  rootCause: 'synthetic_runner_claim_plane_validation',
  changedFiles: [],
  tests: expect.any(Array),
  build: 'NOT_RUN_SYNTHETIC',
  regression: expect.any(Array),
  deploymentState: 'NONE',
  gitState: 'UNCHANGED',
  remainingRisk: expect.any(Array),
}
```

Reject any synthetic result containing changed files, `deploymentState !== 'NONE'`, `gitState !== 'UNCHANGED'`, `reviewCandidate`, `ownerMergeAuthorization`, `ownerMergeAuthorizationConsumption`, `ownerDeploymentAuthorization`, or `ownerDeploymentAuthorizationRevocations` with `synthetic_execution_evidence_violation`.

- [ ] **Step 3: Verify RED**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/dispatch/worker-dispatcher.service.spec.ts \
  agent-supervisor/agent-supervisor.controller.spec.ts
```

- [ ] **Step 4: Implement explicit eligibility**

Default `runnerEligibility` is `STANDARD`. Owner dispatch body may be:

```ts
{
  executionPurpose?: 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION';
  runnerEligibility?: 'A1_SYNTHETIC' | 'STANDARD';
}
```

A1 synthetic is accepted only with `IMPLEMENTATION`.

- [ ] **Step 5: Remove dispatch-time Worker Capability issuance**

A Runner-bound v2 capability cannot exist before `claimedBy + claimEpoch`. Claim transaction is the only A1 initial capability issuer.

Preserve Owner-only direct lifecycle endpoints as emergency/admin paths; do not expose them to Runner identity.

- [ ] **Step 6: Enforce synthetic result contract inside `complete()`**

Validate before persisting `COMPLETED`.

- [ ] **Step 7: Verify parent task remains unchanged**

Synthetic completion changes execution only. Never call `submitImplementationFromExecution()` automatically.

- [ ] **Step 8: Run tests and commit**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/dispatch/worker-dispatcher.service.spec.ts \
  agent-supervisor/agent-supervisor.controller.spec.ts \
  agent-supervisor/worker/supervisor-worker.controller.spec.ts
git add apps/api/src/agent-supervisor/dispatch \
  apps/api/src/agent-supervisor/agent-supervisor.controller*
git commit -m "feat(supervisor): gate synthetic runner executions"
```

---

### Task 9: Register `engineering-runner` in Deployment Governance and Apply V1 Resolver Credential

**Files:**
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.types.ts`
- Modify: `apps/api/src/agent-supervisor/deployment/production-deployment-gate.service.ts`
- Modify: `apps/api/src/agent-supervisor/deployment/production-deployment-gate.service.spec.ts`
- Modify: `apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.ts`
- Modify: `apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.spec.ts`
- Modify: `apps/api/scripts/check-production-deployment-gate.cjs`
- Create: `apps/api/scripts/check-production-deployment-gate.test.cjs`

**Interfaces:**
- Produces: exact `engineering-runner` deployment-service authorization support without exposing CI credential to Runner runtime.

- [ ] **Step 1: Add failing service/type tests**

Allowed production services become exactly:

```ts
'api' | 'web' | 'browser-worker' | 'engineering-runner'
```

Arbitrary strings remain rejected.

- [ ] **Step 2: Add Node script tests first**

Use `node:test` + fake `fetchImpl`. Prove resolver request sends:

```text
x-atlas-supervisor-deploy-resolver-token
```

and never sends:

```text
x-atlas-supervisor-ci-token
```

Script required env becomes `ATLAS_SUPERVISOR_DEPLOY_RESOLVER_TOKEN`; `ATLAS_DEPLOYMENT_SERVICE=engineering-runner` is accepted; unknown service is rejected.

- [ ] **Step 3: Verify RED**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/deployment/production-deployment-gate.service.spec.ts \
  agent-supervisor/persistence/supervisor-persistence.mapper.spec.ts
node --test apps/api/scripts/check-production-deployment-gate.test.cjs
```

- [ ] **Step 4: Extend every exact service allowlist**

Update TypeScript union, deployment gate set, persistence mapper set, and preDeploy resolver script set together.

- [ ] **Step 5: Switch preDeploy resolver script to V1 credential**

```js
'x-atlas-supervisor-deploy-resolver-token': resolverToken
```

Do not send both resolver and CI credentials. Script remains read-only and calls only `/production-deployment/resolve`.

- [ ] **Step 6: Record future deployment dependency explicitly**

Before any production deployment after this code is merged, the relevant Railway service must have `ATLAS_SUPERVISOR_DEPLOY_RESOLVER_TOKEN` configured. This includes existing API/Web/Browser Worker services that use the shared preDeploy script and the future Engineering Runner service. This step is documentation/verification only; do not mutate Railway during implementation.

- [ ] **Step 7: Run tests**

Use Step 3 command. Expected: PASS.

- [ ] **Step 8: Commit deployment-governance support**

```bash
git add apps/api/src/agent-supervisor/agent-supervisor.types.ts \
  apps/api/src/agent-supervisor/deployment \
  apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper* \
  apps/api/scripts/check-production-deployment-gate.cjs \
  apps/api/scripts/check-production-deployment-gate.test.cjs
git commit -m "feat(supervisor): govern engineering runner deployments"
```

---

### Task 10: Build Disabled-by-Default Railway Engineering Runner Skeleton

**Files:**
- Create: `apps/engineering-runner/package.json`
- Create: `apps/engineering-runner/tsconfig.json`
- Create: `apps/engineering-runner/Dockerfile`
- Create: `apps/engineering-runner/railway.json`
- Create: `apps/engineering-runner/src/runner-client.ts`
- Create: `apps/engineering-runner/src/runner-client.spec.ts`
- Create: `apps/engineering-runner/src/runner-loop.ts`
- Create: `apps/engineering-runner/src/runner-loop.spec.ts`
- Create: `apps/engineering-runner/src/index.ts`

**Interfaces:**
- Consumes: Runner Claim API + existing Worker API.
- Produces: one-process/one-execution synthetic control-plane worker. No Agent launch and no filesystem/Git mutation.

- [ ] **Step 1: Create exact package and TypeScript configuration**

`apps/engineering-runner/package.json`:

```json
{
  "name": "engineering-runner",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "tsx --test src/**/*.spec.ts"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.20.3",
    "typescript": "^5.7.3"
  }
}
```

`apps/engineering-runner/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Write Runner client contract tests**

Runner process env reads only these runtime inputs:

```text
ATLAS_SUPERVISOR_API_URL
ATLAS_SUPERVISOR_RUNNER_TOKEN
ATLAS_ENGINEERING_RUNNER_ENABLED
```

It may inherit `ATLAS_SUPERVISOR_DEPLOY_RESOLVER_TOKEN` from Railway because preDeploy variables are service variables, but Runner source must never read or send it at runtime.

Claim-plane requests send:

```text
x-atlas-supervisor-runner-token
x-atlas-runner-id
content-type: application/json when body exists
```

Worker API requests send only Bearer execution capability, never Runner bootstrap token.

- [ ] **Step 3: Write Runner loop tests before implementation**

With injected `fetch`, `sleep`, clock, and UUID functions prove:

```text
ATLAS_ENGINEERING_RUNNER_ENABLED !== 'true' -> zero claim requests and process remains alive
idle -> poll every 5s
network/API failure -> 5s,10s,20s,30s cap
successful communication -> reset to 5s
single-flight -> never two claim-next calls concurrently
claim success -> polling stops while active
process boot -> runnerId engineering-runner:<uuid-v4>
one process -> at most one current execution
409 runner_already_holds_active_execution after ambiguous claim -> back off; never claim unrelated work while lease is live
```

- [ ] **Step 4: Implement synthetic lifecycle only**

Successful claim sequence:

```text
claim-next
-> mark-running using claim capability
-> heartbeat once immediately to prove capability rotation
-> replace in-memory capability with heartbeat result
-> complete using fresh capability and exact synthetic no-op evidence
-> clear current execution
-> return to idle polling
```

Do not read repository files, spawn child processes, run Git, run tests/build, or launch any Agent.

- [ ] **Step 5: Implement 30-second periodic heartbeat abstraction**

While an execution is active, periodic heartbeat uses the same `runnerId + claimEpoch` and replaces only the in-memory capability with the newest token. Heartbeat request may be repeated after an ambiguous network result because server-side operation is a bounded renewal in the same epoch.

- [ ] **Step 6: Implement fail-closed ambiguous execution handling**

If `mark-running`, `complete`, or `fail` has a network outcome where commit status is unknown:

```text
DO NOT retry the same write automatically
DO NOT create another execution
DO NOT claim unrelated work as a substitute
record non-secret event/reason
stop processing that execution
allow Supervisor lease/status reconciliation to determine next action
```

If `claim-next` response is lost after commit, subsequent claim requests with the same Runner ID are blocked while the lease is live; after expiry, Task 5 must preferentially reclaim that same `DISPATCHED` row with a higher epoch.

- [ ] **Step 7: Implement shutdown behavior**

If current execution is still `DISPATCHED`, send exactly one release attempt. If already `RUNNING`, do not release. If release response is ambiguous/network-failed, log non-secret reason and stop; never retry blindly.

- [ ] **Step 8: Create minimal Dockerfile**

```dockerfile
FROM node:22-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/engineering-runner/package.json apps/engineering-runner/
RUN npm install --include=dev
COPY . .
RUN npm run build --workspace apps/engineering-runner
ENV NODE_ENV=production
CMD ["node", "apps/engineering-runner/dist/index.js"]
```

Do not install Chromium, GitHub CLI, Codex, or other execution engines.

- [ ] **Step 9: Create Railway config**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "deploy": {
    "preDeployCommand": [
      "ATLAS_DEPLOYMENT_SERVICE=engineering-runner node apps/api/scripts/check-production-deployment-gate.cjs"
    ]
  }
}
```

No secret values belong in repository config. Production environment must later set `ATLAS_ENGINEERING_RUNNER_ENABLED=false` before first deploy; that Railway mutation is not authorized by implementation.

- [ ] **Step 10: Run Runner tests/build**

```bash
npm test --workspace apps/engineering-runner
npm run build --workspace apps/engineering-runner
```

Expected: PASS.

- [ ] **Step 11: Commit Runner skeleton**

```bash
git add apps/engineering-runner
git commit -m "feat(runner): add synthetic engineering runner skeleton"
```

---

### Task 11: Prove PostgreSQL Concurrency, Fencing, and Lease Recovery Against a Real Database

**Files:**
- Create: `apps/api/src/agent-supervisor/runner/supervisor-runner-claim.integration.spec.ts`

**Interfaces:**
- Validates actual PostgreSQL locking and partial indexes; mocks are insufficient.

- [ ] **Step 1: Create dedicated local Prisma Postgres**

Do not point this test at production/shared DB.

```bash
npx prisma dev --name="atlas-p0b-a1-test" --detach
npx prisma dev ls
```

Use the TCP/Postgres URL reported for `atlas-p0b-a1-test` as `DATABASE_URL` in the test shell only.

- [ ] **Step 2: Apply committed migrations**

```bash
npm run db:migrate --workspace apps/api
```

Expected: all migrations apply, including `20260907090000_p0b_a1_runner_claim_plane`.

- [ ] **Step 3: Write real concurrency tests**

```text
two concurrent different Runner IDs racing one eligible execution -> exactly one owner
multiple candidates -> SKIP LOCKED lets different runners claim different rows without duplicate ownership
same runner cannot own two live active rows
same runner with expired DISPATCHED reclaims same row and increments epoch
claim response-loss recovery does not switch to unrelated work
expired DISPATCHED owned by another runner -> reclaim succeeds and epoch increments
old capability after reclaim -> stale_runner_fenced
unexpired DISPATCHED -> cannot be stolen
expired RUNNING -> never selected
heartbeat keeps epoch constant
release DISPATCHED makes same execution claimable again while epoch stays monotonic
```

Use deterministic `now` values through the service’s test clock parameter; do not sleep 120 seconds.

- [ ] **Step 4: Run integration test in band**

```bash
npm test --workspace apps/api -- --runInBand \
  agent-supervisor/runner/supervisor-runner-claim.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Stop local test database**

```bash
npx prisma dev stop atlas-p0b-a1-test
```

Confirm no production/shared DB URL was used.

- [ ] **Step 6: Commit integration proof**

```bash
git add apps/api/src/agent-supervisor/runner/supervisor-runner-claim.integration.spec.ts
git commit -m "test(supervisor): prove runner claim concurrency"
```

---

### Task 12: Full A1 Verification and Frozen Candidate Review

**Files:**
- No new implementation files expected. Only defects discovered by verification may be fixed, and only inside A1-authorized paths already listed above.

**Interfaces:**
- Produces implementation candidate evidence only. Does not push, open PR, merge, deploy, configure Railway, or enable Runner.

- [ ] **Step 1: Run all focused Supervisor tests**

```bash
npm test --workspace apps/api -- --runInBand agent-supervisor
```

Expected: PASS.

- [ ] **Step 2: Run Runner tests**

```bash
npm test --workspace apps/engineering-runner
```

Expected: PASS.

- [ ] **Step 3: Verify Prisma reproducibility**

```bash
npm run check:prisma-generated --workspace apps/api
```

Expected: PASS with zero generated-client drift.

- [ ] **Step 4: Build API and Runner**

```bash
npm run build --workspace apps/api
npm run build --workspace apps/engineering-runner
```

Expected: PASS.

- [ ] **Step 5: Run lint carefully**

The existing API lint script uses `--fix`. Run it only in the isolated implementation worktree, inspect `git status --short` immediately afterward, and revert unrelated formatting churn before proceeding.

- [ ] **Step 6: Re-run real PostgreSQL integration proof**

Repeat Task 11 against `atlas-p0b-a1-test`; stop the local DB afterward.

- [ ] **Step 7: Security grep**

```bash
! grep -R "ATLAS_SUPERVISOR_OWNER_TOKEN\|ATLAS_SUPERVISOR_CI_TOKEN\|GITHUB_TOKEN\|GH_TOKEN" apps/engineering-runner
```

Expected exit status: 0.

Verify no code execution primitives:

```bash
! grep -R "child_process\|spawn(\|exec(\|execFile(\|simple-git\|codex" apps/engineering-runner/src
```

Expected exit status: 0.

Verify Runner source does not read deploy-resolver token at runtime:

```bash
! grep -R "ATLAS_SUPERVISOR_DEPLOY_RESOLVER_TOKEN" apps/engineering-runner/src
```

Expected exit status: 0.

- [ ] **Step 8: Verify no production enablement is committed**

```bash
! grep -R "ATLAS_ENGINEERING_RUNNER_ENABLED=true" apps/engineering-runner
```

Expected exit status: 0.

- [ ] **Step 9: Review exact changed-file boundary**

Candidate may contain only A1 claim-plane/API/Prisma/generated-client/Runner/deployment-gate/tests/docs paths described by this plan. No Web, Browser Worker, marketing workflow, publishing, or unrelated product changes.

- [ ] **Step 10: Freeze candidate SHA and evidence**

Record only non-secret evidence:

```text
HEAD SHA
base SHA
changed file list
commit list
focused test results
real PostgreSQL concurrency result
API build result
Runner build result
Prisma generated manifest result
credential grep result
Runner no-agent/no-git grep result
working tree status
```

- [ ] **Step 11: Stop at next governance boundary**

Implementation may be locally committed in isolated branch only. Do not push/open PR/merge/deploy/change Railway/enable Runner without separate explicit authorization.

---

## Required Acceptance Matrix Before A1 Can Be Called Implemented

| Area | Must prove |
| --- | --- |
| Atomic claim | Two runners cannot own the same execution; `SKIP LOCKED` behavior is proven on real PostgreSQL. |
| Lost claim response | Same Runner is blocked while lease is live, then may reclaim only its same expired `DISPATCHED` execution with epoch increment. |
| One-runner invariant | One `runnerId` cannot own two live active executions; any `RUNNING` ownership blocks another claim regardless of lease. |
| Eligibility | Only explicit `A1_SYNTHETIC + IMPLEMENTATION` is claimable; missing/`STANDARD`/verification purpose fail closed. |
| Lease | 120s lease; 30s heartbeat; heartbeat never increments epoch. |
| Reclaim | Expired `DISPATCHED` may reclaim with epoch increment; expired `RUNNING` never auto-reclaims. |
| Capability | Version 2 token binds task/execution/role/purpose/assignment/Runner ID/epoch; old epoch is immediately fenced. |
| Heartbeat atomicity | Lease renewal and capability metadata rotation commit together; token returned only after DB commit. |
| Release | Only live own `DISPATCHED` claim can release; RUNNING release denied; ambiguous release never blindly retries. |
| Ambiguous lifecycle writes | `mark-running`/`complete`/`fail` are not blindly retried; unresolved outcomes stop and require reconciliation. |
| Authentication | Runner, deploy-resolver, CI, Owner credentials remain distinct; no credential fallback. |
| Synthetic evidence | Zero changed files, `NONE`, `UNCHANGED`, no integration artifacts; spoofed evidence rejected. |
| Parent task | Synthetic execution can become `COMPLETED` while parent task remains `WORKING`. |
| Logging | Structured events contain no token, signature, or raw credential header. |
| Runner runtime | Disabled by default; single-flight polling/backoff; no Git, no Agent launch, no repo mutation. |
| Deployment governance | `engineering-runner` is an exact service and preDeploy resolution uses read-only resolver credential, not CI token. |
| Railway boundary | No Railway variable/config mutation occurs during implementation; resolver-token rollout and Runner enablement require separate authorization. |

## Plan Self-Review Result

- Spec coverage: A1 through U1 are mapped to Tasks 1–12; V1 is mapped to Tasks 3, 9, 10, and 12.
- Concurrency correction: same-runner expired `DISPATCHED` recovery is explicit and does not conflict with one-active-execution enforcement.
- Ambiguous-write correction: claim response loss, mark-running/complete/fail ambiguity, heartbeat retry, and release ambiguity now have distinct fail-closed behavior.
- Placeholder scan: no implementation placeholder remains; deferred A2/A3 work is explicitly outside this plan rather than left unfinished inside a task.
- Type consistency: `RunnerEligibility`, claim fields, `ClaimNextResult`, and `HeartbeatResult` use one naming scheme throughout.
- Security consistency: Runner runtime never reads Owner, CI, GitHub, or deploy-authorization credentials; V1 deploy-resolver credential is read-only and not read by Runner source.

## Execution Handoff

After a separate implementation authorization, two execution modes are supported:

1. **Subagent-Driven (recommended)** — use `superpowers:subagent-driven-development`, one fresh implementation subagent per task with review gates between tasks.
2. **Inline Execution** — use `superpowers:executing-plans`, execute tasks in this session in small batches with checkpoints.

Neither execution mode is authorized by this planning document itself.