# ATLAS Agent Supervisor Phase 2B Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 2A in-memory Supervisor runtime stores with Prisma-backed persistent stores while preserving lifecycle semantics, strengthening multi-instance concurrency guarantees, and closing the explicitly documented Phase 2A API/runtime gaps.

**Architecture:** Keep `AgentSupervisorService` and `WorkerDispatcherService` behind the existing store injection tokens. Convert store contracts to async, keep memory adapters for unit tests, add Prisma adapters for runtime, and enforce file ownership plus active-execution uniqueness in PostgreSQL. Runtime continues using the repository-global `DatabaseModule` / `PrismaService`; no independent Prisma client is created.

**Tech Stack:** NestJS 11, TypeScript 5.7, Prisma 7.9, PostgreSQL, Jest 29.

**Spec:** `docs/superpowers/specs/2026-08-30-agent-supervisor-phase2b-persistence-design.md`

## Global Constraints

- Migration is additive-only: create only `SupervisorTask`, `SupervisorExecution`, `SupervisorFileLock`, their foreign keys/indexes, and the partial unique active-execution index.
- Do not alter, rename, or drop existing ATLAS business tables/columns.
- Do not modify auth/workspace isolation.
- Do not invoke autonomous external workers.
- Do not change task lifecycle semantics.
- Worker completion must not transition a task to `READY_FOR_REVIEW`.
- `merge`, `rebase`, `squash`, `cherry_pick`, `auto_merge`, `force_push`, and `delete_branch_for_integration` remain protected actions.
- No production migration, Railway deployment, merge, rebase, squash, cherry-pick, auto-merge, force push, branch deletion, or direct PR integration.
- Production runtime must reuse `apps/api/src/database/prisma.service.ts` from the global `DatabaseModule`.
- All code-completion claims require fresh test/build evidence.

---

## File Structure

**Create:**
- `apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.ts` — domain ↔ Prisma record serialization and JSON validation.
- `apps/api/src/agent-supervisor/persistence/prisma-supervisor-task.store.ts` — persistent task adapter.
- `apps/api/src/agent-supervisor/persistence/prisma-supervisor-execution.store.ts` — persistent execution adapter.
- `apps/api/src/agent-supervisor/persistence/prisma-file-ownership.store.ts` — transactional persistent file-lock adapter.
- `apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.spec.ts` — mapper validation tests.
- `apps/api/src/agent-supervisor/persistence/prisma-supervisor-task.store.spec.ts` — Prisma task adapter tests with mocked Prisma service.
- `apps/api/src/agent-supervisor/persistence/prisma-supervisor-execution.store.spec.ts` — Prisma execution adapter tests with mocked Prisma service.
- `apps/api/src/agent-supervisor/persistence/prisma-file-ownership.store.spec.ts` — file-lock transaction/error translation tests with mocked Prisma service.
- `apps/api/prisma/migrations/20260830090000_agent_supervisor_persistence/migration.sql` — additive Supervisor schema migration including partial unique index.

**Modify:**
- `apps/api/prisma/schema.prisma`
- `apps/api/src/agent-supervisor/stores/supervisor-task.store.ts`
- `apps/api/src/agent-supervisor/stores/supervisor-execution.store.ts`
- `apps/api/src/agent-supervisor/stores/file-ownership.store.ts`
- `apps/api/src/agent-supervisor/stores/memory-supervisor-task.store.ts`
- `apps/api/src/agent-supervisor/stores/memory-supervisor-execution.store.ts`
- `apps/api/src/agent-supervisor/stores/memory-file-ownership.store.ts`
- `apps/api/src/agent-supervisor/agent-supervisor.service.ts`
- `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.ts`
- `apps/api/src/agent-supervisor/agent-supervisor.controller.ts`
- `apps/api/src/agent-supervisor/agent-supervisor.module.ts`
- existing Supervisor specs under `apps/api/src/agent-supervisor/**` to await async APIs and add hardening regression cases.

