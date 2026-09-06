# ATLAS P0B-A1 Runner Claim Plane Design

## Status

Approved design for P0B-A1 Engineering Agent Runner Claim Plane.

Design base:

- canonical branch: `production/atlas`
- base commit: `f6f36ec7f6c7af2b7b8b5ec6be4ba4ee4724369a`
- design date: 2026-09-07
- implementation status: not started by this design commit

This document freezes the architecture for the transport, identity, lease, fencing, capability handoff, and synthetic production-smoke foundation required before ATLAS is allowed to launch a real Engineering Agent.

## Goal

Introduce a dedicated Railway `engineering-runner` service that safely pulls an eligible Supervisor execution, atomically claims it, maintains a bounded lease, receives execution-scoped capabilities, and is fenced immediately when ownership becomes stale.

P0B-A1 proves the control-plane lifecycle only. It does not launch Codex or another Engineering Agent and it does not modify the Atlas repository.

The target path is:

```text
Human Owner
  -> ATLAS Supervisor
      -> Supervisor Task
      -> IMPLEMENTATION execution
      -> DISPATCHED
          -> Railway engineering-runner
              -> pull claim-next
              -> atomic claim + lease + claimEpoch
              -> fresh execution capability
              -> mark-running
              -> heartbeat + capability rotation
              -> synthetic no-op completion
      -> execution COMPLETED

Parent synthetic task remains WORKING.
No review, merge, deployment, or production-integration transition is created.
```

## Architectural Classification

This is an architectural change because it introduces a new runtime service, new machine-identity boundary, new execution-ownership semantics, new persistence fields, and new Supervisor API interfaces.

P0B-A1 is intentionally isolated from P0B-A2 Engineering Agent Engine and P0B-A3 Independent Verification Runner.

## Existing Foundation

ATLAS already has:

- persisted `SupervisorTask` and `SupervisorExecution` state;
- worker dispatch that creates an immutable `WorkerAssignmentEnvelope`;
- execution lifecycle states `QUEUED`, `DISPATCHED`, `RUNNING`, `COMPLETED`, `FAILED`, and `CANCELLED`;
- conditional execution persistence through status-aware writes;
- execution-bound Worker Capability authentication for assignment reads and execution lifecycle writes;
- protected-action denial for merge, rebase, squash, cherry-pick, auto-merge, force-push, and branch deletion for integration;
- separate Owner and CI credential boundaries;
- fail-closed Supervisor governance.

The current missing boundary is runtime ownership. Dispatch can create a `DISPATCHED` execution, but no hosted Engineering Runner safely claims and owns that execution.

## Scope

### In scope

P0B-A1 implements the design for:

- a Railway `engineering-runner` service skeleton;
- pull-based execution discovery;
- atomic claim and reclaim;
- Runner bootstrap authentication;
- per-process Runner identity;
- execution lease ownership;
- monotonic fencing epoch;
- heartbeat-based lease renewal;
- execution capability issuance at claim time;
- execution capability rotation during heartbeat;
- claim-aware validation for worker writes;
- safe own-claim release before execution starts;
- structured security audit logs;
- a minimal Prisma migration extending `SupervisorExecution`;
- explicit `runnerEligibility` assignment routing;
- synthetic-only production rollout;
- synthetic lifecycle smoke tests and negative security/concurrency tests.

### Explicit non-goals

P0B-A1 must not add or perform:

- Codex launch;
- ChatGPT Work coding launch;
- any other real Engineering Agent process launch;
- Git checkout or isolated worktree creation;
- source-file modification by the runner;
- repository commit creation by the runner;
- push or pull-request creation;
- merge;
- deployment execution;
- Railway mutation as an automatic consequence of a claim;
- GitHub write credentials in the runner;
- Owner credentials in the runner;
- CI credentials in the runner;
- production deployment authorization credentials in the runner;
- an independent verification runner;
- a new audit database table;
- automatic progression of a synthetic parent task to implementation/review/approval states.

Those capabilities are deferred to later P0B stages.

## Selected Architecture

### Deployment topology

The first Engineering Runner runs as an independent Railway service named conceptually `engineering-runner`.

The API remains the authoritative Supervisor and database owner. The Runner has no direct database connection and communicates only through Supervisor HTTP endpoints.

