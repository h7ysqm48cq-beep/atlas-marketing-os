# Atlas Marketing OS — Mandatory Git Safety Instructions

These instructions are mandatory for GitHub Copilot and any AI coding agent operating in this repository.

## Never auto-merge

Do not merge, squash, rebase, cherry-pick into, fast-forward, force-push, or directly update `main`, `production`, `agent/railway-sync`, or any Railway production-connected branch unless the user explicitly authorizes that exact integration action in the current task.

“开始”, “继续”, “下一步”, “修复”, “处理好”, “做吧”, “搞定”, or “不要问太多” are **not** permission to merge.

If the user asks to fix something, the default result is:

1. work on an isolated task branch;
2. make the smallest fix;
3. inspect the full diff;
4. run relevant tests/builds;
5. commit the fix;
6. report branch + commit SHA + checks;
7. stop before merge and wait for explicit merge authorization.

Opening a PR does not authorize merging it.

## Before any authorized integration

Always inspect base vs head and the complete changed-file list. Do not bundle unrelated recovery changes. Re-run relevant tests and production builds. For backend changes, check for duplicate modules/providers/workers/schedulers/cron jobs and database polling loops. For DB changes, inspect Prisma/schema/migrations. Do not bypass regression guards to make a build pass.

Never auto-resolve broad merge conflicts with “ours” or “theirs”. Resolve file-by-file and verify again.

## Recovery branches are untrusted sources

Never merge an entire recovery branch just because one feature is needed. Prefer a minimal hotfix or isolated commit. Compare old files with the current architecture before restoring them. Previously removed code may have been removed for a production incident.

Atlas has already suffered a database resource spike after legacy/competing Copilot background-job workers and periodic `BackgroundJob` polling were reintroduced during recovery. Do not reintroduce legacy `CopilotJobProcessor`, `CopilotJobService`, or `CopilotJobController`, and do not add periodic Copilot BackgroundJob polling with `@Interval` or `setInterval`. Keep the background-job regression guard enabled.

## Production is a separate permission

Completing code is not permission to deploy production. Do not update a production-connected branch, trigger Railway deployment, alter production env vars, or run destructive DB operations unless the user explicitly authorizes production deployment.

## Destructive commands

Do not run force pushes, hard resets, history rewrites, mass branch deletion, or broad restore/checkout operations that can discard unrelated work unless the user explicitly authorizes the destructive action.

The final gate is simple: if the user has not explicitly authorized the exact merge/integration target, **DO NOT MERGE**.
