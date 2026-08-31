# ATLAS Agent Supervisor Runtime Gateway Design

## Status

Design for `ATLAS-20260901-AGENT-GATEWAY-001`.

This design turns the existing ATLAS Engineering Supervisor from an advisory/control-plane API into the mandatory admission and integration authority for external coding agents such as Codex, ChatGPT Work coding flows, GitHub-connected coding agents, and future code workers.

## Goal

No code produced by an external coding agent may be treated as integratable ATLAS work unless it is associated with a valid Supervisor task and execution. No protected Git integration or production action may proceed unless the Supervisor validates the exact task, execution, target and source commit and the required user authorization.

The desired invariant is:

```text
User
  -> ATLAS Supervisor
      -> Task contract
      -> File ownership
      -> Worker execution
          -> Codex / Work / other code agent
              -> Implementation evidence
      -> Verification
      -> READY_FOR_REVIEW
      -> explicit owner authorization
      -> integration / production gate
          -> GitHub / Railway / database
```

## Scope

This design governs the Engineering Agent Control Plane only. It does not merge it with the separate Marketing Agent Workflow.

In scope:

- mandatory Supervisor admission for external code workers;
- immutable execution assignment data;
- validation that changed files remain within the execution assignment;
- validation that implementation evidence belongs to an active execution;
- a Supervisor integration-gate decision bound to exact Git state;
- a machine-checkable GitHub CI gate for changes proposed to canonical production;
- production action checks for Railway and database work;
- explicit treatment of API, Web, Browser Worker and Datadog governance;
- repository rules documenting that unsupervised code is non-integratable.

Out of scope for this phase:

- building a full hosted Codex runtime inside ATLAS;
- storing third-party provider credentials in Supervisor records;
- changing GitHub organization administration or repository rulesets through unsupported APIs;
- automatically deploying merely because a task becomes READY_FOR_REVIEW;
- replacing GitHub/Railway access controls with application-level tokens.

## Existing Foundation

ATLAS already has:

- `SupervisorTask` persistence;
- `SupervisorExecution` persistence;
- `SupervisorFileLock` persistence;
- task lifecycle enforcement;
- permission checks;
- file ownership acquisition/release;
- worker dispatch producing a `WorkerAssignmentEnvelope`;
- explicit deny rules for protected integration actions;
- evidence-based task progression.

The missing boundary is external runtime enforcement. Today a Codex/Work/GitHub-connected agent can modify a branch without first creating a Supervisor execution, because the Supervisor is not in the mandatory path between the agent and the repository.

## Architectural Options

### Option A — Instruction-only enforcement

Require agents to read `AGENTS.md` and voluntarily include a Supervisor task ID.

Advantages:

- minimal implementation;
- no new API contracts.

Disadvantages:

- still bypassable;
- no cryptographic or repository-level binding to a commit;
- repeats the current failure mode.

Rejected.

### Option B — Supervisor admission + CI integration gate

Require every code agent to obtain a Supervisor execution before implementation. Require every integration candidate to pass a CI check that validates the task/execution/changed-file relationship and exact Git target/head information against Supervisor state.

Advantages:

- fits the existing Supervisor persistence and dispatcher;
- works with Codex, Work and future agents without embedding a particular agent runtime;
- prevents unsupervised branches from entering canonical production when the CI gate is required;
- keeps worker execution separate from owner authorization.

Disadvantages:

- GitHub branch protection/ruleset must eventually mark the gate as required to make it impossible for administrators to bypass manually;
- CI requires a secure way to query the Supervisor API.

Recommended.

### Option C — Proxy all GitHub/Railway actions through ATLAS

Remove direct agent access to GitHub/Railway and provide only Supervisor-mediated proxy endpoints.

Advantages:

- strongest conceptual enforcement.

Disadvantages:

- much larger security surface;
- duplicates mature GitHub/Railway authorization behavior;
- requires broad credential custody and proxy auditing;
- unnecessary for the immediate goal.

