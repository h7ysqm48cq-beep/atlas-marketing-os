# P0B-6B Candidate Workspace / Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn one Supervisor IMPLEMENTATION execution with an immutable frozen base into an isolated Git workspace, a remotely verified candidate branch, and a merge `reviewCandidate` derived from Git provenance rather than executor claims.

**Architecture:** Extend the immutable Supervisor assignment with optional `frozenBaseSha`, then let the Engineering Runner opt into a per-execution candidate workspace when that field is present. A separate Candidate Publisher stages only the Runner-verified file set, creates one commit from the frozen base, pushes only a deterministic new candidate ref, verifies the remote SHA, and returns a structured receipt. Existing legacy dispatch/execution remains compatible when `frozenBaseSha` is absent; verifier executions never publish.

**Tech Stack:** NestJS/TypeScript Supervisor API, Node.js Engineering Runner, `node:child_process.execFile`, Git worktrees/local bare remotes for tests, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-16-p0b6b-candidate-workspace-publisher-design.md`

## Global Constraints

- No Prisma/schema/migration change; Supervisor assignment/result are existing JSONB fields.
- `production/atlas` remains unwritable by the Publisher.
- No force push, remote branch reuse, PR creation, merge, deployment, Railway mutation, DB mutation, or Human Owner authority.
- Generic Executor never receives publisher credentials.
- Git commands use `execFile` argument arrays, never shell interpolation.
- A publication failure is an execution failure and cannot produce a successful review candidate.
- Existing non-6B dispatch/Runner behavior remains backward compatible.

---
### Task 1: Freeze Base SHA in Supervisor Assignment Authority

**Files:**
- Modify: `apps/api/src/agent-supervisor/execution/supervisor-execution.types.ts`
- Modify: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.ts`
- Modify: `apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.controller.ts`
- Modify: `apps/engineering-runner/src/types.ts`

**Interfaces:**
- Produces: `WorkerAssignmentEnvelope.frozenBaseSha?: string` and matching Runner `WorkerAssignment.frozenBaseSha?: string`.
- Produces: `WorkerDispatcherService.dispatch(taskId, purpose, options?: { frozenBaseSha?: string })`.
- Guarantee: when supplied for IMPLEMENTATION, the normalized 40-hex SHA is inside `assignmentCore` before `createBinding()`, so the admission manifest cryptographically binds it.

- [ ] **Step 1: Write RED tests for exact SHA binding and validation**

Add dispatcher tests that dispatch with `{ frozenBaseSha: 'a'.repeat(40) }`, assert the assignment contains it, and assert the manifest hash changes when only the base SHA changes. Add invalid/verification tests: malformed SHA rejects; verifier dispatch cannot accept a caller-supplied frozen base.

- [ ] **Step 2: Run focused dispatcher tests and verify RED**

Run: `npm test --workspace apps/api -- --runInBand agent-supervisor/dispatch/worker-dispatcher.service.spec.ts`
Expected: FAIL because `dispatch` and assignment types do not yet support `frozenBaseSha`.

- [ ] **Step 3: Implement the minimal contract**

Implement this contract (names exact):

```ts
export interface WorkerAssignmentEnvelope {
  // existing fields...
  frozenBaseSha?: string;
}

async dispatch(
  taskId: string,
  executionPurpose: SupervisorExecutionPurpose = 'IMPLEMENTATION',
  options: { frozenBaseSha?: string } = {},
): Promise<...>
```

Normalize with `/^[0-9a-f]{40}$/i`, lowercase it, reject a supplied base for `INDEPENDENT_VERIFICATION`, and spread `{ frozenBaseSha }` into `assignmentCore` before `createBinding()`. The controller reads optional `{ frozenBaseSha?: string }` from the IMPLEMENTATION dispatch body. Do not add the field to `SupervisorTask` or Prisma models.

- [ ] **Step 4: Run focused API tests and build**

