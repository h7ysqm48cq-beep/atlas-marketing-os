# ATLAS Agent Supervisor Phase 2B — Prisma Persistence Design

## Status

Proposed design for persistent Supervisor task, execution, and file-lock state. This phase replaces production in-memory stores with Prisma-backed stores while preserving Phase 2A domain behavior and API semantics.

## Goal

Persist ATLAS Supervisor control-plane state across API restarts and multiple API instances without weakening task lifecycle, execution, file-ownership, or Git safety guarantees.

## Non-goals

Phase 2B does not:

- invoke autonomous external workers;
- change the existing task lifecycle;
- make worker completion equivalent to review approval;
- modify ATLAS marketing workflow semantics;
- modify authentication/workspace isolation;
- deploy or migrate Railway production;
- alter or delete existing business tables or columns;
- add merge, rebase, squash, cherry-pick, auto-merge, force-push, or direct integration authority.

## Architecture

Phase 2A store interfaces remain the boundary used by `AgentSupervisorService` and `WorkerDispatcherService`.

```text
AgentSupervisorService / WorkerDispatcherService
        |
        +-- SUPERVISOR_TASK_STORE
        |       +-- MemorySupervisorTaskStore       (unit tests)
        |       +-- PrismaSupervisorTaskStore       (runtime)
        |
        +-- SUPERVISOR_EXECUTION_STORE
        |       +-- MemorySupervisorExecutionStore  (unit tests)
        |       +-- PrismaSupervisorExecutionStore  (runtime)
        |
        +-- FILE_OWNERSHIP_STORE
                +-- MemoryFileOwnershipStore        (unit tests)
                +-- PrismaFileOwnershipStore        (runtime)
```

Domain services must not import Prisma model types directly. Prisma-specific serialization/deserialization stays inside adapter classes.

## Data model

### `SupervisorTask`

```prisma
model SupervisorTask {
  id               String   @id
  objective        String
  owner            String
  status           String
  allowedPaths     String[] @default([])
  forbiddenActions String[] @default([])
  dependsOn        String[] @default([])
  acceptance       String[] @default([])
  evidence         Json?
  blockingReason   String?
  failureReason    String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  executions SupervisorExecution[]
  fileLocks  SupervisorFileLock[]

  @@index([status, createdAt])
  @@index([owner, status])
}
```

The database stores `owner`, `status`, and action strings as text in Phase 2B. Application validation remains authoritative. This avoids Prisma enum churn while the Supervisor control contract is still evolving. Converting these fields to database enums is deferred until the lifecycle is stable.

### `SupervisorExecution`

```prisma
model SupervisorExecution {
  id          String   @id
  taskId      String
  workerRole  String
  status      String
  assignment  Json
  result      Json?
  error       String?
  createdAt   DateTime @default(now())
  startedAt   DateTime?
  completedAt DateTime?

  task SupervisorTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId, createdAt])
  @@index([taskId, status])
}
```

Assignment and result remain JSON because they are bounded envelopes already validated by the application contract. Execution history is append-oriented: retries create new execution records rather than overwriting history.

### `SupervisorFileLock`

```prisma
model SupervisorFileLock {
  path       String   @id
  taskId     String
  acquiredAt DateTime @default(now())

  task SupervisorTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId])
}
```

`path` is the primary key so PostgreSQL itself enforces one owner per mutable path across multiple API instances.

## Active execution invariant

A task may have at most one active execution where status is one of:

- `QUEUED`
- `DISPATCHED`
- `RUNNING`

Prisma cannot express a partial unique index in the schema DSL. The migration SQL therefore creates a PostgreSQL partial unique index:

```sql
CREATE UNIQUE INDEX "SupervisorExecution_one_active_per_task"
ON "SupervisorExecution" ("taskId")
WHERE "status" IN ('QUEUED', 'DISPATCHED', 'RUNNING');
```

The dispatcher must also perform a pre-check to return a stable domain error (`active_execution_exists`), but the database constraint is the final concurrency authority.

Terminal states `COMPLETED`, `FAILED`, and `CANCELLED` do not participate in the unique index, so retries retain prior history.

## File-lock transaction semantics

`PrismaFileOwnershipStore.acquire(taskId, paths)` must be atomic for the complete requested path set.

Required behavior:

1. normalize and de-duplicate paths before persistence;
2. start a Prisma transaction;
3. insert all requested locks;
4. if any insert conflicts with an existing `path`, rollback the entire transaction;
5. translate PostgreSQL/Prisma uniqueness failure into `ConflictException` with code `file_ownership_conflict` and conflicting path information where determinable;
6. never leave a partial lock set after a failed acquire.

`release(taskId)` removes only rows owned by that task.

## Task persistence semantics

`PrismaSupervisorTaskStore` implements the existing store contract:

```ts
list(): Promise<SupervisorTask[]>
get(id: string): Promise<SupervisorTask | null>
create(task: SupervisorTask): Promise<SupervisorTask>
save(task: SupervisorTask): Promise<SupervisorTask>
```

If the existing interface is currently synchronous, Phase 2B changes all Supervisor store interfaces and their service consumers to async. Memory implementations become async adapters too so runtime and tests share identical contracts.

No service may cache a task as authoritative state after a write. Reads must come from the store so restart and multi-instance behavior remain correct.

## Execution persistence semantics

`PrismaSupervisorExecutionStore` implements:

