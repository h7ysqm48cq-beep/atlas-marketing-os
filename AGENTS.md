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

Use this protocol for auth/workspace, automation, scheduler, Calendar, publishing, database, routing, Browser Worker and production-adjacent fixes.

Before editing:

- identify the exact Git commit currently deployed for every affected Railway service;
- identify the branch each service is actually tracking;
- compare API/Web production heads before choosing a base;
- if production heads have diverged, do not merge whole lines for convenience;
- create isolated fix branches from the exact relevant production heads;
- never assume `main`, `agent/railway-sync`, or the newest branch is the production baseline.

When production lines diverge:

- never overwrite large files wholesale from another line without a complete diff review;
- preserve fixes that exist only on one line;
- prefer narrow patches/helpers/wrappers;
- reconcile only onto an audited canonical production line.

## 11. Workspace, auth and scheduler isolation

For authenticated APIs, workspace isolation belongs at the database/query/mutation boundary, not only in frontend filtering.

- resolve the authenticated user's workspace using the existing auth context;
- constrain reads and mutations to that workspace;
- validate related Brand/Channel/Post IDs belong to the same permitted workspace;
- treat cross-workspace IDs as inaccessible/not found;
- if production ownership is missing or ambiguous, fail closed rather than silently creating a production-looking workspace or Brand.

Do not make schedulers, publishers, cron jobs or other system jobs depend on HTTP authenticated-user context unless explicitly designed that way. User-facing HTTP paths and system/background execution must remain separately scoped and regression-tested.

## 12. Calendar and dependency-state safety

For `SCHEDULED` content:

- new scheduled times must be strictly in the future;
- validate in the frontend for UX and again in the API for correctness;
- frontend `min` constraints are not sufficient by themselves;
- DRAFT/history semantics must remain intact unless explicitly changed;
- unrelated edits to an old scheduled record must not fail merely because its original schedule time is now past;
- validate future time when scheduled time changes or status becomes `SCHEDULED`;
- drag/drop rescheduling must not move a scheduled item into the past;
- if today's preferred default slot has passed, choose a deterministic future slot.

If a Brand/workspace has no valid Channel or another required dependency is missing, show an explicit unavailable state and disable the action that cannot succeed. Keep API-side validation as defense in depth.

## 13. Verification-before-completion

For high-risk fixes, do not claim completion until applicable checks have run:

1. inspect exact changed files and diff;
2. run focused regression tests for the root cause;
3. run the affected package/application test suite;
4. run Prisma generation when Prisma is involved;
5. run the affected production build(s);
6. run targeted lint/type checks for changed frontend files;
7. distinguish pre-existing unrelated failures from patch-introduced failures;
8. do not expand scope to repair unrelated repository debt without separate authorization;
9. verify temporary CI/debug/trigger artifacts are not accidentally included in the product diff;
10. verify the integration target is the actual production baseline/canonical line;
11. stop at `READY_FOR_REVIEW` until merge/deploy is explicitly authorized.

Skipped verification is `NOT RUN`, never a pass.

## 14. Temporary CI and production-data rules

If temporary CI is required because local execution is unavailable:

- use isolated non-production branches;
- temporary CI must never deploy or mutate production data;
- use dummy/non-secret variables only when tooling requires parse-time values;
- exact mechanical source replacements must assert their expected source fragment and fail if it differs;
- final product diffs must exclude temporary CI workflows/triggers unless intentionally retained as an operational marker.

Production database mutations require separate explicit authorization. Before mutation, perform a read-only dry run, enumerate dependencies, define pre/postconditions, prefer an atomic transaction, abort on precondition drift, and verify the result immediately. Never bypass a connected-tool safety block through a hidden alternate path.

## 15. Canonical production line

`production/atlas` is the intended canonical ATLAS production integration line after the 2026-09-01 production reconciliation.

- `main` and `agent/railway-sync` are not production sources merely because they exist.
- API and Web production should converge on the same canonical commit.
- service-specific emergency hotfixes must be reconciled back into `production/atlas` promptly.
- never force-push a Railway-tracked production branch during reconciliation.
- if Railway cannot persist a source-branch rename safely, an already-tracked branch may act only as a mirror of `production/atlas`; verify it is a true non-force fast-forward and deploy the exact canonical SHA.
- after deployment, verify Railway deployment metadata and runtime health against the exact canonical commit rather than trusting a branch-change acknowledgement.
- before any future production integration, report root cause, exact production baselines, changed files, tests/builds, DB/schema impact, scheduler/worker impact, deployment-trigger behavior and remaining risk.
