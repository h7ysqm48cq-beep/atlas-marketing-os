# ATLAS Agent Supervisor Runtime Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ATLAS Supervisor the mandatory admission and integration authority for Codex, ChatGPT Work coding flows, ChatGPT coding agents, and future external code workers.

**Architecture:** Add a focused gateway service on top of the existing persisted Supervisor task/execution/file-lock model. External workers are validated against persisted assignments, changed files are checked against exact allowed paths, implementation evidence must come from a completed execution, and integration decisions bind to exact Git state plus explicit owner authorization. A dedicated CI-only guard exposes a narrow validation endpoint for GitHub Actions; no Prisma migration is required in this increment.

**Tech Stack:** NestJS, TypeScript, Jest, Prisma-backed existing Supervisor stores, GitHub Actions, Railway environment configuration for a later deployment gate.

**Spec:** `docs/superpowers/specs/2026-09-01-agent-supervisor-runtime-gateway-design.md`

## Global Constraints

- `production/atlas` remains the canonical production integration line.
- All code-agent work must have a Supervisor task and execution before it is considered integratable.
- Missing Supervisor state fails closed.
- Worker assignments cannot grant protected integration actions.
- Changed files must be a subset of persisted assignment scope.
- No Prisma schema or migration change in this increment.
- No production secret/config mutation during implementation.
- No merge or production deploy merely because implementation/tests pass.
- Final task state before integration is `READY_FOR_REVIEW`.
- Browser Worker reconciliation remains a separate Supervisor task: `ATLAS-20260901-BROWSER-RECON-001`.

---

### Task 1: Add deterministic external-worker and repository-path types

