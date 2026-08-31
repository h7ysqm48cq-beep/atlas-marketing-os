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

## 15. High-risk root-cause fix protocol

Use this protocol for auth/workspace, automation, scheduler, Calendar, publishing, database, routing, and production-adjacent fixes.

### 15.1 Freeze exact production baselines first

Before editing production-adjacent code:

- identify the exact Git commit currently deployed for every affected Railway service;
- identify the Git branch each production service is actually tracking;
- compare those production heads before deciding where to branch;
- if API and Web production heads have diverged, do not merge whole production lines merely for convenience;
- create separate isolated fix branches from the exact relevant production heads when required.

A newer repository branch head is not automatically the production baseline. Railway deployment history/configuration must be checked when production state matters.

### 15.2 No cross-line overwrite

When production lines have diverged:

- never copy a large file wholesale from one production line onto another without a complete diff review;
- preserve fixes that exist only on one production line;
- prefer narrow patches, wrappers, helpers, or exact guarded replacements;
- do not use a successful build on one line as evidence that replacing another line is safe;
- reconcile onto a dedicated canonical production line only after both sides have been audited.

### 15.3 Scope isolation at the data boundary

For authenticated APIs, workspace/tenant isolation must be enforced at the query/mutation boundary, not by fetching global data and filtering only in the UI.

For every user-facing read or mutation:

- resolve the authenticated user's workspace from the existing auth context;
- constrain database queries to that workspace wherever possible;
- validate related IDs together, for example Brand + Channel + Post must belong to the same allowed workspace;
- treat cross-workspace IDs as inaccessible/not found;
- do not expose another workspace's records and rely on frontend filtering to hide them.

If workspace ownership is missing or ambiguous in production, fail closed. Do not silently create a production-looking workspace or starter Brand unless onboarding behavior is explicitly intended and tested.

### 15.4 Keep HTTP user context separate from system jobs

Do not make background schedulers, publishers, cron jobs, workers, or other system jobs depend on an HTTP authenticated-user context unless the architecture explicitly requires it.

When adding workspace isolation:

- user-facing HTTP paths must use authenticated workspace scope;
- scheduler/background/system paths must continue to use their explicit system workspace/runtime context;
- do not break Publisher/Scheduler execution by injecting request-only state into system jobs;
- add regression coverage proving background/system execution still works without HTTP auth context.

### 15.5 Calendar and scheduled-time safety

For new or updated scheduled content:

- a `SCHEDULED` item must not be created with a time in the past;
- validate this in the frontend for UX and again in the API for correctness;
- frontend input constraints such as `min` are not a substitute for submit-time validation;
- API validation is authoritative;
- DRAFT/history semantics must remain intact unless the task explicitly changes them;
- when editing an existing historical SCHEDULED record, do not reject unrelated edits merely because its old schedule time is now in the past; validate when schedule time changes or status transitions into `SCHEDULED`;
- drag/drop rescheduling must not move a scheduled item into the past;
- if today's preferred default slot has passed, select the next deterministic future slot instead of reusing the past slot.

### 15.6 Empty dependency states must be explicit

If a selected Brand/workspace has no valid Channel or another required dependency is unavailable:

- do not show a misleading empty selector with no explanation;
- render an explicit unavailable/empty state;
- disable the action that cannot succeed;
- keep API-side validation even when the UI disables the action.

## 16. Verification-before-completion rule

Never claim a fix is complete merely because code was edited or a focused test passed.

For high-risk fixes, verification must proceed in this order where applicable:

1. inspect exact changed files and diff;
2. run focused regression tests for the root cause;
3. run the affected workspace/application full test suite;
4. run Prisma generation when Prisma types/schema are involved;
5. run the affected production build(s);
6. run targeted lint/type checks for modified frontend files;
7. distinguish pre-existing unrelated lint/test failures from failures introduced by the patch;
8. do not expand scope to fix unrelated repository debt unless separately authorized;
9. verify the final PR contains no CI trigger files, temporary workflows, debug artifacts, or unrelated changes;
10. verify the final integration target is the real production baseline/canonical production line;
11. stop at `READY_FOR_REVIEW` until merge/deploy is explicitly authorized.

A failed verification step must be reported accurately. Do not describe skipped tests/builds as passing.

## 17. Temporary CI verification rules

If normal local execution is unavailable and temporary CI is required:

- use isolated non-production branches only;
- temporary CI must never deploy or mutate production data;
- use dummy/non-secret values only when a build tool requires environment variables for parsing/generation;
- never expose production secrets in workflow files or logs;
- if a CI workflow applies a mechanical source patch, every replacement must assert an exact expected source fragment and fail if it does not match;
- after verification, remove temporary trigger files/workflows from the product fix branch or ensure the final review/integration diff excludes them;
- the final production diff must contain only intended product/test/rule changes.

## 18. Production-data mutation rule

Production database changes are separate from code changes and require explicit authorization.

Before an authorized production-data mutation:

- perform a read-only dry run;
- enumerate direct foreign-key/dependency impact;
- define exact preconditions and postconditions;
- prefer a single atomic transaction for related updates;
- abort if preconditions differ from the reviewed state;
- do not delete or move unrelated data as part of an ownership/routing repair;
- verify the resulting state immediately after commit.

If a connected tool blocks a sensitive production mutation, do not bypass the safety control through a different hidden path. Use an approved/manual execution path with guarded SQL or another explicitly authorized mechanism.

## 19. High-risk final report

Before requesting or completing production integration/deployment, report or verify all of the following:

- root cause;
- exact production baselines used;
- isolated fix branch(es);
- exact files changed;
- exact tests/checks run and whether they passed, failed, or were skipped;
- API/Web build result;
- database/schema impact;
- scheduler/worker/system-job impact;
- remaining known risk;
- whether integrating the branch will automatically trigger Railway deployment;
- explicit integration/deployment authorization state.

## 20. Canonical production branch rule

`production/atlas` is the intended canonical production integration line for ATLAS after production reconciliation.

Rules:

- API and Web production must converge on the same canonical Git commit before a reconciliation is considered complete;
- `main` and `agent/railway-sync` are not production sources merely because they exist; they must be separately reconciled before any future production use;
- do not point Railway at another branch or move a production-tracked branch to unrelated history without an explicit cutover review;
- production hotfixes must branch from the currently deployed canonical production commit whenever possible;
- after an emergency service-specific hotfix, reconcile it back into `production/atlas` promptly so API/Web branch drift does not become permanent;
- never force-push a Railway-tracked production branch during reconciliation;
- if Railway cannot change its configured source branch safely, a non-force fast-forward of the already tracked branch to the verified canonical descendant is allowed only after confirming the update is a true fast-forward and the canonical commit has passed combined verification;
- after cutover, verify Railway deployment metadata and runtime health against the exact canonical commit rather than trusting a branch-change acknowledgement alone.