Deferred. Option B is the implementation target, with a later administrative hardening step that makes the Supervisor gate a required GitHub check.

## Core Invariants

1. External code agents may inspect/read without a Supervisor execution, but implementation writes are not integratable unless attached to one.
2. A valid execution belongs to exactly one Supervisor task and one worker role.
3. A worker assignment cannot broaden permissions beyond the Supervisor permission matrix.
4. Changed files must be a subset of the task/execution `allowedPaths`.
5. Protected actions remain denied to workers even when they possess a valid execution.
6. `READY_FOR_REVIEW` is required before an integration gate can pass.
7. User approval and integration permission remain independent of `APPROVED` task state.
8. An integration decision binds to exact `targetBranch`, `headSha`, `baseSha` where supplied, and requested action.
9. A decision for one SHA cannot authorize a later SHA.
10. Production deployment must be gated separately from code integration.
11. Missing Supervisor state fails closed.
12. Gateway checks must never create tasks/workspaces implicitly.

## External Worker Admission

### Identity model

ATLAS does not need to know a third-party provider's internal user identity. It needs a stable caller label for audit only.

Supported external worker kinds initially:

```text
codex
chatgpt-work
chatgpt-coding
external-agent
```

The Supervisor remains authoritative for the ATLAS worker role:

```text
engineering | frontend | backend | database | qa | infra
```

### Admission flow

1. Supervisor task exists in `WORKING`.
2. Required file ownership is held by that task.
3. Dispatcher creates a Supervisor execution and immutable assignment envelope.
4. External agent receives:
   - `taskId`;
   - `executionId`;
   - assigned worker role;
   - objective;
   - allowed paths;
   - forbidden actions;
   - acceptance criteria;
   - required evidence.
5. Agent may implement only within that envelope.
6. Result submission must reference the execution and changed files.
7. Supervisor validates the result before the task can advance to `IMPLEMENTED`.

The gateway does not trust a caller-supplied role, allowed path list or permission set if it differs from persisted execution state.

## Execution Validation Contract

Add a Supervisor operation that validates an external worker context.

Conceptual input:

```ts
interface ValidateWorkerContextInput {
  taskId: string;
  executionId: string;
  externalWorker: 'codex' | 'chatgpt-work' | 'chatgpt-coding' | 'external-agent';
  changedFiles?: string[];
  requestedAction?: SupervisorAction;
}
```

Validation requires:

- task exists;
- task status is compatible with implementation (`WORKING`, or result-specific state where appropriate);
- execution exists and belongs to task;
- execution is `DISPATCHED` or `RUNNING` for implementation actions;
- task owns all persisted allowed paths that require ownership;
- every changed file is in the assignment/task allowed paths;
- requested action is permitted by role + task scope;
- protected integration actions are rejected for worker calls.

Output is a deterministic decision with machine-readable reason.

## Path Validation

Initial enforcement uses repository paths, not arbitrary filesystem absolute paths.

Rules:

- normalize path separators to `/`;
- reject `..`, absolute paths and empty paths;
- exact allowed file paths are supported immediately;
- directory scopes are represented only with an explicit trailing `/` prefix rule if intentionally configured;
- do not silently interpret arbitrary glob syntax in this phase;
- changed files outside assignment fail the gate.

This keeps enforcement deterministic and compatible with existing exact-path file locks.

## Implementation Evidence Binding

Current execution completion records evidence but task implementation submission is separate. The new gateway must connect them.

Required behavior:

1. Worker execution reaches `COMPLETED` with valid `WorkerExecutionResult`.
2. Supervisor validates that evidence `changedFiles` are inside persisted assignment scope.
3. The task may accept implementation evidence only if it comes from a completed execution belonging to that task.
4. Evidence stored on the task must retain the execution ID used for the implementation decision, either directly in a new optional evidence field or through a deterministic lookup from the execution record.

