# ATLAS Supervisor

This directory contains the lightweight control-plane contract for coordinating coding agents working on ATLAS Marketing OS.

Repository-wide mandatory behavior is defined in `/AGENTS.md`. This directory holds operational control artifacts rather than a conflicting second policy source.

## Canonical control artifacts

- `supervisor-system-instruction.md` — behavioral instruction for the Supervisor itself.
- `task-state-machine.yaml` — machine-readable lifecycle, transitions, actors, retry policy and invariants.
- `agent-permission-matrix.yaml` — role/action authorization model using default-deny semantics.
- `task-template.yaml` — per-task assignment contract used by the Supervisor.

When the same concept appears in multiple files, `/AGENTS.md` is the repository-wide rule source, while the YAML files provide the structured execution contract. Any conflict must be resolved conservatively: do not broaden permissions or skip verification.

## Operating loop

1. Receive one owner objective.
2. Inspect repository state and active work.
3. Create a bounded task contract from `task-template.yaml`.
4. Select the narrowest appropriate worker role.
5. Evaluate the requested actions against `agent-permission-matrix.yaml`.
6. Establish dependencies and file ownership before parallel work.
7. Advance the task only through transitions allowed by `task-state-machine.yaml`.
8. Let workers implement only within their assigned scope.
9. Collect evidence instead of accepting completion claims.
10. Run or review verification.
11. Return failed verification to the responsible worker, with a maximum of two materially similar blind retries.
12. Mark successful work `READY_FOR_REVIEW` and report that merge/deployment was not performed unless separately authorized.

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

## Permission evaluation

For every requested action:

1. find the worker role in `agent-permission-matrix.yaml`;
2. if the action is explicitly denied, stop it;
3. if the action is conditional, verify every required condition before allowing it;
4. if the action is absent, apply the global `default: deny` rule;
5. never let a task contract grant more authority than the role matrix permits.

## Conflict handling

When two tasks require the same mutable file, the later task is blocked until the Supervisor reassigns ownership or the earlier task releases it. Do not solve this by merging, rebasing, cherry-picking, or copying unreviewed changes between branches.

## Completion semantics

`IMPLEMENTED` means a worker believes its scoped change is complete.

`READY_FOR_REVIEW` means the Supervisor has reviewed the required evidence and relevant verification has passed.

`APPROVED` means the user has accepted the result. It does not imply permission to merge or deploy.

## Integration gate

Merge, rebase, squash, cherry-pick, auto-merge, force push and direct PR merge are disabled by default. The user must explicitly authorize the exact integration action after the Supervisor reports branch/status/diff/conflicts/tests.

## Mandatory external code-agent admission

Codex, ChatGPT Work coding flows, ChatGPT coding agents, GitHub-connected coding agents, and any future code-writing agent are external workers under the Engineering Supervisor.

Read-only inspection, explanation, planning, architecture review, and non-mutating diagnosis may run without a worker execution. Before any repository write intended for integration, the Supervisor must persist a task and execution, assign a worker role, establish allowed paths and file ownership, and include forbidden actions plus acceptance criteria in the execution assignment.

External workers do not define their own authority. Persisted Supervisor task/execution state is the source of truth for role, scope, file ownership and permissions.

A branch, commit, patch or PR created without valid Supervisor admission is `UNSUPERVISED` and is not integratable. It must not be merged, mirrored to a Railway production branch, deployed or used for a production migration until a new Supervisor task/execution audits the complete diff and required verification succeeds.

The `atlas-supervisor-gate` review check binds an integration candidate to its persisted task/execution, exact changed files, target branch, base SHA and head SHA. A passing review check proves candidate readiness only; it does not authorize merge, deploy, migration or runtime configuration changes.

API, Web and Browser Worker source changes follow this same admission and integration model. Datadog is image-based infrastructure rather than ATLAS Git source, so Datadog image/version/configuration/redeploy changes require an `infra` Supervisor task; read-only Datadog health/log inspection is exempt from code execution admission.
