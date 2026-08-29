# Atlas user workspace isolation

## Goal

Ensure every authenticated Supabase user resolves to one private Atlas workspace and cannot read or mutate another user's brands through the shared default-brand helpers or explicit brand IDs.

## Constraints

- Keep the current branch and isolated deployment copy; do not touch the original dirty checkout.
- Do not merge, rebase, squash, cherry-pick, auto-merge, force-push, or merge a PR.
- Preserve the existing MGMBETMYR workspace until its owner UUID is explicitly confirmed.
- Scheduled publisher work has no HTTP user context and must continue using an explicit system workspace path, never an arbitrary authenticated user's workspace.

## Implementation sequence

1. Add a request-scoped authenticated-user context using the existing verified `request.user.id` from `SupabaseAuthGuard`; keep the context absent for scheduler/background work.
2. Add a nullable, unique `Workspace.ownerUserId` field. Nullable preserves the current production schema until the existing workspace is explicitly backfilled.
3. Add failing unit tests first for: authenticated context propagation, per-user workspace lookup/creation, cross-user brand rejection, and refusal to use an unowned legacy workspace for an authenticated request.
4. Update `BrandsService` so list/get/create/update/getActiveBrand all resolve through the current user workspace. Keep a separate explicit system/default resolver for non-request jobs; do not silently fall back to it for authenticated requests.
5. Add one Prisma migration and regenerate the client. Do not execute a production data backfill until the user supplies the exact Supabase `auth.users.id` that owns MGMBETMYR.
6. Run the focused tests, API build, Prisma validation, and inspect the final diff/status. Only after the old workspace owner is confirmed may the migration/backfill be considered for Agent Railway deployment.

## Verification gates

- No authenticated request can see a brand whose workspace owner differs from its JWT `sub`.
- A first-time authenticated user gets a distinct workspace and default brand.
- The legacy `mgmbetmyr` workspace remains inaccessible while owner binding is unknown.
- Scheduler behavior remains deterministic and is not affected by request context.
- Production deployment is not claimed until Agent Railway reports success and API, database, browser worker, and web health are rechecked.