---

### Task 1: Convert Supervisor store contracts and memory adapters to async

**Files:**
- Modify: `apps/api/src/agent-supervisor/stores/supervisor-task.store.ts`
- Modify: `apps/api/src/agent-supervisor/stores/supervisor-execution.store.ts`
- Modify: `apps/api/src/agent-supervisor/stores/file-ownership.store.ts`
- Modify: `apps/api/src/agent-supervisor/stores/memory-supervisor-task.store.ts`
- Modify: `apps/api/src/agent-supervisor/stores/memory-supervisor-execution.store.ts`
- Modify: `apps/api/src/agent-supervisor/stores/memory-file-ownership.store.ts`
- Test: existing memory-store specs.

**Interfaces:**
- Produces:
  - `SupervisorTaskStore.list(): Promise<SupervisorTask[]>`
  - `SupervisorTaskStore.get(id): Promise<SupervisorTask | null>`
  - `SupervisorTaskStore.create(task): Promise<SupervisorTask>`
  - `SupervisorTaskStore.save(task): Promise<SupervisorTask>`
  - `SupervisorExecutionStore.listByTask(taskId): Promise<SupervisorExecution[]>`
  - `SupervisorExecutionStore.get(id): Promise<SupervisorExecution | null>`
  - `SupervisorExecutionStore.create(execution): Promise<SupervisorExecution>`
  - `SupervisorExecutionStore.save(execution): Promise<SupervisorExecution>`
  - `FileOwnershipStore.findOwner(path): Promise<string | null>`
  - `FileOwnershipStore.acquire(taskId, paths): Promise<void>`
  - `FileOwnershipStore.release(taskId): Promise<void>`

- [ ] **Step 1: Update the store-interface specs/usages to expect Promises**

Change tests to `await` every memory store call, for example:

```ts
const created = await store.create(task);
expect(await store.get(task.id)).toEqual(created);
```

- [ ] **Step 2: Run the memory-store specs and confirm they fail before implementation**

Run:

```bash
npm test --workspace apps/api -- --runInBand \
  src/agent-supervisor/stores/memory-supervisor-task.store.spec.ts \
  src/agent-supervisor/stores/memory-supervisor-execution.store.spec.ts \
  src/agent-supervisor/stores/memory-file-ownership.store.spec.ts
```

Expected: type/runtime failures until memory adapters become async.

- [ ] **Step 3: Convert interfaces and memory adapters to async without changing semantics**

Use `async` methods that preserve existing clone/isolation logic. Do not add timers, caching, or new behavior.

- [ ] **Step 4: Run the same three specs**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agent-supervisor/stores
git commit -m "refactor: make supervisor stores async"
```

---

### Task 2: Make Supervisor service and dispatcher async-compatible

**Files:**
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.service.ts`
- Modify: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.controller.ts`
- Test: `apps/api/src/agent-supervisor/agent-supervisor.service.spec.ts`
- Test: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.spec.ts`
- Test: `apps/api/src/agent-supervisor/agent-supervisor.controller.spec.ts`

**Interfaces:**
- Consumes the async store contracts from Task 1.
- Produces async service/controller methods with unchanged response shapes.

- [ ] **Step 1: Update existing Supervisor specs to await service/dispatcher/controller methods**

For each store-backed path, change calls such as:

```ts
const task = supervisor.createTask(input);
```

to:

```ts
const task = await supervisor.createTask(input);
```

- [ ] **Step 2: Run Supervisor specs to verify failure before implementation**

```bash
npm test --workspace apps/api -- --runInBand src/agent-supervisor
```

Expected: compile/test failures caused by Promise-returning stores.

- [ ] **Step 3: Propagate `async`/`await` through Supervisor service and dispatcher**

Every store read/write must be awaited. Avoid Promise leakage inside array predicates; dependency checks must use explicit awaited loops or `Promise.all` where safe.