One Runner process may hold at most one active execution at a time. Horizontal throughput is achieved with Railway replicas rather than multiple concurrent execution slots inside one process.

Each process boot generates a new opaque instance identity:

```text
engineering-runner:<boot-uuid>
```

A restarted process is therefore never treated as the same lease owner as its predecessor.

## Runner Bootstrap Identity

The Runner uses a dedicated machine credential:

```text
ATLAS_SUPERVISOR_RUNNER_TOKEN
```

This credential is independent from:

- `ATLAS_SUPERVISOR_OWNER_TOKEN`;
- `ATLAS_SUPERVISOR_CI_TOKEN`;
- deployment authorization material;
- any GitHub write credential.

Runner requests carry:

```text
x-atlas-supervisor-runner-token: <secret>
x-atlas-runner-id: engineering-runner:<boot-uuid>
```

The Runner bootstrap credential authorizes only the Runner claim plane. It does not authorize execution completion by itself and it never authorizes Owner, merge, deployment, runtime-configuration, or repository-integration actions.

Fail-closed authentication rules:

- missing configured credential -> reject;
- missing supplied credential -> reject;
- invalid supplied credential -> reject;
- missing or malformed Runner ID -> reject;
- no fallback to CI identity;
- no fallback to Owner identity.

Credential values and credential headers must never be emitted into logs.

## Runner Class and Execution Purpose

P0B-A1 Runner class is implementation-only.

A1 may claim only executions whose assignment purpose is:

```text
IMPLEMENTATION
```

`INDEPENDENT_VERIFICATION` is reserved for P0B-A3 and must not be claimed by the Engineering Runner pool.

The future verifier must use a logically separate runner class and credential scope so that implementation and independent verification do not collapse into the same trust boundary.

## Assignment Eligibility

`WorkerAssignmentEnvelope` gains an explicit routing field:

```text
runnerEligibility: "A1_SYNTHETIC" | "STANDARD"
```

A missing eligibility value is never inferred.

During A1 production smoke testing, claim eligibility requires all of:

```text
execution.status == DISPATCHED
assignment.executionPurpose == IMPLEMENTATION
assignment.runnerEligibility == A1_SYNTHETIC
lease is unclaimed or expired
```

Rules:

- missing `runnerEligibility` -> not claimable;
- `STANDARD` -> not claimable during A1 production rollout;
- `A1_SYNTHETIC` -> potentially claimable if all other conditions pass;
- task objective, task name, execution ID prefix, or free-form text must never be used to infer eligibility.

This protects all pre-existing executions because they lack the explicit A1 eligibility marker.

## Persistence Model

P0B-A1 makes a minimal extension to `SupervisorExecution`:

```text
claimedBy        String?
claimEpoch       Int       @default(0)
claimedAt        DateTime?
leaseExpiresAt   DateTime?
lastHeartbeatAt  DateTime?
```

No claim table is introduced.

The migration also adds a claim-selection index equivalent to:

```text
(status, leaseExpiresAt, createdAt)
```

The implementation must also enforce the invariant that one Runner ID cannot simultaneously own more than one `DISPATCHED` or `RUNNING` execution. The preferred database enforcement is a PostgreSQL partial unique index over non-null `claimedBy` for those active statuses. This preserves `claimedBy` on terminal records for audit while preventing duplicate live ownership.

The database is the final authority for current claim state.

## Claim Lease

Selected timings:

```text
lease duration:     120 seconds
heartbeat interval: 30 seconds
claim polling:       5 seconds when idle
```

The lease is intentionally longer than the heartbeat interval so several transient heartbeat failures can occur before ownership expires.

Every successful new claim or reclaim increments:

```text
claimEpoch = previous claimEpoch + 1
```

Heartbeat does not increment `claimEpoch`.

`claimEpoch` is the fencing token. Once a later epoch exists, an older Runner is permanently stale for that ownership generation even if its previous capability has not reached its cryptographic expiry time.

## Atomic Claim Primitive

Claim selection uses PostgreSQL row locking with `FOR UPDATE SKIP LOCKED` so multiple Railway replicas may poll concurrently without claiming the same execution.

The conceptual selection order is oldest eligible `DISPATCHED` execution first.

The claim operation must be atomic at the database transaction boundary and must never expose a read-then-write race to callers.

