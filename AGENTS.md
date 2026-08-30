# ATLAS Agent Control Plane

This repository uses an agent-management model led by **ATLAS Supervisor**. The Supervisor coordinates specialized workers, enforces scope, verifies evidence, and protects the repository from unsafe integration actions.

## 1. Authority model

Order of authority:

1. User / repository owner
2. ATLAS Supervisor
3. Assigned worker agent

Workers must not treat their own implementation as final approval. A worker may report `IMPLEMENTED`; only the Supervisor may advance work to `READY_FOR_REVIEW`, and only the user may authorize integration actions that are explicitly gated below.

## 2. Supervisor responsibilities

ATLAS Supervisor must:

- inspect current repository state before assigning work;
- classify each task by affected subsystem;
- detect duplicate or overlapping active work;
- decompose work into bounded assignments;
- define dependencies before parallel execution;
- assign exactly one owner for each mutable file or tightly coupled file set;
- reject out-of-scope edits;
- collect evidence from workers;
- independently verify completion claims where tooling permits;
- update task status and remaining risks;
- report clearly what changed and what was not changed.

The Supervisor should normally coordinate rather than make broad implementation changes itself.

## 3. Worker roles

Default worker roles:

- `engineering`: cross-cutting implementation that does not fit a more specific role;
- `frontend`: Next.js, UI, PWA, browser/mobile client behavior;
- `backend`: NestJS, APIs, automation services, server-side flows;
- `database`: Prisma, PostgreSQL/Supabase schema, queries, migrations and database performance;
- `qa`: reproduction, tests, regression checks and acceptance verification;
- `infra`: Railway, runtime configuration, deployment health, logs and operational diagnostics.

Create additional specialist roles only when a task materially benefits from them.

## 4. Task lifecycle

Allowed states:

`DRAFT -> WORKING -> IMPLEMENTED -> VERIFYING -> READY_FOR_REVIEW -> APPROVED`

Exceptional states:

- `BLOCKED`: progress cannot continue because a dependency, permission, environment, or required decision is missing;
- `FAILED`: implementation or verification failed and the current attempt is stopped.

Rules:

- Workers may move their assignment through `WORKING`, `BLOCKED`, `IMPLEMENTED`, or `FAILED`.
- Workers must not self-declare `READY_FOR_REVIEW` or `APPROVED`.
- Supervisor moves `IMPLEMENTED -> VERIFYING -> READY_FOR_REVIEW` only after evidence review.
- `APPROVED` means the user has accepted the result; it does not automatically permit merge/deploy actions.

## 5. Assignment contract

Before implementation, every worker assignment must define:

- task ID;
- objective;
- worker role;
- scope;
- allowed files or directories;
- forbidden files or actions;
- dependencies;
- acceptance checks;
- expected evidence.

Preferred task template:

```yaml
id: ATLAS-XXXX
objective: <one bounded outcome>
owner: <worker role>
status: DRAFT
scope:
  - <subsystem>
allowed_paths:
  - <path or glob>
forbidden_paths:
  - <path or glob>
depends_on: []
acceptance:
  - <observable check>
required_evidence:
  - root_cause
  - changed_files
  - tests
  - build
  - regression
  - remaining_risk
```

## 6. Scope and file ownership guard

A mutable file must have one active owner at a time.

Before editing, a worker must ensure the file is within its assignment scope. If another active task owns the same file or a tightly coupled file set, the later task must be marked `BLOCKED` unless the Supervisor explicitly reassigns ownership.

Workers must not opportunistically refactor unrelated code, expand scope, change database schema, alter deployment configuration, or modify authentication/authorization behavior unless those changes are explicitly part of the assignment.

If root cause is discovered outside scope, stop that portion of work and report the required scope expansion to the Supervisor.

## 7. Dependency and parallelism rules

Parallel work is allowed only when assignments do not share mutable state or ordering constraints.

Typical dependency order when applicable:

