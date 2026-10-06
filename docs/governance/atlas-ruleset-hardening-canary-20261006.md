# ATLAS Ruleset Hardening Canary — 2026-10-06

Purpose: verify the final protected-branch ruleset after enabling **Restrict updates** and configuring the dedicated **Atlas Trusted Merge** GitHub App as the only pull-request bypass actor.

This canary is documentation-only and changes no runtime logic, workflow logic, deployment configuration, Railway configuration, database state, schema, secrets, or repository settings.

Expected proof:

- the governed PR passes the required `atlas-supervisor-gate`;
- the dedicated `Atlas Trusted Merge` GitHub App can still merge through the pull-request route;
- the merge is attributed to `atlas-trusted-merge[bot]`;
- the merge commit parents equal the exact pre-merge production base and exact canary head;
- Supervisor merge authorization is consumed with an exact attestation;
- deployment remains `NOT_DEPLOYED`;
- the Ruleset remains unchanged after the canary.