Because execution capability claims bind to the newly generated `claimEpoch`, and that epoch is database state, capability metadata cannot be safely finalized before the candidate row is locked. Therefore the implementation uses one short database transaction:

```text
BEGIN
  SELECT oldest eligible execution
    FOR UPDATE SKIP LOCKED
    LIMIT 1

  compute next claimEpoch while row is locked
  construct fresh execution capability metadata for that epoch

  UPDATE locked execution
    claimedBy        = runnerId
    claimEpoch       = next epoch
    claimedAt        = now
    leaseExpiresAt   = now + 120 seconds
    lastHeartbeatAt  = now
    assignment.workerCapability = fresh metadata
    RETURNING execution
COMMIT
```

This is the approved reconciliation of the atomic-claim requirement with claim-time capability issuance: selection, epoch allocation, lease state, and persisted capability metadata commit as one ownership transaction. No other Runner can obtain the locked candidate, and no claimed execution is externally committed with mismatched capability metadata.

The implementation may express the select/update portions through a CTE or Prisma raw SQL, but the observable contract is the transaction above. Application-level mutexes or in-memory locks are not authoritative.

If no eligible row exists, claim is a normal idle result rather than an application error.

## Claim API Contract

Runner bootstrap API surface:

```text
POST /engineering/supervisor/runner/claim-next
POST /engineering/supervisor/runner/executions/:executionId/heartbeat
POST /engineering/supervisor/runner/executions/:executionId/release
```

These endpoints use Runner bootstrap authentication, not Worker Capability authentication.

A no-work response is successful and conceptually equivalent to:

```json
{
  "claimed": false
}
```

A successful claim returns, without logging the capability value:

```text
claimed = true
execution
assignment
claimEpoch
leaseExpiresAt
fresh execution capability
```

The claim response must never include Owner, CI, deployment, or other unrelated credentials.

## Execution Worker API Boundary

The existing execution Worker API remains separate from the Runner bootstrap API.

Assignment reads and execution writes continue to require an execution-bound Worker Capability. The Runner bootstrap token alone is insufficient for:

- mark-running;
- complete;
- fail;
- cancel;
- any protected integration action.

The Worker write path is extended so current claim ownership is also mandatory.

## Execution Capability Binding

Execution capability claims are extended to bind:

- task ID;
- execution ID;
- worker role;
- execution purpose;
- assignment digest;
- allowed operations;
- Runner ID;
- claim epoch;
- issued-at time;
- expiry time.

For every write operation, authorization must confirm that the persisted execution still satisfies:

```text
token.runnerId   == execution.claimedBy
token.claimEpoch == execution.claimEpoch
execution.leaseExpiresAt > now
```

Any old epoch is rejected even when the old token's cryptographic expiry is still in the future.

The database claim state is the final fencing authority.

The Runner never receives the server-side capability signing source. Existing server-side capability signing material remains inside the API boundary.

## Capability Lifetime and Rotation

A fresh execution capability is issued at claim time.

Heartbeat rotates the capability while keeping the same `runnerId` and `claimEpoch`.

The existing short-lived capability lifetime remains bounded; long-running work survives through heartbeat rotation rather than by extending one token indefinitely.

Heartbeat performs one atomic persistence operation for:

```text
leaseExpiresAt
lastHeartbeatAt
assignment.workerCapability metadata
```

The API returns the fresh token only after the database update succeeds.

If the database write fails, the new token is not returned and the previously persisted state remains authoritative.

If the database write commits but the HTTP response is lost, the Runner must not assume success. It may send another heartbeat with the same Runner identity and epoch. Heartbeat is a renewal operation within one ownership generation and does not create a new execution or increment the epoch.

## Lifecycle Semantics

Claim and execution start are distinct events.

```text
QUEUED
  -> DISPATCHED
  -> DISPATCHED + claimed lease
  -> RUNNING
  -> COMPLETED | FAILED
```

Atomic claim does not change execution status.

A Runner calls the existing mark-running operation only after minimum startup validation succeeds. `startedAt` therefore means actual execution start, while `claimedAt` means ownership acquisition.

Heartbeat is valid for a currently claimed execution in either:

```text
DISPATCHED
RUNNING
```

Mark-running requires:

