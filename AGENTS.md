# Atlas Marketing OS — Agent Safety Rules

These rules apply to every coding agent, AI assistant, automation, recovery agent, and maintenance workflow working in this repository.

## 1. Git integration is user-gated

**Default rule: DO NOT MERGE.**

An agent must never merge, squash-merge, rebase-merge, cherry-pick into, fast-forward, force-push, reset, or directly update a protected/integration branch unless the user explicitly authorizes that exact integration action in the current conversation/task.

Protected/integration branches include, at minimum:

- `main`
- `master` if present
- `production` if present
- `agent/railway-sync`
- any branch currently connected to Railway production
- any recovery branch that is being used as a production source

The following user phrases **do NOT count as merge permission** by themselves:

- “开始” / “继续” / “下一步”
- “修复” / “处理好” / “搞定”
- “做吧” / “直接做”
- “deploy” when the user has not specifically authorized branch integration
- “不要问太多” / “不要一直确认”

Valid authorization must clearly name the integration intent, for example:

- “merge 去 main”
- “把这个 PR merge”
- “push/merge 去 production”
- “把这个 commit 合进 agent/railway-sync”

If authorization is ambiguous, leave the fix on its working branch and report the commit/PR instead of merging.

## 2. Default workflow for every code change

1. Read the current branch and relevant repository instructions.
2. Create or use a dedicated task branch. Do not work directly on `main` or a production-connected branch.
3. Make the smallest change required for the task.
4. Inspect the complete diff and changed-file list.
5. Verify no unrelated recovery code, backups, generated files, old workers, or stale implementations were reintroduced.
6. Run the relevant tests and build checks.
7. Commit only the intended files to the task branch.
8. Report the branch, commit SHA, tests, and deployment impact.
9. **Stop before merge.** Wait for explicit merge authorization.

Opening a PR is allowed when useful, but opening a PR is not permission to merge it.

## 3. Mandatory pre-merge checks

Before any explicitly authorized merge/integration, the agent must verify all of the following:

- Compare base vs head commits and inspect the entire changed-file list.
- Confirm there are no unrelated changes bundled into the branch.
- Confirm no previously deleted/legacy implementation is being restored accidentally.
- Run API/web tests relevant to the touched area.
- Run the relevant production build.
- Check Prisma/schema/migration changes when database code is touched.
- Check scheduler/worker/cron/background-job registrations when backend modules are touched.
- Check for duplicate providers, duplicate processors, duplicate schedulers, polling loops, or multiple competing workers.
- Preserve existing regression guards; never bypass or delete a guard just to make a build pass.
- If a merge conflict exists, do not auto-resolve by choosing “ours” or “theirs” broadly. Resolve file-by-file and re-run checks.

If any check fails, do not merge.

## 4. Recovery and emergency fixes

Recovery work is especially high risk.

- Never merge a whole recovery branch merely because it restores one missing feature.
- Prefer a minimal hotfix branch or isolated commit containing only the required change.
- Never restore old files wholesale from backup/recovery branches without comparing them against the current architecture.
- Treat old worker, scheduler, queue, database polling, auth, deployment, and environment code as potentially stale.
- Before reintroducing a previously removed component, inspect why it was removed.
- Do not replace a newer implementation with an older one just because the older branch builds.

## 5. Background-job regression rule

Atlas previously experienced database resource spikes after competing/legacy Copilot workers and periodic `BackgroundJob` polling were reintroduced during recovery work.

Therefore:

- There must be only one canonical Copilot background-job implementation.
- Do not reintroduce `CopilotJobProcessor`, `CopilotJobService`, or `CopilotJobController` legacy implementations.
- Do not add periodic `@Interval(...)` / `setInterval(...)` polling for Copilot `BackgroundJob` processing.
- Keep the background-job regression guard enabled and passing.
- A build failure from a regression guard is a stop signal, not something to bypass.

## 6. Production deployment rule

Code completion and production deployment are separate actions.

Unless the user explicitly authorizes production deployment:

- do not update a Railway-connected production branch;
- do not trigger a manual Railway redeploy;
- do not change production environment variables;
- do not run destructive database operations;
- do not promote a recovery service into production.

When production deployment is explicitly authorized, deploy only the reviewed commit(s), then verify runtime health and the affected database/application metrics.

## 7. Destructive Git commands

Never run or emulate these against shared/protected branches without explicit user authorization:

- `git push --force` / `--force-with-lease`
- `git reset --hard`
- broad `git checkout -- .` / `git restore .` that discards user work
- history rewrites
- mass branch deletion
- automatic conflict resolution across many files

## 8. Preserve user work

Assume uncommitted, parallel, and recently merged work may be important.

- Do not overwrite unrelated edits.
- Do not clean up or refactor unrelated files during a bug fix.
- Do not include generated/back-up directories unless the task specifically requires them.
- If the working tree/base branch contains unexpected changes, isolate the requested fix rather than normalizing everything.

## 9. Final integration gate

Immediately before any merge, the agent must be able to state:

- source branch / commit;
- target branch;
- exact files changing;
- tests/builds passed;
- whether DB/schema, scheduler, worker, deployment, or environment behavior changes;
- that the user explicitly authorized this merge.

