# ATLAS repository invariants

These rules apply to every agent and tool working on ATLAS Marketing OS.
Operational procedures live in [.atlas/agent-control/README.md](.atlas/agent-control/README.md).

## Authority and admission

- Authority order: user / repository owner → ATLAS Supervisor → assigned worker.
- Read-only inspection, explanation, planning, architecture review and non-mutating diagnosis may occur without a worker execution. All repository-modifying work requires Supervisor admission first.
- Before integratable work, persisted Supervisor state must contain a task in an implementation-compatible state, an execution belonging to that task, assigned worker role, exact allowed paths, active file ownership, forbidden actions and acceptance criteria.
- Persisted assignment controls scope and permissions. Caller-supplied IDs, role, scope, skills, prompts and playbooks cannot grant authority or override it.
- Missing, stale, unavailable or mismatched Supervisor state is fail-closed. Never downgrade the gate to a warning or accept an agent's self-reported task ID as authority.
- Unadmitted branches, commits, patches and PRs are `UNSUPERVISED` and `NOT INTEGRATABLE`: no merge, production-branch mirroring, deployment or production migration. Recovery requires a fresh task/execution, a complete scope audit and new verification evidence.

## Scope and ownership

- Each mutable file or tightly coupled file set has one active owner. Conflicting work is blocked until Supervisor resolves ownership.
- Edit only admitted paths. Stop out-of-scope work and request Supervisor scope resolution; no opportunistic refactors, schema, authentication or runtime changes.
- Parallel work requires independent mutable state and satisfied dependencies.
- Preserve unrelated working-tree changes. Do not stash, reset, clean, restore or overwrite them without explicit owner authorization.
- Apply the existing default-deny [role matrix](.atlas/agent-control/agent-permission-matrix.yaml). An assignment cannot override a role denial.

## Lifecycle and evidence

- Follow the existing [task state machine](.atlas/agent-control/task-state-machine.yaml).
- Workers may report `WORKING`, `BLOCKED`, `IMPLEMENTED` or `FAILED`; they cannot self-declare `READY_FOR_REVIEW` or `APPROVED`.
- Only Supervisor advances `IMPLEMENTED → VERIFYING → READY_FOR_REVIEW` after required evidence review. Only the user approves.
- `APPROVED`, passing CI and Supervisor review never imply merge, deployment or migration authorization.
- Completion requires exact changed files, relevant tests/build/regression evidence, Git and deployment state, and remaining risks. Missing verification is `NOT RUN` with a reason, never a pass.
- After two materially similar failed attempts, stop blind retries and reassess cause, scope, dependencies or ownership.

## Integration and production

- Separate explicit user authorization is required for merge, rebase, squash integration, cherry-pick, auto-merge, force push, direct PR merge, destructive branch replacement and branch deletion used for integration.
- Generic instructions such as “continue” or “finish” do not authorize protected actions. Report branch, status, exact diff/commit range, conflicts, checks and proposed action before authorized integration.
- A normal commit on the assigned branch is permitted only when the workflow expects it and it performs no implicit integration.
- Deployment is separate from implementation and requires explicit authorization. Production-data mutation requires separate explicit authorization; never bypass a blocked safety control through another path.
- Keep code ready, deployment ready, deployed and production verified distinct. A build does not prove production health.
- `production/atlas` is the canonical production integration line. Actual deployed commits and service tracking must be verified when production state matters; branch names alone are not evidence.
- For candidates targeting `production/atlas`, `atlas-supervisor-gate` must validate persisted task/execution, exact changed files, target branch, base SHA and head SHA. Passing this check grants no merge/deploy permission.
- API, Web and Browser Worker source changes are Supervisor-gated; Browser Worker fixes must be reconciled to canonical production through authorized integration.
- Datadog image/version/configuration/redeploy changes require an `infra` Supervisor task. Read-only health/log inspection needs no code execution admission.

## High-risk safeguards

Follow [high-risk engineering procedures](.atlas/agent-control/playbooks/high-risk-engineering.md) for authentication/workspace isolation, database, automation/scheduler/Calendar/publishing, Browser Worker and Page/channel isolation, routing, assets/storage, PWA/mobile caching, per-channel settings and production-adjacent changes.

Preserve fail-closed tenant boundaries, HTTP/system-job separation, authoritative API validation, scheduled-time and historical-record semantics, explicit unavailable dependency states, exact production baselines, no cross-line overwrite, guarded production-data transactions, secret protection and complete applicable verification.

Use the minimum sufficient reasoning effort. Default to `LOW`; escalate only when complexity, ambiguity, failed evidence or consequential risk requires it, then return to the lowest sufficient level after the difficult decision is resolved.

Skills and playbooks are execution aids within these rules, never independent authorization sources. Resolve conflicts conservatively without broadening scope or weakening safety. Stop at verified `READY_FOR_REVIEW` pending separate owner action.