- current status `DISPATCHED`;
- valid execution capability;
- current `claimedBy` match;
- current `claimEpoch` match;
- unexpired lease.

## Release Semantics

Release is permitted only before execution starts:

```text
DISPATCHED + current own claim
  -> clear current claim ownership
  -> remain DISPATCHED
```

Release requires current Runner ID and epoch ownership.

Release is denied once the execution is `RUNNING`.

A `RUNNING` execution may already have produced local or external effects. Clearing its claim and pretending it never started would violate fail-closed recovery semantics.

A Runner shutdown may make one best-effort release request only for its own currently claimed `DISPATCHED` execution. If the release outcome is ambiguous, it must not blindly retry; lease expiry and reconciliation remain authoritative.

## Lease Expiry and Crash Recovery

Lease expiry is status-sensitive.

### Expired DISPATCHED lease

A `DISPATCHED` execution whose lease has expired may be reclaimed automatically.

Reclaim:

- selects the same execution only if still eligible;
- replaces `claimedBy`;
- increments `claimEpoch`;
- establishes a fresh lease;
- issues a capability bound to the new Runner and epoch.

The prior Runner is immediately fenced.

### Expired RUNNING lease

A `RUNNING` execution whose lease expires must never be automatically reclaimed or automatically rerun.

It remains persisted as `RUNNING` but is operationally stale and requires read-only reconciliation before any decision to continue, fail, or create another implementation execution.

This prevents duplicate code execution after network partitions or Runner crashes.

The policy is:

```text
ambiguous write or execution state
  -> read-only reconciliation first
  -> never blind retry
```

No new `ORPHANED` execution status is added in A1.

## One-Execution-Per-Runner Invariant

A Runner process may own at most one active `DISPATCHED` or `RUNNING` execution.

The Runner client uses single-flight claim requests, and the Supervisor/database must enforce the invariant independently so a buggy client cannot obtain two active claims.

When the Runner already owns an active execution, another claim attempt is rejected rather than granting additional work.

P0B-A1 does not introduce `slotId` or an internal worker pool. If concurrency is needed later, Railway replicas provide it.

## Polling and Backoff

When enabled and idle, the Runner polls `claim-next` every 5 seconds.

Rules:

- only one claim request may be in flight per Runner process;
- `claimed: false` is normal and must not be logged as an error;
- after a successful claim, polling stops until the current execution reaches a terminal or released state;
- transient API/network errors use exponential backoff, conceptually `5s -> 10s -> 20s -> 30s` with a 30-second cap;
- successful communication resets polling to the normal 5-second cadence.

## Production Enablement Gate

The production Runner is deployed disabled by default:

```text
ATLAS_ENGINEERING_RUNNER_ENABLED=false
```

Deployment, enablement, and real execution are separate governance events.

A1 rollout sequence is:

```text
1. ship schema/API support
2. deploy engineering-runner disabled
3. verify health read-only
4. create a dedicated synthetic Supervisor task/execution
5. explicitly enable the Runner for the smoke step
6. claim only A1_SYNTHETIC
7. run synthetic lifecycle
8. verify positive and negative invariants
```

A1 must not enable `STANDARD` execution claims in production.

Real Engineering Agent work begins only after a separate P0B-A2 authorization and implementation.

## Synthetic Completion Contract

`A1_SYNTHETIC` must never generate evidence that resembles a real implementation.

The Supervisor server enforces the synthetic completion contract. Required no-op values include:

```text
changedFiles = []
deploymentState = "NONE"
gitState = "UNCHANGED"
reviewCandidate = absent
ownerMergeAuthorization = absent
ownerDeploymentAuthorization = absent
rootCause = "synthetic_runner_claim_plane_validation"
build = "NOT_RUN_SYNTHETIC"
```

The synthetic result may record transport tests and regression checks in the existing evidence arrays, but it must not claim source implementation, build output, deployment, or Git mutation that did not occur.

Any synthetic result that attempts to report changed files, a review candidate, a deployment state other than `NONE`, a Git state other than `UNCHANGED`, or integration authorization data is rejected with a deterministic synthetic-evidence violation.

## Parent Task Semantics

Completing an A1 synthetic execution terminates the execution only.

After the smoke execution:

```text
Execution = COMPLETED
Parent Task = WORKING
```

Synthetic completion must not automatically advance the parent task to:

