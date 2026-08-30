# ATLAS Agent Supervisor Phase 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Engineering Supervisor into replaceable in-memory stores and add a controlled Worker Dispatcher that creates immutable execution assignments without adding database migrations or external worker execution.

**Architecture:** Keep `AgentSupervisorService` as the orchestration boundary. Move task persistence and file ownership into injected store abstractions, add a separate execution store, and add `WorkerDispatcherService` that validates state, ownership, dependencies, and permission before creating a dispatch record. Phase 2A remains fully in-memory and does not invoke external workers.

**Tech Stack:** NestJS 11, TypeScript 5.7, Jest 29, existing ATLAS EngineeringModule.

**Spec:** `docs/superpowers/specs/2026-08-30-agent-supervisor-phase2a-design.md`

## Global Constraints

- No Prisma models or migrations.
- No Railway or production deployment.
- No merge, rebase, squash, cherry-pick, auto-merge, force-push, or integration branch deletion.
- Existing Marketing Agent Workflow remains unchanged.
- Worker assignment cannot broaden role permissions.
- One active task owns each mutable path.
- Worker execution completion cannot self-promote a task to READY_FOR_REVIEW.

---

### Task 1: Extract task and file-ownership stores

**Files:**
- Create: `apps/api/src/agent-supervisor/stores/supervisor-task.store.ts`
- Create: `apps/api/src/agent-supervisor/stores/memory-supervisor-task.store.ts`
- Create: `apps/api/src/agent-supervisor/stores/file-ownership.store.ts`
- Create: `apps/api/src/agent-supervisor/stores/memory-file-ownership.store.ts`
- Create: `apps/api/src/agent-supervisor/stores/memory-supervisor-task.store.spec.ts`
- Create: `apps/api/src/agent-supervisor/stores/memory-file-ownership.store.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.service.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.module.ts`

**Interfaces:**
- Produces `SUPERVISOR_TASK_STORE`, `SupervisorTaskStore`, `FILE_OWNERSHIP_STORE`, `FileOwnershipStore`.
- `AgentSupervisorService` consumes both interfaces by Nest injection token.

- [ ] **Step 1: Write failing store tests**

```ts
it('saves and returns cloned tasks', () => {
  const store = new MemorySupervisorTaskStore();
  const saved = store.create(taskFixture());
  saved.objective = 'mutated';
  expect(store.get(saved.id)?.objective).not.toBe('mutated');
});

it('rejects ownership conflicts without replacing the current owner', () => {
  const store = new MemoryFileOwnershipStore();
  store.acquire('ATLAS-1', ['a.ts']);
  expect(() => store.acquire('ATLAS-2', ['a.ts'])).toThrow();
  expect(store.findOwner('a.ts')).toBe('ATLAS-1');
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:
`npm test --workspace apps/api -- --runInBand agent-supervisor/stores/memory-supervisor-task.store.spec.ts agent-supervisor/stores/memory-file-ownership.store.spec.ts`

Expected: FAIL because the store classes do not exist.

- [ ] **Step 3: Implement minimal store interfaces and in-memory implementations**

```ts
export const SUPERVISOR_TASK_STORE = Symbol('SUPERVISOR_TASK_STORE');
export interface SupervisorTaskStore {
  list(): SupervisorTask[];
  get(id: string): SupervisorTask | null;
  create(task: SupervisorTask): SupervisorTask;
  save(task: SupervisorTask): SupervisorTask;
}
```

```ts
export const FILE_OWNERSHIP_STORE = Symbol('FILE_OWNERSHIP_STORE');
export interface FileOwnershipStore {
  findOwner(path: string): string | null;
  acquire(taskId: string, paths: string[]): void;
  release(taskId: string): void;
}
```

- [ ] **Step 4: Refactor `AgentSupervisorService` to use injected stores**

Remove its internal task/file maps. Preserve public behavior and existing exception semantics.

- [ ] **Step 5: Run existing Supervisor tests plus new store tests**

Run:
`npm test --workspace apps/api -- --runInBand agent-supervisor`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agent-supervisor
git commit -m "refactor: extract supervisor stores"
```

### Task 2: Add worker execution domain and execution store

**Files:**
- Create: `apps/api/src/agent-supervisor/execution/supervisor-execution.types.ts`
- Create: `apps/api/src/agent-supervisor/stores/supervisor-execution.store.ts`
- Create: `apps/api/src/agent-supervisor/stores/memory-supervisor-execution.store.ts`
- Create: `apps/api/src/agent-supervisor/stores/memory-supervisor-execution.store.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.module.ts`

**Interfaces:**
- Produces `SupervisorExecutionStatus`, `WorkerAssignmentEnvelope`, `WorkerExecutionResult`, `SupervisorExecution`.
- Produces `SUPERVISOR_EXECUTION_STORE` and `SupervisorExecutionStore`.

- [ ] **Step 1: Write failing execution store tests**