- [ ] **Step 4: Keep controller routes behaviorally identical while returning awaited service/dispatcher results**

Nest may accept returned Promises, but controller specs should explicitly await them.

- [ ] **Step 5: Run Supervisor specs**

Expected: current Phase 2A suite PASS before persistence is introduced.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agent-supervisor
git commit -m "refactor: await supervisor persistence contracts"
```

---

### Task 3: Add additive Prisma schema and migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260830090000_agent_supervisor_persistence/migration.sql`

**Interfaces:**
- Produces Prisma models `SupervisorTask`, `SupervisorExecution`, `SupervisorFileLock`.
- Produces PostgreSQL partial unique index `SupervisorExecution_one_active_per_task`.

- [ ] **Step 1: Add the three models to `schema.prisma` exactly as defined by the Phase 2B spec**

`SupervisorTask` fields: `id`, `objective`, `owner`, `status`, `allowedPaths`, `forbiddenActions`, `dependsOn`, `acceptance`, `evidence`, `blockingReason`, `failureReason`, `createdAt`, `updatedAt`, plus relations.

`SupervisorExecution` fields: `id`, `taskId`, `workerRole`, `status`, `assignment`, `result`, `error`, `createdAt`, `startedAt`, `completedAt`, plus cascade task relation.

`SupervisorFileLock` fields: `path` primary key, `taskId`, `acquiredAt`, plus cascade task relation.

- [ ] **Step 2: Create migration SQL manually and keep it additive-only**

The migration must contain only `CREATE TABLE`, `CREATE INDEX`, `CREATE UNIQUE INDEX`, and `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` statements for the three new Supervisor tables.

Include:

```sql
CREATE UNIQUE INDEX "SupervisorExecution_one_active_per_task"
ON "SupervisorExecution" ("taskId")
WHERE "status" IN ('QUEUED', 'DISPATCHED', 'RUNNING');
```

Do not include any `DROP`, `RENAME`, or `ALTER COLUMN` statement.

- [ ] **Step 3: Validate schema without applying production migration**

Run in an isolated verification environment:

```bash
npx prisma validate --schema apps/api/prisma/schema.prisma
```

Expected: schema valid.

- [ ] **Step 4: Generate Prisma client locally**

```bash
npx prisma generate --schema apps/api/prisma/schema.prisma
```

Expected: generated client includes the three Supervisor delegates.

- [ ] **Step 5: Review migration text for destructive SQL**

Run:

```bash
grep -Ein 'DROP|RENAME|ALTER COLUMN|TRUNCATE|DELETE FROM' \
  apps/api/prisma/migrations/20260830090000_agent_supervisor_persistence/migration.sql
```

Expected: no output.

- [ ] **Step 6: Commit schema and migration only**

```bash
git add apps/api/prisma/schema.prisma \
  apps/api/prisma/migrations/20260830090000_agent_supervisor_persistence/migration.sql
git commit -m "feat: add supervisor persistence schema"
```

---

### Task 4: Implement persistence mapper and stable validation errors

**Files:**
- Create: `apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.ts`
- Create: `apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.spec.ts`

**Interfaces:**
- Produces `mapTaskRecord(record): SupervisorTask`.
- Produces `mapExecutionRecord(record): SupervisorExecution`.
- Produces JSON helpers that throw `InternalServerErrorException({ code: 'supervisor_persistence_error' })` for malformed persisted JSON.

- [ ] **Step 1: Write mapper tests for valid records and malformed JSON**

Test cases:
- arrays are returned as new arrays;
- evidence `null` round-trips;
- assignment/result objects map successfully;
- `assignment: null`, scalar JSON, or array JSON is rejected;
- malformed evidence JSON is rejected with `supervisor_persistence_error`.

- [ ] **Step 2: Run mapper spec and verify failure**