**Files:**
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.types.ts`
- Test: `apps/api/src/agent-supervisor/gateway/agent-gateway.service.spec.ts`
- Create: `apps/api/src/agent-supervisor/gateway/agent-gateway.service.ts`

**Interfaces:**
- Consumes: existing `SupervisorAction`, `SupervisorAgentRole`, `SupervisorEvidence`.
- Produces:
  - `ExternalCodeWorkerKind`
  - `ValidateWorkerContextInput`
  - `IntegrationGateInput`
  - `SupervisorGateDecision`
  - `AgentGatewayService.validateWorkerContext(...)`
  - `AgentGatewayService.checkIntegration(...)`

- [ ] **Step 1: Write failing path-validation tests**

Create `agent-gateway.service.spec.ts` with cases proving `../secret`, `/absolute/path`, empty paths, and changed files outside assignment scope are rejected with stable codes.

```ts
it('rejects path traversal and absolute repository paths', async () => {
  await expect(gateway.validateWorkerContext({
    taskId: task.id,
    executionId: execution.id,
    externalWorker: 'codex',
    changedFiles: ['../secret'],
  })).rejects.toMatchObject({ response: { code: 'invalid_repo_path' } });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test --workspace apps/api -- --runInBand src/agent-supervisor/gateway/agent-gateway.service.spec.ts
```

Expected: FAIL because gateway types/service do not exist.

- [ ] **Step 3: Add exact gateway input/output types**

Add to `agent-supervisor.types.ts`:

```ts
export type ExternalCodeWorkerKind =
  | 'codex'
  | 'chatgpt-work'
  | 'chatgpt-coding'
  | 'external-agent';

export interface ValidateWorkerContextInput {
  taskId: string;
  executionId: string;
  externalWorker: ExternalCodeWorkerKind;
  changedFiles?: string[];
  requestedAction?: SupervisorAction;
}

export interface IntegrationGateInput {
  taskId: string;
  executionId: string;
  action: 'merge' | 'deploy_production' | 'run_migration' | 'change_runtime_config';
  targetBranch?: string;
  baseSha?: string;
  headSha?: string;
  changedFiles: string[];
  explicitUserAuthorization: boolean;
}

export interface SupervisorGateDecision {
  allowed: boolean;
  reason: string | null;
  taskId: string;
  executionId: string;
}
```

- [ ] **Step 4: Implement path normalization and fail-closed worker validation**

`AgentGatewayService` must load persisted task + execution, reject task/execution mismatch, require `DISPATCHED`/`RUNNING` for implementation validation, reject protected worker actions, and validate changed files against the persisted assignment's `allowedPaths`.

Directory-prefix matching is allowed only when an assigned path explicitly ends in `/`; otherwise matching is exact.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the Task 1 focused Jest command. Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/api/src/agent-supervisor/agent-supervisor.types.ts \
  apps/api/src/agent-supervisor/gateway/agent-gateway.service.ts \
  apps/api/src/agent-supervisor/gateway/agent-gateway.service.spec.ts
git commit -m "feat(supervisor): validate external worker assignments"
```

---

### Task 2: Bind implementation evidence to a completed execution

**Files:**
- Modify: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.ts`
- Modify: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.service.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.service.spec.ts`
- Modify: `apps/api/src/agent-supervisor/gateway/agent-gateway.service.ts`
- Modify: `apps/api/src/agent-supervisor/gateway/agent-gateway.service.spec.ts`

**Interfaces:**
- Consumes: completed `SupervisorExecution.result.evidence`.
- Produces: `AgentGatewayService.submitImplementationFromExecution(taskId, executionId)`.

- [ ] **Step 1: Write failing evidence-binding tests**

Tests must prove:

```ts
await gateway.submitImplementationFromExecution(task.id, completed.execution.id);
expect((await supervisor.getTask(task.id)).status).toBe('IMPLEMENTED');
```

and prove a non-completed execution returns `execution_not_completed`.

- [ ] **Step 2: Verify RED**

Run focused gateway + dispatcher tests. Expected: FAIL because execution-bound submission is missing.

- [ ] **Step 3: Implement completion lookup without schema changes**

Use the existing execution store; do not add columns. The gateway loads the execution, requires `COMPLETED`, validates changed files against persisted assignment scope, then calls `AgentSupervisorService.submitImplementation(taskId, execution.result.evidence)`.

Do not let caller-supplied evidence replace persisted execution evidence.

- [ ] **Step 4: Preserve existing lifecycle semantics**

Existing direct `submitImplementation` behavior remains available for internal/manual Supervisor use, but external-code-agent integration documentation must require the execution-bound gateway method.

- [ ] **Step 5: Verify GREEN and regression**

Run:

```bash
npm test --workspace apps/api -- --runInBand \
  src/agent-supervisor/gateway/agent-gateway.service.spec.ts \
  src/agent-supervisor/dispatch/worker-dispatcher.service.spec.ts \
  src/agent-supervisor/agent-supervisor.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/api/src/agent-supervisor
git commit -m "feat(supervisor): bind implementation to worker execution"
```

---

### Task 3: Implement exact-SHA integration decisions

**Files:**
- Modify: `apps/api/src/agent-supervisor/gateway/agent-gateway.service.ts`
- Modify: `apps/api/src/agent-supervisor/gateway/agent-gateway.service.spec.ts`

**Interfaces:**
- Consumes: `IntegrationGateInput`, persisted task/execution, Supervisor permission policy.
- Produces: `AgentGatewayService.checkIntegration(input): Promise<SupervisorGateDecision>`.

- [ ] **Step 1: Write failing integration-gate tests**

Cover:

- task not `READY_FOR_REVIEW` -> `task_not_integration_ready`;
- execution not completed -> `execution_not_completed`;
- missing explicit authorization for merge -> `explicit_user_authorization_required`;
- non-40-char SHA -> `invalid_head_sha` / `invalid_base_sha`;
- merge target other than `production/atlas` -> `canonical_target_required`;
- changed file outside assignment -> `changed_file_out_of_scope`;
- valid canonical merge decision -> `{ allowed: true }`.

- [ ] **Step 2: Verify RED**

Run the focused gateway test. Expected: new cases FAIL.

- [ ] **Step 3: Implement integration checks**

Validation order must be deterministic:

1. task exists/state;
2. execution exists/belongs/completed;
3. path validation;
4. SHA validation;
5. canonical target rule;
6. Supervisor permission check using the persisted task owner for worker-scoped actions and `supervisor` for owner-gated integration decisions;
7. explicit user authorization.

A decision must not mutate task/execution state.

- [ ] **Step 4: Verify GREEN**

Run the focused gateway test. Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/api/src/agent-supervisor/gateway
git commit -m "feat(supervisor): gate integration by exact git state"
```

---

### Task 4: Add a narrowly scoped CI gateway endpoint and credential guard

**Files:**
- Create: `apps/api/src/agent-supervisor/gateway/supervisor-ci.guard.ts`
- Create: `apps/api/src/agent-supervisor/gateway/supervisor-ci.guard.spec.ts`
- Create: `apps/api/src/agent-supervisor/gateway/supervisor-gateway.controller.ts`
- Create: `apps/api/src/agent-supervisor/gateway/supervisor-gateway.controller.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.module.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.controller.spec.ts`

**Interfaces:**
- Consumes: `ATLAS_SUPERVISOR_CI_TOKEN` environment variable.
- Produces:
  - `POST /engineering/supervisor/gateway/validate-worker`
  - `POST /engineering/supervisor/gateway/check-integration`

- [ ] **Step 1: Write failing CI guard tests**

Guard behavior:

```ts
expect(() => guard.canActivate(contextWithoutToken)).toThrow(UnauthorizedException);
expect(guard.canActivate(contextWithWrongToken)).toBe(false or throw);
expect(guard.canActivate(contextWithExactToken)).toBe(true);
```

Use `timingSafeEqual` for equal-length token comparison and fail closed when the configured token is empty/missing.

- [ ] **Step 2: Verify RED**

Run gateway guard/controller specs. Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement the CI-only guard**

Header:

```text
X-Atlas-Supervisor-CI-Token
```

The gateway controller uses `@Public()` only to bypass the global Supabase user-session guard, then applies `@UseGuards(SupervisorCiGuard)` so the endpoint is still authenticated by the dedicated CI credential.

Do not mark the general `AgentSupervisorController` public.

- [ ] **Step 4: Expose only validation operations**

The CI gateway controller must not expose create/start/approve/merge/deploy mutation operations. It only validates worker context and integration readiness.

- [ ] **Step 5: Register gateway providers/controller**

Update `AgentSupervisorModule` with `AgentGatewayService`, `SupervisorCiGuard`, and `SupervisorGatewayController`; preserve all existing exports unless a new export is required by tests.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm test --workspace apps/api -- --runInBand src/agent-supervisor
```

Expected: all Supervisor tests PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/api/src/agent-supervisor
git commit -m "feat(supervisor): expose ci integration gateway"
```

---

### Task 5: Add the fail-closed GitHub Actions gate

**Files:**
- Create: `.github/workflows/atlas-supervisor-gate.yml`

**Interfaces:**
- Consumes GitHub PR event metadata and repository secrets:
  - `ATLAS_SUPERVISOR_API_URL`
  - `ATLAS_SUPERVISOR_CI_TOKEN`
- Produces stable check name: `atlas-supervisor-gate`.

- [ ] **Step 1: Create workflow with canonical triggers**

Trigger on pull requests targeting `production/atlas`. Also allow `main` for changes touching `AGENTS.md`, `.atlas/agent-control/**`, `.github/workflows/atlas-supervisor-gate.yml`, or `apps/api/src/agent-supervisor/**`.

- [ ] **Step 2: Require Supervisor metadata in PR body**

Exact markers:

```text
ATLAS-SUPERVISOR-TASK: <task id>
ATLAS-SUPERVISOR-EXECUTION: <execution id>
```

Missing/duplicate/empty values cause exit 1.

- [ ] **Step 3: Compute changed files from GitHub event/base/head**

Use GitHub API or checked-out git diff with exact base/head SHAs. Serialize changed files as JSON without shell word-splitting.

- [ ] **Step 4: Call the Supervisor integration endpoint**

Send:

```json
{
  "taskId": "...",
  "executionId": "...",
  "action": "merge",
  "targetBranch": "production/atlas",
  "baseSha": "<event base sha>",
  "headSha": "<event head sha>",
  "changedFiles": ["..."],
  "explicitUserAuthorization": false
}
```

Important: ordinary PR validation should validate supervision/readiness but must not fabricate owner merge authorization. Therefore the endpoint/workflow should support a non-mutating `review_candidate` validation mode or equivalent service method that checks all conditions except the final explicit merge authorization. The actual merge remains separately user-gated.

- [ ] **Step 5: Fail closed**

Timeout, DNS/network error, non-2xx, malformed JSON, Supervisor denial, or missing secrets => workflow failure.

No `continue-on-error`.

- [ ] **Step 6: Validate workflow syntax and behavior**

Use a YAML parser/action lint if available. At minimum inspect the final YAML and run a repository CI dry-run path with dummy endpoint values on a non-production branch.

- [ ] **Step 7: Commit Task 5**

```bash
git add .github/workflows/atlas-supervisor-gate.yml
git commit -m "ci: require atlas supervisor gate"
```

---

### Task 6: Make the repository contract explicit for every code agent

**Files:**
- Modify: `AGENTS.md`
- Modify: `.atlas/agent-control/README.md`

**Interfaces:**
- Consumes: gateway API/CI semantics from Tasks 1-5.
- Produces: repository-wide mandatory operating rule.

- [ ] **Step 1: Add the mandatory external-agent rule**

State explicitly:

```text
Codex, ChatGPT Work coding flows, ChatGPT coding agents, GitHub-connected coding agents, and any other code-writing agent MUST NOT produce integratable changes without a persisted ATLAS Supervisor task and execution.
```

- [ ] **Step 2: Define allowed unsupervised behavior**

Read-only inspection, explanation, planning, and non-mutating diagnosis may occur without an execution. Any repository write intended for integration requires Supervisor admission.

- [ ] **Step 3: Define bypass semantics**

A branch/commit created without Supervisor admission is `UNSUPERVISED` and must not be merged, mirrored to production, or deployed until it is re-audited under a fresh Supervisor task/execution.

- [ ] **Step 4: Add service governance**

Document:

- API/Web/Browser Worker source-code changes use the same Supervisor gate;
- Datadog image/version/config/redeploy changes require an `infra` Supervisor task;
- read-only Datadog health/log inspection does not require a code execution.

- [ ] **Step 5: Commit Task 6**

```bash
git add AGENTS.md .atlas/agent-control/README.md
git commit -m "docs(supervisor): require supervisor admission for code agents"
```

---

### Task 7: Full verification and READY_FOR_REVIEW evidence

**Files:**
- Test only; no new product scope.

**Interfaces:**
- Consumes all Task 1-6 changes.
- Produces Supervisor evidence for `ATLAS-20260901-AGENT-GATEWAY-001`.

- [ ] **Step 1: Inspect exact branch diff**

```bash
git diff --check production/atlas...HEAD
git diff --name-status production/atlas...HEAD
```

Expected: only the 19 Supervisor-owned paths; no Prisma migration/schema changes.

- [ ] **Step 2: Run focused Supervisor tests**

```bash
npm test --workspace apps/api -- --runInBand src/agent-supervisor
```

Expected: PASS.

- [ ] **Step 3: Run related engineering regression**

```bash
npm test --workspace apps/api -- --runInBand src/agent-supervisor src/engineering
```

Expected: PASS for discovered suites.

- [ ] **Step 4: Run API production build path**

```bash
npm run build --workspace apps/api
```

Expected: PASS, including existing background-job regression guard.

- [ ] **Step 5: Verify no migration was added**

```bash
git diff --name-only production/atlas...HEAD -- apps/api/prisma
```

Expected: no output.

- [ ] **Step 6: Verify CI workflow contains no secret values**

Inspect `.github/workflows/atlas-supervisor-gate.yml`; only `${{ secrets.* }}` references are permitted.

- [ ] **Step 7: Submit implementation evidence through the execution-bound path**

Evidence must include root cause, exact changed files, tests, build, regression, deployment state `NOT_DEPLOYED`, git state `NO_INTEGRATION_PERFORMED`, and remaining risk that GitHub required-ruleset hardening is still administrative if not writable through tooling.

- [ ] **Step 8: Advance Supervisor lifecycle**

`IMPLEMENTED -> VERIFYING -> READY_FOR_REVIEW` only after evidence is verified.

- [ ] **Step 9: Stop before integration**

Final report must state:

```text
Merge: NOT PERFORMED
Deployment: NOT PERFORMED
Production CI secret/config: NOT CHANGED
GitHub required ruleset: NOT ENABLED unless separately completed
```
