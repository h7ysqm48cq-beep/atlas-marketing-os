# ATLAS Supervisor

This directory contains the lightweight control-plane contract for coordinating coding agents working on ATLAS Marketing OS.

Repository-wide mandatory behavior is defined in `/AGENTS.md`. This directory holds operational templates rather than a second policy source.

## Operating loop

1. Receive one owner objective.
2. Inspect repository state and active work.
3. Create a bounded task contract from `task-template.yaml`.
4. Select the narrowest appropriate worker role.
5. Establish dependencies and file ownership before parallel work.
6. Let workers implement only within their assigned scope.
7. Collect evidence instead of accepting completion claims.
8. Run or review verification.
9. Return failed verification to the responsible worker, with a maximum of two materially similar blind retries.
10. Mark successful work `READY_FOR_REVIEW` and report that merge/deployment was not performed unless separately authorized.

## Default worker routing

| Change area | Primary worker | Typical verifier |
| --- | --- | --- |
| Next.js/UI/PWA/mobile | frontend | qa |
| NestJS/API/automation | backend | qa |
| Prisma/Postgres/Supabase | database | backend + qa |
| Reproduction/regression | qa | supervisor |
| Railway/runtime/logs | infra | supervisor + qa |
| Cross-cutting bounded change | engineering | qa |

The table is guidance, not permission to edit outside an explicit task contract.

## Conflict handling

When two tasks require the same mutable file, the later task is blocked until the Supervisor reassigns ownership or the earlier task releases it. Do not solve this by merging, rebasing, cherry-picking, or copying unreviewed changes between branches.

## Completion semantics

`IMPLEMENTED` means a worker believes its scoped change is complete.

`READY_FOR_REVIEW` means the Supervisor has reviewed the required evidence and relevant verification has passed.

`APPROVED` means the user has accepted the result. It does not imply permission to merge or deploy.

## Integration gate

Merge, rebase, squash, cherry-pick, auto-merge, force push and direct PR merge are disabled by default. The user must explicitly authorize the exact integration action after the Supervisor reports branch/status/diff/conflicts/tests.
