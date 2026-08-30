# Agent Supervisor Deployment Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove ATLAS Agent Supervisor Phase 2B can be integrated and deployed without dropping production-only commits, corrupting Prisma migration history, or starting the API before the Supervisor tables exist.

**Architecture:** Keep code integration, database migration, and Railway deployment as three separately authorized gates. First reconcile the diverged feature and production source histories in an isolated worktree without changing either source branch. Then validate Prisma migration history and apply the Supervisor migration to an isolated PostgreSQL database. Only after explicit user authorization may the selected integration branch be wired to Railway, with migration executed before application startup.

**Tech Stack:** Git/GitHub, NestJS, Prisma 7.9.1, PostgreSQL, Railway/Railpack, Jest

**Spec:** `docs/superpowers/specs/2026-08-30-agent-supervisor-phase2b-persistence-design.md`

## Global Constraints

- Do not merge, rebase, squash, cherry-pick, auto-merge, force-push, delete an integration branch, or change Railway source branches without explicit user approval.
- Do not run a production migration or production deploy without explicit user approval.
- Treat `codex/atlas-screenshot-proxy-2e30a409` as the current Railway API production source until Railway configuration is intentionally changed.
- Treat `feat/web-testing-foundation` as the verified Supervisor Phase 2B source.
- Current branch divergence must be resolved before deployment: feature is ahead of production source and also missing production-only commits.
- Preserve the existing `20260829090000_add_workspace_owner_user_id` migration exactly; both branches currently contain the same blob.
- The Phase 2B migration `20260830090000_agent_supervisor_persistence` must remain additive-only.
- Supervisor API startup must not precede creation of `SupervisorTask`, `SupervisorExecution`, and `SupervisorFileLock` in the target database.
- Evidence, not worker claims, determines readiness.

---

### Task 1: Freeze and compare deployment inputs

**Files:**
- Read: `apps/api/package.json`
- Read: `apps/api/prisma/schema.prisma`
- Read: `apps/api/prisma/migrations/20260829090000_add_workspace_owner_user_id/migration.sql`
- Read: `apps/api/prisma/migrations/20260830090000_agent_supervisor_persistence/migration.sql`

**Interfaces:**
- Consumes: verified Phase 2B head and current Railway API source head.
- Produces: immutable commit SHAs and a branch-divergence report used by every later gate.

- [ ] **Step 1: Capture immutable refs**

```bash
git fetch origin feat/web-testing-foundation codex/atlas-screenshot-proxy-2e30a409
FEATURE_SHA="$(git rev-parse origin/feat/web-testing-foundation)"
PROD_SHA="$(git rev-parse origin/codex/atlas-screenshot-proxy-2e30a409)"
printf 'FEATURE_SHA=%s\nPROD_SHA=%s\n' "$FEATURE_SHA" "$PROD_SHA"
```

Expected: two full 40-character SHAs.

- [ ] **Step 2: Prove divergence instead of assuming fast-forward safety**

```bash
git rev-list --left-right --count \
  origin/codex/atlas-screenshot-proxy-2e30a409...origin/feat/web-testing-foundation
```

Expected at plan creation: feature and production source are diverged; do not expect `0 N` or `N 0` without rechecking.

- [ ] **Step 3: Enumerate production-only commits**

```bash
git log --oneline --no-merges \
  origin/feat/web-testing-foundation..origin/codex/atlas-screenshot-proxy-2e30a409
```

Expected: every production-only commit is visible for review. Any auth, automation, Browser Worker, image persistence, system-health, jobs, or schema change is considered deployment-relevant.

- [ ] **Step 4: Enumerate feature-only commits**

```bash
git log --oneline --no-merges \
  origin/codex/atlas-screenshot-proxy-2e30a409..origin/feat/web-testing-foundation
```

Expected: Supervisor Phase 2A/2B and associated verified changes are visible.

- [ ] **Step 5: Stop if either branch moved during review**

```bash
test "$FEATURE_SHA" = "$(git rev-parse origin/feat/web-testing-foundation)"
test "$PROD_SHA" = "$(git rev-parse origin/codex/atlas-screenshot-proxy-2e30a409)"
```

Expected: exit 0. If either fails, restart Task 1 with fresh refs.

---

### Task 2: Create an isolated integration candidate without modifying source branches

**Files:**
- Potential conflicts only; do not modify source branches.

**Interfaces:**
- Consumes: immutable refs from Task 1.
- Produces: an isolated integration candidate worktree and conflict inventory.

- [ ] **Step 1: Create a temporary local integration branch from the current production source**