```bash
npm test --workspace apps/api -- --runInBand \
  src/agent-supervisor/persistence/supervisor-persistence.mapper.spec.ts
```

Expected: FAIL because mapper does not exist.

- [ ] **Step 3: Implement explicit mapping without exporting Prisma model types into domain services**

Use narrow structural record types local to the mapper. Clone arrays and JSON objects before returning domain values.

- [ ] **Step 4: Run mapper spec**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper*
git commit -m "feat: map supervisor persistence records"
```

---

### Task 5: Implement Prisma task store

**Files:**
- Create: `apps/api/src/agent-supervisor/persistence/prisma-supervisor-task.store.ts`
- Create: `apps/api/src/agent-supervisor/persistence/prisma-supervisor-task.store.spec.ts`

**Interfaces:**
- Consumes global `PrismaService` from `apps/api/src/database/prisma.service.ts`.
- Implements `SupervisorTaskStore`.

- [ ] **Step 1: Write tests with a typed minimal PrismaService mock**

Cover:
- `create` sends all domain fields;
- `get` returns null when delegate returns null;
- `list` orders by `createdAt: 'asc'`;
- `save` updates mutable fields and returns mapped row;
- returned arrays/JSON cannot mutate retained record fixtures.

- [ ] **Step 2: Run task-store spec and verify failure**

```bash
npm test --workspace apps/api -- --runInBand \
  src/agent-supervisor/persistence/prisma-supervisor-task.store.spec.ts
```

- [ ] **Step 3: Implement `PrismaSupervisorTaskStore`**

Inject `PrismaService`. Use `prisma.supervisorTask.create/findUnique/findMany/update`. Map all results through `supervisor-persistence.mapper.ts`.

- [ ] **Step 4: Translate unexpected persistence failures**

Do not expose raw Prisma error codes/messages. Re-throw application/domain exceptions unchanged; wrap unknown persistence failures as `InternalServerErrorException({ code: 'supervisor_persistence_error' })`.

- [ ] **Step 5: Run task-store spec**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agent-supervisor/persistence/prisma-supervisor-task.store*
git commit -m "feat: persist supervisor tasks"
```

---

### Task 6: Implement Prisma execution store with active-execution conflict translation

**Files:**
- Create: `apps/api/src/agent-supervisor/persistence/prisma-supervisor-execution.store.ts`
- Create: `apps/api/src/agent-supervisor/persistence/prisma-supervisor-execution.store.spec.ts`

**Interfaces:**
- Implements `SupervisorExecutionStore`.
- Converts the database uniqueness failure for one active execution per task to `ConflictException({ code: 'active_execution_exists', ... })`.

- [ ] **Step 1: Write tests**

Cover:
- `listByTask` orders by `createdAt: 'asc'`;
- `get` null handling;
- create/save round-trip;
- Prisma uniqueness error from active partial index maps to `active_execution_exists`;
- unrelated database errors map to `supervisor_persistence_error`.

- [ ] **Step 2: Run spec and verify failure**

```bash
npm test --workspace apps/api -- --runInBand \
  src/agent-supervisor/persistence/prisma-supervisor-execution.store.spec.ts
```

- [ ] **Step 3: Implement execution adapter**

Use `prisma.supervisorExecution.create/findUnique/findMany/update` and mapper functions.

- [ ] **Step 4: Implement narrow unique-error recognition**

Recognize Prisma known request uniqueness errors without returning raw Prisma metadata. If uniqueness occurs while creating active execution, return stable `active_execution_exists`.