To avoid a database migration in the first enforcement increment, execution binding should be enforced using existing `SupervisorExecution.result` plus service logic. A schema change is deferred unless implementation proves persistence cannot be made unambiguous without one.

## Integration Gate

Add a Supervisor integration-gate operation.

Conceptual input:

```ts
interface IntegrationGateInput {
  taskId: string;
  executionId: string;
  action: 'merge' | 'deploy_production' | 'run_migration' | 'change_runtime_config';
  targetBranch?: string;
  baseSha?: string;
  headSha?: string;
  changedFiles: string[];
  explicitUserAuthorization: boolean;
}
```

Rules:

- task must be `READY_FOR_REVIEW` or `APPROVED` as appropriate;
- execution must belong to the task and be `COMPLETED`;
- changed files must remain within the task assignment;
- integration action is checked through the Supervisor permission model;
- merge/integration requires explicit user authorization;
- production deploy/migration/runtime config requires the corresponding explicit authorization and role policy;
- canonical production integration requires `targetBranch === 'production/atlas'` unless an explicitly reviewed emergency mirror path is supplied;
- if `headSha` is supplied it must be a full 40-character SHA;
- the result contains no reusable bearer secret; it is a decision for the exact input state.

A later phase may sign short-lived attestations, but this design deliberately starts with server-side decision validation rather than inventing a new token system prematurely.

## GitHub CI Gate

Add `.github/workflows/atlas-supervisor-gate.yml` as a machine-checkable integration guard.

The workflow should run on pull requests targeting `production/atlas` and optionally `main` for agent-governance changes.

Required PR metadata convention:

```text
ATLAS-SUPERVISOR-TASK: <task id>
ATLAS-SUPERVISOR-EXECUTION: <execution id>
```

The workflow must:

1. fail if metadata is absent;
2. obtain changed filenames from the checked-out merge candidate or GitHub event;
3. query the Supervisor validation endpoint using a CI-only secret/API credential;
4. send exact base/head SHA, target branch and changed files;
5. fail closed on timeout, non-2xx response, invalid JSON, stale execution, changed-file mismatch or unready task;
6. expose one stable check name: `atlas-supervisor-gate`.

Repository ruleset/branch protection should eventually require `atlas-supervisor-gate` for canonical production. The current connector can read but not write GitHub rulesets, so enabling the required-check rule is an explicit administrative follow-up if it cannot be automated through available tooling.

The workflow must not contain production database credentials.

## Production Gate Boundaries

### API

- code source belongs to canonical `production/atlas` or its verified mirror;
- deployment requires Supervisor `infra`/supervisor production permission and explicit owner authorization;
- exact deployed SHA must be verified after deployment.

### Web

Same rules as API. API and Web should converge to the same canonical commit during normal production integration.

### Browser Worker

Browser Worker is source-controlled ATLAS code and must be reconciled into canonical production rather than permanently living on an independent hotfix line. Its production deployment follows the same exact-SHA Supervisor gate.

The current Browser Worker reconciliation is separately tracked by `ATLAS-20260901-BROWSER-RECON-001` and must complete independently from this gateway implementation.

### Datadog Agent

Datadog currently runs from the external image `gcr.io/datadoghq/agent:7`, not ATLAS Git history. Therefore:

- no Git branch reconciliation applies;
- image/version/configuration/restart operations are `infra` actions;
- changing the image tag, Datadog variables, deployment configuration or restarting/redeploying it requires a Supervisor infra task;
- routine read-only health/log inspection does not require a code execution.

A future hardening task should pin the Datadog image to an explicit tested version rather than the floating major tag if operational policy requires reproducibility.

## Error Semantics

Return stable failure codes. Initial set:

```text
supervisor_task_not_found
execution_not_found
execution_task_mismatch
execution_not_active
execution_not_completed
task_not_implementation_ready
task_not_integration_ready
file_ownership_missing
changed_file_out_of_scope
invalid_repo_path
worker_protected_action_denied
explicit_user_authorization_required
canonical_target_required
invalid_head_sha
invalid_base_sha
```