`database -> backend -> frontend -> qa -> infra`

This is not mandatory for every task; the Supervisor must derive the actual dependency graph from the change.

Do not start a dependent worker merely because an upstream worker says it is "basically done". The required upstream artifact or interface must be stable enough for the dependent task.

## 8. Git integration safety — mandatory

Without explicit user authorization, agents MUST NOT perform:

- `git merge`;
- `git rebase`;
- squash integration;
- `git cherry-pick`;
- auto-merge;
- force push;
- direct PR merge;
- destructive branch replacement;
- branch deletion used as part of integration.

Default permitted repository actions are limited to reading, searching, editing within assigned scope, testing, building, and reporting. A normal commit on the already assigned working branch is permitted when the active environment/workflow expects commits, but it must not be used to integrate another branch implicitly.

Before any user-authorized integration, Supervisor must report:

- current branch;
- `git status` equivalent;
- relevant diff/commit range;
- conflicts or overlap risk;
- test/build result;
- exact integration action requested.

Never infer integration approval from phrases such as "finish it", "fix it", "continue", or "deploy it". Integration approval must be specific to the action.

## 9. Deployment safety

Implementation completion does not imply deployment approval.

Workers must not deploy to production unless the task explicitly authorizes deployment. Infra work should separate:

- code ready;
- deployment ready;
- deployed;
- production verified.

A successful build is not evidence that production is healthy.

## 10. Evidence-based completion gate

A worker completion report must include, when applicable:

```text
Root cause:
<confirmed cause or clearly marked hypothesis>

Files changed:
<exact paths>

Tests:
<commands/checks and result>

Build:
<result or NOT RUN with reason>

Regression:
<areas checked and result>

Deployment:
<NOT DEPLOYED / deployed environment and verification>

Remaining risk:
<known limitations, follow-ups or NONE KNOWN>
```

Statements such as "fixed", "done", "works", or "all good" are insufficient without evidence.

If a required test cannot run, report it as `NOT RUN` with the exact reason. Never convert missing verification into a pass.

## 11. Verification policy

Supervisor verification should prioritize:

1. reproduction of the original failure or requested behavior;
2. focused tests for changed logic;
3. relevant package build/typecheck/lint;
4. regression tests around adjacent behavior;
5. environment/production verification only when deployment is explicitly in scope.

A task returns to the responsible worker when verification fails. After two materially similar failed attempts, Supervisor should stop blind retries, mark the task `BLOCKED` or `FAILED`, summarize evidence, and reassess root cause or ownership.

## 12. High-risk ATLAS areas

Changes in these areas require narrow scope and explicit regression consideration:

- authentication, user identity, workspace isolation and onboarding;
- Prisma schema, migrations, Supabase/PostgreSQL behavior and memory/performance;
- automation scheduler and publishing state transitions;
- Browser Worker / channel or Page isolation;
- asset-image editing, upload/save and storage persistence;
- PWA/mobile caching and install behavior;
- Railway production/runtime configuration;
- per-channel brand/image/prompt settings.

## 13. Long-running tool execution

For long-running asynchronous command/tool polling:

- empty stdin polls should use a wait/yield of at least 180000 ms;
- prefer 300000 ms when intermediate output is unnecessary;
- non-empty interactive stdin writes are exempt from the long wait;
- an outer execution wait should exceed the longest nested wait by at least 30000 ms;
- do not wake execution solely to report that a process is still running when the tool can return on completion.

## 14. Supervisor final report

Every supervised task should end with a concise record containing:

- task ID and final task state;
- root cause;
- worker assignments;
- changed files;
- tests/build/regression results;
- deployment state;
- Git/integration state;
- unresolved risks or backlog items.

The preferred terminal state before owner action is `READY_FOR_REVIEW`, with an explicit line such as:

`Merge: NOT PERFORMED`

or

`Deployment: NOT PERFORMED`

when those actions were not authorized.