```ts
listByTask(taskId: string): Promise<SupervisorExecution[]>
get(id: string): Promise<SupervisorExecution | null>
create(execution: SupervisorExecution): Promise<SupervisorExecution>
save(execution: SupervisorExecution): Promise<SupervisorExecution>
```

`listByTask` returns creation order ascending to preserve Phase 2A behavior.

`create` must translate the partial unique-index violation into the stable error `active_execution_exists` when an active execution already exists for the same task.

## Serialization

Adapters explicitly map between Prisma records and domain interfaces.

Rules:

- `DateTime` values become JavaScript `Date` values;
- string arrays are copied before returning;
- JSON assignment/result/evidence values are validated as objects before mapping;
- malformed persisted JSON fails loudly with a stable internal persistence error rather than being silently coerced;
- callers never receive a mutable reference retained by an adapter.

## Runtime wiring

`AgentSupervisorModule` runtime providers switch the three injection tokens to Prisma implementations.

Memory stores remain exported for tests but are not production token targets.

Prisma stores depend on the repository's existing Prisma service/module pattern; Phase 2B must reuse that infrastructure rather than constructing independent Prisma clients.

## API hardening included in Phase 2B

Phase 2B closes the following Phase 2A gaps without changing the public lifecycle:

1. Add `GET /engineering/supervisor/executions/:id`.
2. Reject dispatch when an active execution already exists with `active_execution_exists`.
3. Re-check task dependencies and file ownership immediately before dispatch.
4. Validate `WorkerExecutionResult` before dereferencing nested evidence.
5. Ensure every worker assignment's forbidden actions includes protected integration actions even if the task creator omitted them:
   - `merge`
   - `rebase`
   - `squash`
   - `cherry_pick`
   - `auto_merge`
   - `force_push`
   - `delete_branch_for_integration`
6. Worker completion stores execution evidence only; it does not transition the task to `READY_FOR_REVIEW`.
7. Runtime owner validation accepts only `engineering`, `frontend`, `backend`, `database`, `qa`, or `infra`.
8. File ownership conflicts use `ConflictException` consistently.

## Error contract

Stable domain codes required after Phase 2B:

- `supervisor_task_not_found`
- `invalid_transition`
- `dependencies_not_ready`
- `file_ownership_conflict`
- `file_ownership_missing`
- `worker_role_required`
- `permission_denied`
- `execution_not_found`
- `invalid_execution_transition`
- `task_not_dispatchable`
- `active_execution_exists`
- `invalid_worker_result`
- `supervisor_persistence_error`

Prisma error codes, SQLSTATE values, stack traces, and raw database messages must not become the API contract.

## Migration safety

The Phase 2B migration is additive-only.

Allowed:

- create `SupervisorTask`;
- create `SupervisorExecution`;
- create `SupervisorFileLock`;
- create foreign keys;
- create ordinary indexes;
- create the partial unique active-execution index.

Forbidden:

- drop or rename any existing table or column;
- alter existing ATLAS business columns;
- modify auth/workspace schema;
- destructive data migration;
- production migration execution;
- Railway deployment.

Because Phase 2A state is in-memory, there is no historical Supervisor data to backfill. Migration starts with empty Supervisor tables.

## Testing strategy

### Store contract tests

Run the same behavioral contract against memory and Prisma implementations wherever practical:

- create/get/list/save task;
- defensive copies / mutation isolation;
- execution history ordering;
- result/evidence round-trip;
- file-lock acquire/release;
- file-lock conflict atomicity.

### Persistence integration tests

With an isolated test database:

- task survives a new store instance;
- execution survives a new store instance;
- file lock survives a new store instance;
- duplicate active execution is rejected;
- a terminal execution permits a retry;
- competing file lock is rejected;
- failed multi-path acquire leaves no partial locks;
- task cascade deletes execution and file-lock rows in the isolated test database only.

### Service/dispatcher regression

Preserve the Phase 2A suite and add tests for:

- dependency becomes unready before dispatch;
- duplicate active dispatch;
- protected integration actions are always forbidden in assignment;
- malformed completion evidence returns `invalid_worker_result`;
- invalid execution transitions;
- `GET executions/:id` controller route;
- completion does not promote task review status.

### Required verification

Before Phase 2B can be called verified:

```bash
npm test --workspace apps/api -- --runInBand src/agent-supervisor
npm test --workspace apps/api -- --runInBand src/agent-supervisor src/agent-workflow src/engineering
npm run build --workspace apps/api
```

If Prisma integration tests use a separate script or database harness, that command must also pass and be reported explicitly.

## Rollout

Phase 2B code completion is not production rollout.

Required order:

1. schema/design review;
2. migration SQL review;
3. generated Prisma client verification;
4. isolated database tests;
5. Supervisor regression tests;
6. related API regression tests;
7. API build;
8. report `READY_FOR_REVIEW` only after evidence is present;
9. production migration/deployment remains a separate explicitly authorized operation.

## Acceptance criteria

Phase 2B is complete only when:

- Supervisor task/execution/file-lock state persists across store recreation;
- multi-instance file ownership is protected by PostgreSQL uniqueness;
- at most one active execution exists per task at the database level;
- retries preserve terminal execution history;
- Phase 2A public lifecycle remains unchanged;
- workers cannot gain protected integration authority through assignment payloads;
- all required Supervisor tests and API build pass with fresh evidence;
- migration is additive-only and reviewed;
- no production migration, merge, rebase, or deployment has occurred.