- [ ] **Step 5: Run spec**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agent-supervisor/persistence/prisma-supervisor-execution.store*
git commit -m "feat: persist supervisor executions"
```

---

### Task 7: Implement transactional Prisma file ownership store

**Files:**
- Create: `apps/api/src/agent-supervisor/persistence/prisma-file-ownership.store.ts`
- Create: `apps/api/src/agent-supervisor/persistence/prisma-file-ownership.store.spec.ts`

**Interfaces:**
- Implements `FileOwnershipStore`.
- `acquire(taskId, paths)` is all-or-nothing.

- [ ] **Step 1: Write tests for normalization, transaction use, conflict translation, and release scoping**

Required cases:
- duplicate input paths are de-duplicated before insert;
- competing path causes `file_ownership_conflict`;
- conflict aborts the transaction and leaves no partial successful set;
- `findOwner` returns task ID or null;
- `release(taskId)` uses `deleteMany({ where: { taskId } })` only.

- [ ] **Step 2: Run spec and verify failure**

```bash
npm test --workspace apps/api -- --runInBand \
  src/agent-supervisor/persistence/prisma-file-ownership.store.spec.ts
```

- [ ] **Step 3: Implement transaction**

Normalize with trimmed non-empty unique paths. Execute all creates inside `prisma.$transaction(async tx => { ... })`.

- [ ] **Step 4: Translate uniqueness conflicts to `ConflictException`**

Return `{ code: 'file_ownership_conflict', conflicts: [...] }`; never leak raw SQL/Prisma details.

- [ ] **Step 5: Run spec**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agent-supervisor/persistence/prisma-file-ownership.store*
git commit -m "feat: persist supervisor file locks"
```

---

### Task 8: Close Phase 2A dispatcher and API hardening gaps

**Files:**
- Modify: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.ts`
- Modify: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.service.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.service.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.controller.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.controller.spec.ts`

**Interfaces:**
- Adds `GET /engineering/supervisor/executions/:id`.
- Adds `active_execution_exists` pre-check.
- Adds `invalid_worker_result` validation.
- Guarantees protected integration actions are always forbidden in worker assignment.

- [ ] **Step 1: Add failing dispatcher tests**

Add tests for:
- dispatch rejected if any existing execution is `QUEUED`, `DISPATCHED`, or `RUNNING`;
- terminal execution permits retry;
- dependency becomes unready immediately before dispatch;
- protected actions are unioned into every assignment's `forbiddenActions`;
- malformed completion payload/evidence returns `invalid_worker_result`;
- invalid execution transition returns `invalid_execution_transition`;
- completion still does not change task to `READY_FOR_REVIEW`.

- [ ] **Step 2: Add failing service validation test**

Runtime `owner` must reject values outside:

```ts
['engineering', 'frontend', 'backend', 'database', 'qa', 'infra']
```

including `'supervisor'`.

- [ ] **Step 3: Add failing controller test for `GET executions/:id`**

Controller must delegate to `dispatcher.getExecution(id)`.

- [ ] **Step 4: Run Supervisor suite and confirm failures**

```bash
npm test --workspace apps/api -- --runInBand src/agent-supervisor
```

- [ ] **Step 5: Implement minimal hardening**

Use a constant protected-action list. Before dispatch, await execution history and reject if any active state exists. Validate worker result shape before accessing nested fields. Restore consistent `ConflictException` for file conflicts.

- [ ] **Step 6: Run Supervisor suite**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/agent-supervisor
git commit -m "fix: harden supervisor dispatch invariants"
```

---

### Task 9: Switch runtime injection tokens to Prisma stores

**Files:**
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.module.ts`

**Interfaces:**
- `SUPERVISOR_TASK_STORE` → `PrismaSupervisorTaskStore`
- `SUPERVISOR_EXECUTION_STORE` → `PrismaSupervisorExecutionStore`
- `FILE_OWNERSHIP_STORE` → `PrismaFileOwnershipStore`
- Memory stores remain available for tests but are not runtime token targets.

- [ ] **Step 1: Add/update module test if a module-provider assertion exists; otherwise add a focused provider-resolution spec**

Use Nest testing module with mocked `PrismaService` and verify injection tokens resolve to Prisma adapter classes.

- [ ] **Step 2: Run focused module/provider spec and confirm failure**

