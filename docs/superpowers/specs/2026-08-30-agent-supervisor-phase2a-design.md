# ATLAS Agent Supervisor Phase 2A Design

## Goal

Turn the existing ATLAS Engineering Supervisor MVP into a dispatch-capable control plane without introducing database migrations or deployment risk.

Phase 2A adds replaceable task/execution stores and a controlled worker dispatcher while preserving the existing Supervisor state machine, permission gate, file-ownership rules, and explicit user authorization requirements for protected Git and production actions.

## Context

ATLAS currently has two distinct agent systems that must remain separate:

1. Marketing Agent Workflow: planner, writer, reviewer, image-director, publisher.
2. Engineering Agent Control Plane: supervisor plus engineering, frontend, backend, database, qa, and infra worker roles.

The Engineering Supervisor already supports task registration, lifecycle transitions, dependency checks, file ownership, evidence capture, and permission checks. Its current persistence is process memory and it does not yet create or track worker execution records.

## Architectural Decision

Use a repository/store abstraction plus a controlled dispatcher.

The Supervisor must not depend directly on Map storage, Prisma, or a concrete worker runtime. Instead it depends on interfaces that can later receive Prisma-backed implementations without changing Supervisor orchestration semantics.

```text
AgentSupervisorService
    |
    +-- SupervisorTaskStore
    |      +-- MemorySupervisorTaskStore   [Phase 2A]
    |      +-- PrismaSupervisorTaskStore   [Phase 2B]
    |
    +-- SupervisorExecutionStore
    |      +-- MemorySupervisorExecutionStore [Phase 2A]
    |      +-- PrismaSupervisorExecutionStore [Phase 2B]
    |
    +-- FileOwnershipStore
    |      +-- MemoryFileOwnershipStore    [Phase 2A]
    |
    +-- WorkerDispatcherService
           +-- validates state
           +-- validates permission
           +-- validates file ownership
           +-- creates execution record
           +-- emits WorkerAssignmentEnvelope
```

## Non-Goals

Phase 2A does not:

- add Prisma models or migrations;
- persist tasks across API restarts;
- invoke Codex, GitHub Actions, Railway, shell workers, or external agents automatically;
- merge, rebase, squash, cherry-pick, auto-merge, force-push, or delete integration branches;
- deploy to Railway or any production environment;
- alter the existing Marketing Agent Workflow;
- allow a worker to self-approve a task.

## Domain Model

### Supervisor Task

The existing task remains the source of truth for business lifecycle state.

Task states:

```text
DRAFT
WORKING
BLOCKED
IMPLEMENTED
VERIFYING
READY_FOR_REVIEW
APPROVED
FAILED
```

Task status and worker execution status are intentionally separate.

### Worker Execution

A task may have zero or more worker executions. A retry creates a new execution record instead of overwriting prior history.

Execution states:

```text
QUEUED
DISPATCHED
RUNNING
COMPLETED
FAILED
CANCELLED
```

Execution record shape:

```ts
interface SupervisorExecution {
  id: string;
  taskId: string;
  workerRole: SupervisorWorkerRole;
  status: SupervisorExecutionStatus;
  assignment: WorkerAssignmentEnvelope;
  result: WorkerExecutionResult | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}
```

### Worker Assignment Envelope

The dispatcher produces one immutable assignment contract per execution:

```ts
interface WorkerAssignmentEnvelope {
  executionId: string;
  taskId: string;
  workerRole: SupervisorWorkerRole;
  objective: string;
  allowedPaths: string[];
  forbiddenActions: SupervisorAction[];
  dependencies: string[];
  acceptance: string[];
  requiredEvidence: Array<
    | 'rootCause'
    | 'changedFiles'
    | 'tests'
    | 'build'
    | 'regression'
    | 'deploymentState'
    | 'gitState'
    | 'remainingRisk'
  >;
}
```

The assignment does not grant permissions by itself. The permission matrix remains the upper bound.

## Store Interfaces

### SupervisorTaskStore

Required operations:

```ts
interface SupervisorTaskStore {
  list(): SupervisorTask[];
  get(id: string): SupervisorTask | null;
  create(task: SupervisorTask): SupervisorTask;
  save(task: SupervisorTask): SupervisorTask;
}
```

The store owns persistence only. It must not implement state-machine policy.

### SupervisorExecutionStore

Required operations:

```ts
interface SupervisorExecutionStore {
  listByTask(taskId: string): SupervisorExecution[];
  get(id: string): SupervisorExecution | null;
  create(execution: SupervisorExecution): SupervisorExecution;
  save(execution: SupervisorExecution): SupervisorExecution;
}
```

### FileOwnershipStore

Required operations:

```ts
interface FileOwnershipStore {
  findOwner(path: string): string | null;
  acquire(taskId: string, paths: string[]): void;
  release(taskId: string): void;
}
```

Phase 2A may use exact path matching only. Directory/glob ownership is deferred until a concrete requirement exists.

## Dispatcher Contract

`WorkerDispatcherService.dispatch(taskId)` performs the following sequence:

1. Load the task.
2. Require task state `WORKING`.
3. Confirm task owner is a worker role, never `supervisor`.
4. Confirm all task dependencies remain READY_FOR_REVIEW or APPROVED.
5. Confirm allowed paths are still owned by that task.
6. Evaluate the worker's minimum required permissions for the assignment.
7. Create a `QUEUED` execution record.
8. Convert it to `DISPATCHED`.
9. Return the immutable `WorkerAssignmentEnvelope` and execution snapshot.

Phase 2A stops at dispatch-contract creation. It does not invoke an external worker runtime.

## Execution Result Contract

A worker-runtime adapter in a later phase will submit:

```ts
interface WorkerExecutionResult {
  evidence: SupervisorEvidence;
  summary: string;
}
```

Phase 2A provides service methods to update execution status and record a result, but completion of an execution must not directly move the task to READY_FOR_REVIEW.

Allowed relationship:

```text
worker execution COMPLETED
        |
        v
Supervisor validates evidence
        |
        v
Task IMPLEMENTED
        |
        v
Supervisor/QA verification
        |
        v
READY_FOR_REVIEW
```

## Permission Rules

The current permission gate remains authoritative.

The dispatcher must enforce these invariants:

- protected integration actions remain denied to all worker roles;
- production deployment requires explicit user authorization;
- non-production deployment requires the existing authorization conditions;
- database schema/migration work is limited to database/supervisor roles and explicit task scope;
- auth/identity work requires explicit task scope and supervisor authorization for worker roles;
- an assignment cannot broaden permissions beyond the role matrix;
- missing permission definitions resolve to deny.

## File Ownership Rules

- One active task owns each mutable path.
- Ownership is acquired when a task enters WORKING.
- Dispatch is denied if required ownership is missing or conflicts.
- Ownership is released when the task becomes BLOCKED, FAILED, or READY_FOR_REVIEW.
- Retry from VERIFYING/IMPLEMENTED back to WORKING reacquires ownership through the existing Supervisor transition logic.

## Error Semantics

Use deterministic NestJS exceptions and stable error codes for API callers.

Examples:

```text
supervisor_task_not_found
invalid_transition
dependencies_not_ready
file_ownership_conflict
file_ownership_missing
worker_role_required
permission_denied
execution_not_found
invalid_execution_transition
```

A failed dispatch must not mutate task state.

## API Surface

Existing task endpoints stay compatible.

Phase 2A may add:

```text
POST /engineering/supervisor/tasks/:id/dispatch
GET  /engineering/supervisor/tasks/:id/executions
GET  /engineering/supervisor/executions/:executionId
POST /engineering/supervisor/executions/:executionId/running
POST /engineering/supervisor/executions/:executionId/complete
POST /engineering/supervisor/executions/:executionId/fail
POST /engineering/supervisor/executions/:executionId/cancel
```

The `complete` endpoint records a worker result. It must not approve or merge anything.

## Testing Strategy

Use TDD for production changes.

Required focused tests:

1. Task store returns defensive copies and preserves task state.
2. Execution store keeps multiple executions for one task.
3. File ownership store blocks conflicting task acquisition.
4. Dispatcher rejects non-WORKING tasks.
5. Dispatcher rejects missing file ownership.
6. Dispatcher creates a DISPATCHED execution with a complete assignment envelope.
7. Worker assignment cannot include protected integration authority.
8. Completing an execution records evidence but does not move the task to READY_FOR_REVIEW.
9. Execution transition rules reject invalid transitions.
10. Existing Supervisor lifecycle tests continue to pass after storage refactor.

Run the focused Supervisor test suite first, then API build/typecheck if an executable environment is available.

## Migration Strategy

Refactor in small, behavior-preserving steps:

1. Introduce store interfaces and in-memory implementations.
2. Move current task Map behind `SupervisorTaskStore`.
3. Move file-owner Map behind `FileOwnershipStore`.
4. Keep existing Supervisor public behavior unchanged and verify tests.
5. Add execution model/store.
6. Add dispatcher and tests.
7. Add controller endpoints.
8. Run focused regression and build checks.

No Prisma work belongs in Phase 2A.

## Phase 2B Boundary

Only after Phase 2A behavior is verified should persistence move to Prisma.

Phase 2B must separately design:

- Prisma task model;
- Prisma execution model;
- ownership representation and crash recovery;
- cleanup/retention policy;
- restart semantics for RUNNING/DISPATCHED executions;
- migration and rollback plan;
- database-memory impact.

That work requires a separate explicit scope because it touches a high-risk ATLAS database area.

## Safety Invariants

- User/owner authority is above Supervisor authority.
- Supervisor authority is above worker authority.
- Worker cannot mark READY_FOR_REVIEW or APPROVED.
- APPROVED does not imply merge or deployment permission.
- Generic commands such as continue, finish, fix, or deploy do not imply protected Git integration authorization.
- Merge/rebase/squash/cherry-pick/auto-merge/force-push/direct integration remain prohibited without explicit user authorization for the exact action.
- Implementation and deployment remain separate states.
- Missing verification is reported as NOT RUN, never PASS.