Run dispatcher/controller targeted tests, then `npm run build --workspace apps/api`.
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat(supervisor): bind frozen base to implementation assignment"`

---
### Task 2: Execution-Scoped Candidate Workspace Manager

**Files:**
- Create: `apps/engineering-runner/src/candidate-workspace.ts`
- Create: `apps/engineering-runner/src/candidate-workspace.spec.ts`

**Interfaces:**
- Produces: `CandidateWorkspaceManager.prepare(input): Promise<CandidateWorkspaceLease>`.
- `CandidateWorkspaceInput` contains `taskId`, `executionId`, `frozenBaseSha`, `allowedPaths`.
- `CandidateWorkspaceLease` exposes `path`, `baseSha`, `workspace: WorkspaceInspector`, and `cleanup(): Promise<void>`.

- [ ] **Step 1: Write RED tests with temporary source repos**

Create a temp Git repo with one commit. Test: exact base creates a detached isolated worktree; returned HEAD equals base; workspace starts clean; wrong SHA fails; dirty/reused destination fails; traversal/symlink-escaping allowed paths fail; task/execution IDs with unsafe path characters fail.

- [ ] **Step 2: Run candidate-workspace tests and verify RED**

Run: `node --test --experimental-strip-types --test-name-pattern="CandidateWorkspace" apps/engineering-runner/src/*.spec.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal workspace lifecycle**

Implement these interfaces:

```ts
export interface CandidateWorkspaceInput {
  taskId: string;
  executionId: string;
  frozenBaseSha: string;
  allowedPaths: string[];
}
export interface CandidateWorkspaceLease {
  path: string;
  baseSha: string;
  workspace: WorkspaceInspector;
  cleanup(): Promise<void>;
}
export class CandidateWorkspaceManager {
  constructor(options: { sourceRepository: string; workspaceRoot: string });
  prepare(input: CandidateWorkspaceInput): Promise<CandidateWorkspaceLease>;
}
```

Use `execFile('git', ['worktree','add','--detach', workspacePath, frozenBaseSha])`; derive `workspacePath` internally from strict task/execution IDs, then verify `rev-parse HEAD`, empty porcelain status, and safe allowed paths. Never checkout or mutate `production/atlas`.

- [ ] **Step 4: Implement cleanup semantics**

`cleanup()` removes the linked worktree with `git worktree remove --force <path>` only for the execution-owned path. Cleanup must never delete remote refs or alter the source checkout branch.

- [ ] **Step 5: Run focused tests and commit**

Run candidate-workspace tests plus Engineering Runner baseline.
Expected: workspace tests PASS and existing Runner tests remain green.

Commit: `git add apps/engineering-runner/src/candidate-workspace* && git commit -m "feat(runner): add isolated candidate workspaces"`

---
### Task 3: Exact Candidate Publisher

**Files:**
- Create: `apps/engineering-runner/src/candidate-publisher.ts`
- Create: `apps/engineering-runner/src/candidate-publisher.spec.ts`
- Modify: `apps/engineering-runner/src/types.ts`

**Interfaces:**
- Produces: `CandidatePublicationRequest` with fixed `executionPurpose: 'IMPLEMENTATION'` and `CandidatePublicationReceipt` from the approved spec.
- Produces: `CandidatePublisher.publish(request): Promise<CandidatePublicationReceipt>`.
- Adds optional `candidatePublication?: CandidatePublicationReceipt` and `reviewCandidate?: { action:'merge'; targetBranch:'production/atlas'; baseSha:string; headSha:string; changedFiles:string[] }` to Runner evidence typing.

- [ ] **Step 1: Write RED tests against a local bare remote**

Test successful exact publication plus: extra tracked/untracked files reject, pre-staged content rejects, existing remote candidate branch rejects, parent mismatch rejects, target branch other than `production/atlas` rejects, and remote SHA mismatch yields no receipt. Assert no test path invokes force push.

- [ ] **Step 2: Run focused publisher tests and verify RED**

Run: `node --test --experimental-strip-types --test-name-pattern="CandidatePublisher" apps/engineering-runner/src/*.spec.ts`
Expected: FAIL because Publisher does not exist.

- [ ] **Step 3: Implement exact staging and commit provenance**

Implement the narrow API:

```ts
export interface CandidatePublicationRequest {
  taskId: string;
  executionId: string;
  executionPurpose: 'IMPLEMENTATION';
  workspace: string;
  frozenBaseSha: string;
  targetBranch: 'production/atlas';
  changedFiles: string[];
}
export interface CandidatePublisherLike {
  publish(input: CandidatePublicationRequest): Promise<CandidatePublicationReceipt>;
}
```

Recompute Git status, compare canonical sorted sets, stage only `git add -- <changedFiles>`, verify `git diff --cached --name-only`, commit with internal message `atlas(candidate): <taskId> <executionId>` using `execFile`, then require exactly one parent equal to `frozenBaseSha` and exact `base..head` changed files.

- [ ] **Step 4: Implement new-ref push and remote verification**

Derive `atlas/candidate/<taskId>/<executionId>` internally. Use `git ls-remote --heads` to prove absence, push `candidateHead:refs/heads/<candidateBranch>` without `--force`, then re-read the remote ref and require exact SHA equality. Transport environment is Publisher-owned and never persisted into Git remotes or evidence.

- [ ] **Step 5: Run focused tests and commit**

Run publisher tests and the complete Engineering Runner suite.
Expected: all green.

Commit: `git add apps/engineering-runner/src/candidate-publisher* apps/engineering-runner/src/types.ts && git commit -m "feat(runner): publish exact candidate branches"`

---
### Task 4: Runner Publication Integration

**Files:**
- Modify: `apps/engineering-runner/src/runner.ts`
- Modify: `apps/engineering-runner/src/runner.spec.ts`
- Modify: `apps/engineering-runner/src/types.ts`

**Interfaces:**
- Add optional Runner dependency `candidateFlow` that prepares an execution-scoped workspace/executor and publishes only IMPLEMENTATION assignments with `frozenBaseSha`.
- Legacy static `executor` / `workspace` path remains unchanged when candidate flow is absent or the assignment has no frozen base.
- Successful candidate flow returns execution evidence augmented with `candidatePublication` and a `reviewCandidate` derived only from the receipt.

- [ ] **Step 1: Write RED Runner tests**

Test that IMPLEMENTATION + frozen base invokes prepare → executor → exact scope/evidence check → publisher → complete. Assert an executor-supplied fake `reviewCandidate` is replaced by the Publisher receipt. Test Publisher failure calls `session.fail()` exactly once and never `complete()`. Test verifier purpose never calls workspace preparation or Publisher.

- [ ] **Step 2: Run focused Runner tests and verify RED**

Run: `node --test --experimental-strip-types --test-name-pattern="candidate|publication|verification" apps/engineering-runner/src/*.spec.ts`
Expected: FAIL because Runner has no candidate flow.

- [ ] **Step 3: Implement minimal candidate-flow branch**

Extend Runner options with exact dependencies:

```ts
candidateWorkspaceManager?: CandidateWorkspaceManagerLike;
candidatePublisher?: CandidatePublisherLike;
executorFactory?: (cwd: string) => AssignmentExecutor;
```

For `IMPLEMENTATION` with `assignment.frozenBaseSha`, require all three dependencies, call `prepare()`, create the workspace-bound executor through `executorFactory(lease.path)`, independently observe changed files, enforce scope/evidence equality, then call Publisher with `executionPurpose: 'IMPLEMENTATION'`. Build `reviewCandidate` only from the returned receipt. Keep heartbeat and ambiguous-mutation behavior unchanged. In `finally`, best-effort `lease.cleanup()` after the terminal Supervisor mutation attempt.

- [ ] **Step 4: Preserve legacy and verifier semantics**

Existing assignments without `frozenBaseSha` continue through the existing static executor/workspace path. `INDEPENDENT_VERIFICATION` always stays publication-free and preserves zero-drift behavior.

- [ ] **Step 5: Run entire Runner suite and commit**

Run: `npm test --workspace apps/engineering-runner && npm run build --workspace apps/engineering-runner`.
Expected: all existing and new tests PASS.

Commit: `git add apps/engineering-runner/src/runner* apps/engineering-runner/src/types.ts && git commit -m "feat(runner): integrate candidate publication flow"`

---
### Task 5: Configuration, Evidence Persistence, and Full Regression

**Files:**
- Modify: `apps/engineering-runner/src/config.ts`
- Modify: `apps/engineering-runner/src/index.ts`
- Modify: `apps/engineering-runner/src/executor.ts`
- Modify: `apps/engineering-runner/src/executor.spec.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.types.ts`
- Modify: `apps/api/src/agent-supervisor/agent-supervisor.service.ts`
- Modify targeted Supervisor persistence/controller tests as required by type coverage.

**Interfaces:**
- Add optional Runner config for source repository, candidate workspace root, publication remote, and Publisher-only transport environment input.
- Preserve `CommandExecutor` secret stripping and additionally strip publisher-specific environment keys from child execution.
- Persist optional structured `candidatePublication` alongside `reviewCandidate` in Supervisor evidence without schema changes.

- [ ] **Step 1: Write RED config/evidence/credential tests**

Test candidate-flow config is all-or-nothing; partial configuration fails closed. Test `CommandExecutor` strips Publisher credential keys. Test `submitImplementation()` preserves exact `candidatePublication` and review candidate. Confirm no Prisma migration is created.

- [ ] **Step 2: Implement config and index wiring**

Add optional all-or-nothing config keys for source repository, candidate workspace root, and candidate remote. When all are present, construct `CandidateWorkspaceManager`, `CandidatePublisher`, and `executorFactory(cwd => new CommandExecutor({...cwd...}))`; when none are present, preserve legacy wiring; partial configuration throws `runner_candidate_config_incomplete`.

Publisher Git subprocesses receive only an explicit minimal transport environment (`PATH`, `HOME`, `TMPDIR` when present) plus constructor-injected test/future auth values. Do not pass `process.env` wholesale. `CommandExecutor.sanitizeEnvironment()` additionally removes keys matching `^ATLAS_ENGINEERING_RUNNER_PUBLISHER_`.

- [ ] **Step 3: Implement typed Supervisor evidence persistence**

Add the receipt shape to API evidence typing and explicitly clone/preserve it during implementation submission. Validate full SHA fields, `remoteVerified === true`, fixed target branch, and exact string arrays before accepting it.

- [ ] **Step 4: Run full verification**

Run:
- `npm test --workspace apps/engineering-runner`
- `npm run build --workspace apps/engineering-runner`
- targeted Supervisor dispatcher/manifest/service/controller tests
- `npm run build --workspace apps/api`
- `python3 -m pytest -q tools/tests/test_supervisor_executor.py`
- `git diff --check`

Expected: new 6B tests PASS, previous Runner 19-test and PR115 13-test baselines remain green, API build PASS, no migration/schema diff.

- [ ] **Step 5: Local bare-remote smoke**

From an isolated temp repository, exercise exact frozen base → isolated worktree → one allowed change → candidate commit → local bare remote candidate branch → remote SHA verification. Assert the source branch and `production/atlas` ref are unchanged.

- [ ] **Step 6: Commit and freeze candidate**

Commit only reviewed 6B implementation/tests/docs. Record exact base/head, changed-file list, test/build evidence, and patch SHA256. Do not push/PR/merge/deploy until the normal Supervisor review chain is prepared.