- `IMPLEMENTED`;
- `VERIFYING`;
- `READY_FOR_REVIEW`;
- `APPROVED`.

It must not create or imply a review candidate, merge authorization, deployment authorization, merge, or deployment.

The synthetic task remains a validation artifact until a later explicit governance action determines its disposition.

## Structured Security Audit Logging

A1 uses structured security logs plus persisted current claim state. It does not add a new audit table.

Events include:

```text
runner.claim.succeeded
runner.claim.empty
runner.claim.reclaimed
runner.claim.rejected
runner.heartbeat.succeeded
runner.heartbeat.rejected
runner.lease.expired
runner.release.succeeded
runner.release.rejected
runner.fenced
runner.authentication.failed
```

Permitted metadata includes:

- task ID;
- execution ID;
- Runner ID;
- claim epoch;
- execution status;
- execution purpose;
- claimed timestamp;
- lease-expiry timestamp;
- event name;
- machine-readable reason;
- event timestamp.

Logs must never contain:

- Runner bootstrap token;
- Worker Capability token;
- Owner token;
- CI token;
- authorization signatures;
- raw credential headers.

Long-term immutable audit/event persistence may be designed later as part of Drift Detector or governance hardening. It is not part of A1.

## Error and Fencing Contract

Representative deterministic failures:

```text
runner_credential_not_configured
runner_credential_required
runner_credential_invalid
runner_id_required
runner_already_holds_active_execution
stale_runner_fenced
runner_lease_expired
running_execution_release_denied
synthetic_execution_evidence_violation
runner_execution_not_eligible
```

Exact HTTP status selection may follow existing NestJS conventions, but stale ownership, invalid identity, ineligible routing, and invalid synthetic evidence must always fail closed.

No error path may broaden permission or fall back to a stronger credential class.

## Security Invariants

P0B-A1 is complete only if all of these remain true:

1. The Runner never receives the Human Owner credential.
2. The Runner never receives the Supervisor CI credential.
3. The Runner never receives production deployment authorization material.
4. The Runner has no GitHub write credential in A1.
5. Runner bootstrap identity cannot complete an execution by itself.
6. Execution Worker Capability is bound to current Runner ID and claim epoch.
7. A stale epoch is rejected immediately, independent of token expiry.
8. The database is authoritative for ownership and fencing.
9. Missing eligibility fails closed.
10. A1 production claims only explicitly marked synthetic implementation executions.
11. A `RUNNING` lease expiry never causes automatic execution replay.
12. Synthetic evidence cannot masquerade as repository implementation evidence.
13. Claim, merge, deployment authorization, deployment, and Runner enablement remain separate actions.
14. No blind retry occurs after an ambiguous write or execution outcome.

## Acceptance Test Matrix

### Positive path

The controlled synthetic smoke must prove:

```text
Task WORKING
  -> synthetic IMPLEMENTATION execution DISPATCHED
  -> Runner polls
  -> Runner claims
  -> lease created
  -> claimEpoch incremented
  -> fresh capability issued
  -> mark-running succeeds
  -> heartbeat renews lease
  -> heartbeat rotates capability
  -> synthetic no-op completion succeeds
  -> execution COMPLETED
  -> parent task remains WORKING
```

### Concurrency and fencing

Tests must prove:

- two Runner replicas racing for one execution result in exactly one owner;
- concurrent claimers skip a locked candidate rather than duplicate-own it;
- one Runner cannot own two active executions;
- reclaim of expired `DISPATCHED` increments epoch;
- capability from the prior epoch is rejected after reclaim;
- wrong Runner ID is rejected;
- stale epoch is rejected;
- heartbeat never increments epoch.

### Lease recovery

Tests must prove:

- expired `DISPATCHED` lease can be reclaimed;
- unexpired `DISPATCHED` lease cannot be stolen;
- expired `RUNNING` lease cannot be reclaimed automatically;
- `RUNNING` release is denied;
- ambiguous release does not trigger blind retry behavior.

### Authentication and privilege separation

Tests must prove:

- invalid Runner token is rejected;
- missing Runner token is rejected;
- missing Runner ID is rejected;
- Owner credential is not accepted as Runner fallback;
- CI credential is not accepted as Runner fallback;
- Runner bootstrap identity alone cannot call execution completion;
- capability cannot authorize another task/execution/Runner/epoch.

