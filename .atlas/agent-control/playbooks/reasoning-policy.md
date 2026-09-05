# Minimum-sufficient reasoning policy

Use the minimum sufficient reasoning effort. Default: `LOW`.

Do not increase reasoning merely because a task is long. Escalate only when complexity, ambiguity, failed evidence, or risk requires it. After the difficult decision is resolved, return to the lowest sufficient level.

## Reasoning levels

### LOW — default

Use `LOW` for deterministic or bounded work such as:

- read/search/status inspection;
- exact bounded commands;
- straightforward file inspection;
- deterministic small edits;
- formatting or refactoring with frozen behavior;
- known tests, builds, type checks or lint;
- expected-versus-actual comparison;
- routine evidence collection.

### MEDIUM — ambiguity or non-trivial coupling

Escalate to `MEDIUM` when the task has material uncertainty, including:

- multiple plausible root causes;
- non-trivial multi-file coupling;
- unfamiliar dependency behavior;
- regression-surface analysis;
- state-transition changes;
- ambiguous test failures;
- competing implementation choices.

### HIGH — consequential risk or conflicting models

Escalate locally to `HIGH` for difficult decisions involving:

- authentication, authorization or identity;
- concurrency, CAS, atomicity or race conditions;
- production-data mutation;
- schema migration;
- secrets or credential boundaries;
- divergent production histories;
- destructive or irreversible operations;
- architectural decisions with long-term consequences;
- conflicting governance rules;
- repeated failed attempts that disprove the current model.

`HIGH` is local to the difficult decision, not sticky for the whole task. After that decision is resolved, return to `MEDIUM` or `LOW` as appropriate.

This is non-authoritative execution guidance under [repository invariants](../../../AGENTS.md). It sets no model, provider or token requirement and changes no Supervisor permissions or completion gates.

Use the least effort that establishes the actual flow, handles material edge cases and produces the required evidence. Brevity is not a substitute for understanding or verification.

| Actual risk | Sufficient approach |
| --- | --- |
| Read-only fact or bounded wording change | Inspect the exact source and verify the result |
| Scoped behavior change | Trace callers and boundaries, establish the cause, make the smallest correct change and run relevant checks |
| Auth, tenant, database, scheduler, publishing or production-adjacent change | Apply the full applicable [high-risk procedure](high-risk-engineering.md), including regressions and production-baseline evidence when relevant |
| Unknown scope or conflicting evidence | Investigate until the uncertainty is resolved; stop dependent edits if authority or scope is missing |

Prefer existing code, standard-library and native platform behavior before new dependencies or abstractions. Do not omit trust-boundary validation, security, data-loss prevention, accessibility or explicit acceptance criteria to reduce effort.

Increase investigation when callers disagree, state crosses boundaries, failures recur, evidence conflicts or rollback is uncertain. After two materially similar failed attempts, stop blind retries and return to Supervisor reassessment. Higher reasoning effort does not authorize new paths or actions.

Stop when the admitted objective and applicable verification are satisfied. Do not add speculative refactors or repeat unchanged passing checks without new evidence. Record limitations honestly; worker `IMPLEMENTED`, Supervisor `READY_FOR_REVIEW` and user approval remain separate.
