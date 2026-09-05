# High-risk engineering playbook

These required procedures implement [repository invariants](../../../AGENTS.md); they grant no role, scope, integration or deployment authority. Apply the relevant sections to the admitted assignment. Missing authority or evidence remains fail-closed.


## Long-running tool execution

For long-running asynchronous command or tool polling:

- empty-stdin polls should use a wait or yield of at least `180000 ms`;
- prefer `300000 ms` when intermediate output is unnecessary;
- non-empty interactive stdin writes are exempt from the long wait;
- an outer execution wait should exceed the longest nested wait by at least `30000 ms`;
- do not wake execution solely to report that a process is still running when the tool can return on completion.

These values are operational guidance only. They do not grant authority, broaden scope or override the active tool/runtime constraints.

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