If the last item is false, **DO NOT MERGE**.

## 10. High-risk root-cause fix protocol

Use this protocol for auth/workspace, automation, scheduler, Calendar, publishing, database, routing, and production-adjacent fixes.

### 10.1 Freeze production baselines first

Before editing:

- identify the exact Git commit currently deployed for every affected Railway service;
- identify the Git branch each production service is actually tracking;
- compare those production heads before deciding where to branch;
- if API and Web production heads have diverged, **do not merge the production branches together merely to simplify the fix**;
- create separate isolated fix branches from the exact relevant production heads when required.

A newer repository branch head is not automatically the production baseline. Railway deployment history/configuration must be checked when production state matters.

### 10.2 No cross-line overwrite

When production lines have diverged:

- never copy a large file wholesale from one production line onto another without a complete diff review;
- preserve fixes that exist only on one production line;
- prefer narrow patches, wrappers, helpers, or exact guarded replacements;
- do not use a successful build on one line as evidence that replacing the other line is safe.

### 10.3 Scope must be solved at the data boundary

For authenticated APIs, workspace/tenant isolation must be enforced at the query/mutation boundary, not by fetching global data and filtering it only in the UI.

For every user-facing read or mutation:

- resolve the authenticated user's workspace from the existing auth context;
- constrain database queries to that workspace wherever possible;
- validate related IDs together, for example Brand + Channel + Post must belong to the same allowed workspace;
- treat cross-workspace IDs as inaccessible/not found;
- do not expose another workspace's records and then rely on frontend filtering to hide them.

If workspace ownership is missing or ambiguous in production, **fail closed**. Do not silently create a new production-looking workspace or starter Brand unless onboarding behavior is explicitly intended and tested.

### 10.4 Keep HTTP user context separate from system jobs

Do not make background schedulers, publishers, cron jobs, workers, or other system jobs depend on an HTTP authenticated-user context unless the architecture explicitly requires it.

When adding workspace isolation:

- user-facing HTTP paths must use authenticated workspace scope;
- scheduler/background/system paths must continue to use their explicit system workspace/runtime context;
- do not break Publisher/Scheduler execution by injecting request-only state into system jobs;
- add regression coverage proving background/system execution still works without HTTP auth context.

### 10.5 Calendar and scheduled-time safety

For new or updated scheduled content:

- a `SCHEDULED` item must not be created with a time in the past;
- validate this in the frontend for UX and again in the API for correctness;
- frontend input constraints such as `min` are not a substitute for submit-time validation;
- API validation is authoritative;
- DRAFT/history semantics must remain intact unless the task explicitly changes them;
- when editing an existing historical SCHEDULED record, do not reject unrelated edits merely because its old schedule time is now in the past; validate when the schedule time changes or status transitions into `SCHEDULED`;
- drag/drop rescheduling must not move a scheduled item into the past;
- if today's preferred default slot has passed, select the next deterministic future slot instead of reusing the past slot.

### 10.6 Empty dependency states must be explicit

If a selected Brand/workspace has no valid Channel or another required dependency is unavailable:

- do not show a misleading empty selector with no explanation;
- render an explicit unavailable/empty state;
- disable the action that cannot succeed;
- keep API-side validation even when the UI disables the action.

## 11. Verification-before-completion rule

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
10. retarget the PR to the real production base before review;
11. stop at **READY_FOR_REVIEW** until merge/deploy is explicitly authorized.

A failed verification step must be reported accurately. Do not describe skipped tests/builds as passing.

## 12. Temporary CI verification rules

If normal local execution is unavailable and temporary CI is required:

- use isolated non-production branches only;
- temporary CI must never deploy or mutate production data;
- use dummy/non-secret values only when a build tool requires environment variables for parsing/generation;
- never expose production secrets in workflow files or logs;
- if a CI workflow applies a mechanical source patch, every replacement must assert an exact expected source fragment and fail if it does not match;
- after verification, remove temporary trigger files/workflows from the fix branch or ensure the review PR excludes them;
- the final review diff must contain only the intended product/test changes.

## 13. Production-data mutation rule

Production database changes are separate from code changes and require explicit authorization.

Before an authorized production-data mutation:

- perform a read-only dry run;
- enumerate direct foreign-key/dependency impact;
- define exact preconditions and postconditions;
- prefer a single atomic transaction for related updates;
- abort if preconditions differ from the reviewed state;
- do not delete or move unrelated data as part of an ownership/routing repair;
- verify the resulting state immediately after commit.

If the connected tool blocks a sensitive production mutation, do not bypass the safety control through a different hidden path. Use an approved/manual execution path with guarded SQL or another explicitly authorized mechanism.

## 14. Final report for high-risk fixes

Before requesting merge/deploy authorization, report all of the following:

- root cause;
- exact production baselines used;
- isolated fix branch(es);
- exact files changed;
- exact tests/checks run and whether they passed, failed, or were skipped;
- API/Web build result;
- database/schema impact;
- scheduler/worker/system-job impact;
- remaining known risk;
- whether merging will automatically trigger Railway production deployment;
- explicit statement: `NO MERGE / NO DEPLOY` unless the user has separately authorized those actions.

Only after this report and explicit user authorization may production integration proceed.