```bash
cd ~/Downloads/atlas-marketing-os
git worktree add -b review/supervisor-phase2b-integration \
  ../atlas-supervisor-integration \
  "$PROD_SHA"
cd ../atlas-supervisor-integration
```

Expected: clean new worktree based exactly on the Railway production source SHA.

- [ ] **Step 2: Perform a no-commit merge simulation only after explicit user authorization**

```bash
git merge --no-commit --no-ff "$FEATURE_SHA"
```

Expected: either a clean staged merge candidate or explicit conflicts. This command is **forbidden until the user explicitly authorizes integration simulation** because merge operations are deny-by-default.

- [ ] **Step 3: If conflicts exist, inventory them before touching files**

```bash
git status --short
git diff --name-only --diff-filter=U
```

Expected: exact conflict list. Do not resolve unrelated files.

- [ ] **Step 4: Abort the simulation if approval covers inspection only**

```bash
git merge --abort
```

Expected: clean worktree returned to `$PROD_SHA`.

---

### Task 3: Validate migration-chain safety on an isolated PostgreSQL database

**Files:**
- Read: `apps/api/prisma/migrations/**/migration.sql`
- Generated only: `apps/api/src/generated/prisma/**`

**Interfaces:**
- Consumes: integration candidate tree or exact Phase 2B tree.
- Produces: Prisma migration status, additive SQL evidence, and a database that contains the expected Supervisor tables/indexes.

- [ ] **Step 1: Scan the Supervisor migration for destructive operations**

```bash
MIGRATION=apps/api/prisma/migrations/20260830090000_agent_supervisor_persistence/migration.sql
cat "$MIGRATION"
! grep -Eiq '\b(DROP|TRUNCATE)\b|ALTER[[:space:]]+TABLE.*\b(DROP|RENAME)\b' "$MIGRATION"
```

Expected: exit 0 and SQL limited to table/index/FK creation.

- [ ] **Step 2: Verify the pre-existing workspace migration is unchanged**

```bash
git show "$PROD_SHA":apps/api/prisma/migrations/20260829090000_add_workspace_owner_user_id/migration.sql > /tmp/prod-workspace.sql
git show "$FEATURE_SHA":apps/api/prisma/migrations/20260829090000_add_workspace_owner_user_id/migration.sql > /tmp/feature-workspace.sql
cmp /tmp/prod-workspace.sql /tmp/feature-workspace.sql
```

Expected: exit 0.

- [ ] **Step 3: Start an isolated Prisma Postgres instance and capture its real TCP URL**

```bash
export DATABASE_URL="postgresql://postgres:unused@127.0.0.1:59999/unused"
npx prisma dev start atlas-supervisor-deploy-dryrun
npx prisma dev ls
```

Expected: named local instance is running. Use the TCP URL printed by Prisma; never assume a port.

- [ ] **Step 4: Create a disposable test database and apply migrations**

Use the TCP host/port printed in Step 3. Example only, replacing `<PORT>` with the actual value:

```bash
node - <<'NODE'
const { Client } = require('pg');
const port = Number(process.env.PRISMA_DEV_TCP_PORT);
if (!port) throw new Error('PRISMA_DEV_TCP_PORT is required');
(async () => {
  const admin = new Client({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/template1?sslmode=disable` });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS atlas_supervisor_deploy_dryrun');
  await admin.query('CREATE DATABASE atlas_supervisor_deploy_dryrun');
  await admin.end();
})().catch((error) => { console.error(error); process.exit(1); });
NODE
```

Expected: disposable database created only on the local Prisma Dev instance.

- [ ] **Step 5: Apply the repository migration chain to the disposable database**

```bash
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PRISMA_DEV_TCP_PORT}/atlas_supervisor_deploy_dryrun?sslmode=disable"
npx prisma migrate deploy --config prisma.config.ts
```

Expected: migration deploy exits 0. Do not substitute a production URL.

- [ ] **Step 6: Confirm Supervisor schema objects exist**

```bash
node - <<'NODE'
const { Client } = require('pg');
(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const tables = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('SupervisorTask','SupervisorExecution','SupervisorFileLock') ORDER BY tablename`);
  const idx = await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='SupervisorExecution_one_active_per_task'`);
  console.log(tables.rows);
  console.log(idx.rows);
  if (tables.rowCount !== 3 || idx.rowCount !== 1) process.exitCode = 1;
  await db.end();
})().catch((error) => { console.error(error); process.exit(1); });
NODE
```

Expected: all three tables plus the partial unique index exist.

---

### Task 4: Verify build-time Prisma generation matches Railway

**Files:**
- Read: `apps/api/package.json`
- Generated/cleaned: `apps/api/src/generated/prisma/**`

**Interfaces:**
- Consumes: candidate source tree.
- Produces: evidence that Railway's current build command can generate Supervisor delegates before Nest compilation.

- [ ] **Step 1: Run the repository API build path**

```bash
DATABASE_URL="$DATABASE_URL" npm run build --workspace apps/api
```

Expected: Prisma Client generation, background job regression guard, and `nest build` all exit 0.

- [ ] **Step 2: Verify generated Supervisor delegates**

```bash
grep -R \
  -e 'get supervisorTask' \
  -e 'get supervisorExecution' \
  -e 'get supervisorFileLock' \
  apps/api/src/generated/prisma/internal/class.ts
```

Expected: all three delegates are present.

- [ ] **Step 3: Restore generated files**

```bash
git restore apps/api/src/generated/prisma
git clean -fd -- \
  apps/api/src/generated/prisma/models/SupervisorExecution.ts \
  apps/api/src/generated/prisma/models/SupervisorFileLock.ts \
  apps/api/src/generated/prisma/models/SupervisorTask.ts
git status --short
```

Expected: no generated artifact changes remain.

---

### Task 5: Run the complete Supervisor verification gate on the candidate

**Files:**
- Test only.

**Interfaces:**
- Consumes: candidate source plus disposable PostgreSQL database.
- Produces: final test/build evidence for review.

- [ ] **Step 1: Run real PostgreSQL integration**

```bash
SUPERVISOR_INTEGRATION_DATABASE_URL="$DATABASE_URL" \
npm test --workspace apps/api -- --runInBand \
  src/agent-supervisor/persistence/supervisor-persistence.integration.spec.ts
```

Expected at plan creation: 7 integration tests pass.

- [ ] **Step 2: Run Supervisor regression**

```bash
unset SUPERVISOR_INTEGRATION_DATABASE_URL
npm test --workspace apps/api -- --runInBand src/agent-supervisor
```

Expected at plan creation: 78 non-integration Supervisor tests pass, with integration tests skipped when the integration URL is absent.

- [ ] **Step 3: Run related API regression command**

```bash
npm test --workspace apps/api -- --runInBand \
  src/agent-supervisor src/agent-workflow src/engineering
```

Expected: no failures. Report the suites Jest actually discovers; do not imply coverage that was not executed.

- [ ] **Step 4: Run API build again from the final candidate**

```bash
DATABASE_URL="$DATABASE_URL" npm run build --workspace apps/api
```

Expected: exit 0.

- [ ] **Step 5: Prove the candidate worktree is clean**

```bash
git status --short
git rev-parse HEAD
```

Expected: clean except for an intentional unresolved merge simulation, if one was explicitly authorized and still open.

---

### Task 6: Production database readiness check — read-only until authorization

**Files:**
- No repository writes.

**Interfaces:**
- Consumes: Railway API configuration and migration database variable presence.
- Produces: a go/no-go database migration decision.

- [ ] **Step 1: Confirm Railway API has both database variable names**

Required variable names:

```text
DATABASE_URL
MIGRATION_DATABASE_URL
```

Expected at plan creation: both names are configured in Railway production. Secret values must not be copied into logs or documentation.

- [ ] **Step 2: Confirm current migration command remains explicit**

Repository command:

```text
npm run db:migrate --workspace apps/api
```

which resolves to Prisma `migrate deploy` using `MIGRATION_DATABASE_URL` when present.

- [ ] **Step 3: Do not change Railway pre-deploy yet**

Current production API pre-deploy command at plan creation:

```text
echo predeploy-disabled
```

Expected: leave unchanged until the user separately authorizes production migration behavior.

- [ ] **Step 4: Before any production write, inspect migration status with a read-only-approved method**

If Railway tooling exposes only mutating migration execution and no safe status query, stop and request explicit production migration authorization rather than probing production with write-capable commands.

---

### Task 7: Explicit user-controlled release gates

**Files:**
- No change until separately approved.

**Interfaces:**
- Consumes: all evidence from Tasks 1-6.
- Produces: separate authorization points; none can imply the next.

- [ ] **Gate A — Integration authorization**

Required explicit user approval before any merge/rebase/cherry-pick or persistent integration branch creation.

- [ ] **Gate B — Production migration authorization**

Required explicit user approval before running Prisma `migrate deploy` against production.

- [ ] **Gate C — Railway deployment authorization**

Required explicit user approval before changing Railway source/config or triggering redeploy.

- [ ] **Gate D — Post-deploy verification**

After an authorized deployment, verify health endpoint, Supervisor persistence endpoints, deployment status, logs, and database state before reporting success.

These gates are independent. Approval for one does not authorize another.
