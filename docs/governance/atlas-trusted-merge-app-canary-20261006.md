# Atlas Trusted Merge App Canary — 2026-10-06

Purpose: provide a no-runtime, documentation-only governed pull request that proves the production trusted-merge path now executes the final branch write with the dedicated **Atlas Trusted Merge** GitHub App installation token.

This file intentionally changes no application logic, workflow logic, deployment configuration, database state, Railway configuration, or GitHub Ruleset.

Expected proof after an authorized merge:

- exact governed PR merged through the normal Supervisor gate;
- `production/atlas` advances by one normal merge commit;
- merge parents equal the exact pre-merge production base and this canary head;
- GitHub `mergedBy` attribution identifies the dedicated Atlas Trusted Merge GitHub App, not `github-actions[bot]`;
- Supervisor merge authorization is consumed with an exact merge attestation;
- deployment state remains `NOT_DEPLOYED`.

This canary exists only to verify merge identity before any later Ruleset hardening.