- [ ] **Step 3: Register Prisma adapters and change the three token aliases**

Do not instantiate a Prisma client. `DatabaseModule` is global and exports the existing `PrismaService`.

- [ ] **Step 4: Run focused provider spec**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agent-supervisor/agent-supervisor.module.ts \
  apps/api/src/agent-supervisor/**/*module*.spec.ts
git commit -m "feat: wire supervisor prisma stores"
```

---

### Task 10: Isolated PostgreSQL integration verification

**Files:**
- Test additions may live under `apps/api/src/agent-supervisor/persistence/*.integration.spec.ts` only if the repository has a safe isolated database harness available at execution time.
- Do not point any integration test at Railway production or the normal production `DATABASE_URL`.

**Interfaces:**
- Verifies actual PostgreSQL constraints, not only mocked Prisma behavior.

- [ ] **Step 1: Provision or identify an isolated disposable PostgreSQL test database**

Set its URL explicitly in a shell-local variable such as `SUPERVISOR_TEST_DATABASE_URL`. Abort this task if the only available database is production/shared ATLAS data.

- [ ] **Step 2: Apply the Phase 2B migration to the isolated database only**

Use a command that overrides `DATABASE_URL` for the one process. Do not run `npm run db:migrate` against production configuration.

- [ ] **Step 3: Run integration cases**

Verify:
- task survives new Prisma/store instance;
- execution history survives new store instance;
- file lock survives new store instance;
- second active execution for same task fails;
- terminal execution permits new active execution;
- competing file lock fails;
- multi-path conflicting acquire leaves zero partial new locks;
- deleting a test task cascades its execution and file locks.

- [ ] **Step 4: Record exact command and PASS/FAIL output in verification notes**

If isolated DB cannot be safely provisioned, mark integration verification `NOT RUN`; do not substitute production.

---

### Task 11: Full regression and build verification

**Files:**
- No implementation changes unless a test/build failure reveals a scoped defect.

- [ ] **Step 1: Verify Prisma schema**

```bash
npx prisma validate --schema apps/api/prisma/schema.prisma
```

Expected: PASS.

- [ ] **Step 2: Generate Prisma client**

```bash
npx prisma generate --schema apps/api/prisma/schema.prisma
```

Expected: PASS.

- [ ] **Step 3: Run Supervisor tests**

```bash
npm test --workspace apps/api -- --runInBand src/agent-supervisor
```

Expected: all Supervisor suites PASS.

- [ ] **Step 4: Run related API regression**

```bash
npm test --workspace apps/api -- --runInBand \
  src/agent-supervisor \
  src/agent-workflow \
  src/engineering
```

Expected: PASS.

- [ ] **Step 5: Build API**

```bash
npm run build --workspace apps/api
```

Expected: background-job regression guard PASS and Nest build exits 0.

- [ ] **Step 6: Inspect final scope**

Compare against the Phase 2B design/spec base. Confirm no auth/workspace/business-table/Railway changes were introduced outside the explicit Supervisor migration and files.

- [ ] **Step 7: Report evidence without deployment/integration claims**

Required report fields:

```text
Phase 2B implementation: IMPLEMENTED or VERIFIED
Prisma validate: PASS / FAIL / NOT RUN
Prisma generate: PASS / FAIL / NOT RUN
Supervisor tests: <passed>/<total> or NOT RUN
Related regression: PASS / FAIL / NOT RUN
API build: PASS / FAIL / NOT RUN
Isolated DB integration: PASS / FAIL / NOT RUN
Migration review: ADDITIVE-ONLY / ISSUE FOUND
Production migration: NOT PERFORMED
Merge: NOT PERFORMED
Rebase: NOT PERFORMED
Deployment: NOT PERFORMED
Remaining risk: <explicit list>
```

Do not mark `READY_FOR_REVIEW` unless required fresh evidence is present.