```ts
it('keeps execution history per task in creation order', () => {
  const store = new MemorySupervisorExecutionStore();
  store.create(executionFixture('EXEC-1', 'ATLAS-1'));
  store.create(executionFixture('EXEC-2', 'ATLAS-1'));
  expect(store.listByTask('ATLAS-1').map((x) => x.id)).toEqual(['EXEC-1', 'EXEC-2']);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:
`npm test --workspace apps/api -- --runInBand agent-supervisor/stores/memory-supervisor-execution.store.spec.ts`

Expected: FAIL because the execution store does not exist.

- [ ] **Step 3: Implement types and memory execution store**

Execution states are exactly:
`QUEUED | DISPATCHED | RUNNING | COMPLETED | FAILED | CANCELLED`.

- [ ] **Step 4: Register execution store provider**

Use Nest injection token, with Phase 2A bound to memory implementation.

- [ ] **Step 5: Run focused tests**

Run:
`npm test --workspace apps/api -- --runInBand agent-supervisor/stores/memory-supervisor-execution.store.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agent-supervisor
git commit -m "feat: add supervisor execution store"
```

### Task 3: Add controlled Worker Dispatcher

**Files:**
- Create: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.ts`
- Create: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.service.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.module.ts`

**Interfaces:**
- `dispatch(taskId: string): { execution: SupervisorExecution; assignment: WorkerAssignmentEnvelope }`
- `markRunning(executionId: string): SupervisorExecution`
- `complete(executionId: string, result: WorkerExecutionResult): SupervisorExecution`
- `fail(executionId: string, error: string): SupervisorExecution`
- `cancel(executionId: string, reason: string): SupervisorExecution`

- [ ] **Step 1: Write failing dispatcher tests**

Cover these behaviors independently:

```ts
it('dispatches a WORKING task with owned files');
it('rejects dispatch when task is not WORKING');
it('rejects dispatch when file ownership was lost');
it('rejects dispatch when dependencies are no longer ready');
it('creates a new execution for each retry');
it('does not move the task to READY_FOR_REVIEW when execution completes');
```

- [ ] **Step 2: Run focused dispatcher tests and verify RED**

Run:
`npm test --workspace apps/api -- --runInBand agent-supervisor/dispatch/worker-dispatcher.service.spec.ts`

Expected: FAIL because dispatcher is not implemented.

- [ ] **Step 3: Implement minimal dispatcher**

Dispatch sequence must be:

```text
load task -> require WORKING -> validate dependencies -> validate ownership -> permission check -> create QUEUED -> save DISPATCHED -> return envelope
```

Assignment required evidence fields are exactly:
`rootCause, changedFiles, tests, build, regression, deploymentState, gitState, remainingRisk`.

- [ ] **Step 4: Implement execution transition methods**

Allowed execution transitions:

```text
DISPATCHED -> RUNNING
RUNNING -> COMPLETED | FAILED | CANCELLED
DISPATCHED -> CANCELLED
```

Any other transition throws `invalid_execution_transition`.

- [ ] **Step 5: Run dispatcher and Supervisor tests**

Run:
`npm test --workspace apps/api -- --runInBand agent-supervisor`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agent-supervisor
git commit -m "feat: add controlled worker dispatcher"
```

### Task 4: Expose dispatch and execution APIs

**Files:**
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.controller.ts`
- Create: `apps/api/src/agent-supervisor/agent-supervisor.controller.spec.ts`

**Interfaces:**
- `POST /engineering/supervisor/tasks/:id/dispatch`
- `GET /engineering/supervisor/tasks/:id/executions`
- `POST /engineering/supervisor/executions/:id/running`
- `POST /engineering/supervisor/executions/:id/complete`
- `POST /engineering/supervisor/executions/:id/fail`
- `POST /engineering/supervisor/executions/:id/cancel`

- [ ] **Step 1: Write failing controller tests**

Assert that controller delegates to Supervisor/Dispatcher services and does not bypass domain validation.

- [ ] **Step 2: Run controller tests and verify RED**

Run:
`npm test --workspace apps/api -- --runInBand agent-supervisor/agent-supervisor.controller.spec.ts`

Expected: FAIL because endpoints are absent.

- [ ] **Step 3: Add minimal endpoints**

No endpoint may accept arbitrary role escalation or permission override fields.

- [ ] **Step 4: Run all Agent Supervisor tests**

Run:
`npm test --workspace apps/api -- --runInBand agent-supervisor`

Expected: PASS.

- [ ] **Step 5: Run API build**

Run:
`npm run build --workspace apps/api`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agent-supervisor
git commit -m "feat: expose supervisor dispatch api"
```

### Task 5: Regression and scope verification

**Files:**
- No new production files unless a verification defect is found.

- [ ] **Step 1: Run focused regression suite**

Run:
`npm test --workspace apps/api -- --runInBand agent-supervisor agent-workflow engineering`

Expected: PASS.

- [ ] **Step 2: Run API build**

Run:
`npm run build --workspace apps/api`

Expected: PASS.

- [ ] **Step 3: Verify repository diff**

Confirm only Supervisor Phase 2A files and necessary `EngineeringModule` wiring changed. Confirm no Prisma schema, migration, Railway, marketing agent workflow, or deployment files changed.

- [ ] **Step 4: Report integration state**

Required report values unless separately authorized:

```text
Merge: NOT PERFORMED
Deployment: NOT PERFORMED
Prisma migration: NOT PERFORMED
```