### Eligibility and rollout

Tests must prove:

- missing `runnerEligibility` is not claimable;
- `STANDARD` is not claimable in A1 production mode;
- `A1_SYNTHETIC` is claimable only for `IMPLEMENTATION`;
- verification-purpose executions are not claimable by the Engineering Runner;
- disabled Runner performs no claim polling.

### Synthetic evidence

Tests must prove:

- zero changed files are accepted;
- any changed file is rejected;
- `deploymentState != NONE` is rejected;
- `gitState != UNCHANGED` is rejected;
- review candidate is rejected;
- merge authorization evidence is rejected;
- deployment authorization evidence is rejected;
- synthetic completion does not advance the parent task.

## Implementation Boundary for P0B-A1

The implementation plan that follows this design may touch only the code required for the claim plane, minimal persistence migration, Worker Capability fencing, Runner service skeleton, and tests.

The plan must explicitly exclude real code-agent execution and repository mutation.

A1 implementation is successful when transport/security/concurrency behavior is proven without any source-code write performed by the Engineering Runner itself.

## Deferred Work

### P0B-A2 — Engineering Agent Engine

Expected later responsibilities include:

- exact-base repository checkout;
- isolated worktree lifecycle;
- actual Engineering Agent launch;
- allowed-path enforcement during implementation;
- tests/build execution;
- implementation evidence generation;
- controlled repository credentials and branch mutation, designed under a separate approval boundary.

### P0B-A3 — Independent Verification Runner

Expected later responsibilities include:

- separate verifier runner class;
- separate identity/credential scope;
- independent execution purpose;
- no trust collapse between implementer and verifier.

### Later governance hardening

Possible later work includes:

- durable immutable Runner audit-event storage;
- automated stale-running reconciliation helpers;
- Drift Detector integration;
- STANDARD execution enablement;
- multi-slot Runner design if horizontal replicas are insufficient.

None of these are silently included in A1.

## Decision Record

The approved design decisions are:

- A1 — Pull + Atomic Claim + Lease.
- C1 — Claim-time capability issuance with heartbeat rotation.
- D1 — 120-second lease, 30-second heartbeat, monotonic claimEpoch fencing.
- E1 — Minimal `SupervisorExecution` Prisma migration.
- F1 — PostgreSQL `FOR UPDATE SKIP LOCKED` atomic claim semantics; finalized as one short ownership transaction so claimEpoch and capability metadata commit together.
- G1 — Dedicated `ATLAS_SUPERVISOR_RUNNER_TOKEN` and per-process Runner ID.
- H1 — A1 claims `IMPLEMENTATION` only; verifier remains separate.
- I1 — One Runner process holds at most one active execution.
- J1 — 5-second polling, single-flight claim, exponential backoff, lease-based crash recovery.
- K1 — Claim does not change status; explicit mark-running performs `DISPATCHED -> RUNNING`.
- L1 — Separate Runner bootstrap API from execution Worker API.
- M1 — Expired `DISPATCHED` may be reclaimed; expired `RUNNING` fails closed pending reconciliation.
- N1 — Execution capabilities bind Runner ID and claimEpoch; database state is fencing authority.
- O1 — A1 scope is Claim Plane + Runner skeleton + synthetic lifecycle only.
- P1 — Heartbeat lease renewal and capability metadata rotation persist atomically.
- Q1 — Structured security logs; no new audit table; never log credentials/tokens.
- R1 — Production Runner disabled by default; synthetic-only smoke rollout.
- S1 — Explicit `runnerEligibility`; missing is fail-closed; A1 accepts only `A1_SYNTHETIC`.
- T1 — Server-enforced synthetic no-op evidence contract.
- U1 — Synthetic execution completion does not advance the parent task or enter integration pipelines.

## Spec Self-Review Result

This design contains no implementation authorization, no PR authorization, no merge authorization, no deployment authorization, and no Railway mutation authorization.

The design has no unresolved placeholders. Ownership, identity, claim atomicity, lease timing, fencing, capability rotation, crash behavior, production eligibility, synthetic evidence, logging, and acceptance criteria are explicit.

The only deliberate future boundaries are P0B-A2, P0B-A3, and later governance hardening, each of which requires a separate design/authorization path.