CI renders these codes but never treats an unavailable Supervisor as success.

## Security Model

- Default deny.
- Supervisor API authentication remains under existing ATLAS auth controls; CI access must use a dedicated narrowly scoped credential, not a user session cookie.
- Do not place Railway, Supabase or GitHub administrative credentials in task records.
- Do not use caller-provided task state, role or permissions as authority.
- CI sends evidence; Supervisor resolves authority from persistence.
- Production actions continue to rely on GitHub/Railway/Supabase platform credentials in addition to Supervisor approval. Supervisor is an additional policy gate, not a replacement authentication system.

## Failure and Recovery

- Supervisor unavailable: integration gate fails closed; implementation work may remain on an isolated branch but cannot integrate.
- Execution stale/cancelled: create a new Supervisor execution; never revive by mutating history silently.
- Changed files exceed scope: return task to Supervisor for explicit scope expansion and ownership acquisition.
- Verification fails: task returns to `WORKING` through existing lifecycle and obtains a new execution for retry.
- Canonical branch moves after gate evaluation: gate must be rerun for the new SHA/base.
- Emergency production repair: still requires a Supervisor task; emergency scope may be narrow, but it is not exempt from audit/evidence.

## Testing Strategy

Use TDD.

Focused unit tests must cover:

1. valid external worker context passes;
2. task/execution mismatch fails;
3. stale/non-running execution fails implementation validation;
4. out-of-scope changed file fails;
5. path traversal/absolute path fails;
6. protected worker action fails;
7. completed execution can bind implementation evidence;
8. incomplete execution cannot bind implementation evidence;
9. integration gate rejects non-READY_FOR_REVIEW task;
10. integration gate rejects missing explicit owner authorization;
11. integration gate rejects stale/invalid SHA format;
12. canonical production merge requires `production/atlas` target;
13. production deploy action remains independently gated;
14. existing Supervisor lifecycle/dispatcher tests remain green.

CI workflow validation should test at least:

- missing PR metadata -> fail;
- Supervisor denial -> fail;
- successful Supervisor response -> pass;
- network/timeout -> fail closed.

Regression gate:

- full `src/agent-supervisor` tests;
- relevant engineering tests;
- API build;
- existing background-job regression guard;
- no Prisma migration unless implementation explicitly proves one is required.

## Rollout

### Stage 1 — repository + API enforcement

- implement worker-context validation;
- implement integration decision endpoint;
- bind implementation evidence to completed executions;
- document mandatory external worker behavior;
- add CI workflow.

This stage makes unsupervised work fail the CI gate where the workflow runs.

### Stage 2 — repository administration

- mark `atlas-supervisor-gate` as a required status check for `production/atlas`;
- require pull request integration for canonical production if compatible with current emergency workflow;
- restrict direct pushes to canonical production except explicitly designated owner/emergency paths.

Stage 2 is necessary for platform-level non-bypassability. It may require manual GitHub ruleset configuration if the available connector cannot write rulesets.

### Stage 3 — external runtime adapters

Optional adapters may automate task/execution acquisition for Codex/Work sessions, but they must consume the same Supervisor contract rather than bypass it.

## Acceptance Criteria

The runtime gateway is ready for review when:

- a Supervisor task/execution is required for a code-agent integration candidate;
- changed files are validated against persisted assignment scope;
- protected worker actions remain denied;
- integration checks bind to exact Git state and owner authorization;
- CI fails closed for unsupervised PRs targeting canonical production;
- Browser Worker is governed by the same canonical/production rules;
- Datadog configuration changes are explicitly classified as Supervisor infra actions;
- focused tests, Supervisor regression tests and API build pass;
- no production deployment occurs merely from implementing the gateway;
- final state is `READY_FOR_REVIEW` before any integration/deployment action.
