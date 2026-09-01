# Shared Workspace Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Atlas use one explicit shared-workspace membership model so Xiaoen and Yushi can operate the same MGMBETMYR workspace without mixed or global tenant scope.

**Architecture:** Add `WorkspaceMember` and a single global `WorkspaceScopeService` that resolves the authenticated user’s default workspace. Route Brands, Automation, Campaigns, History, Image Settings, Sports News Settings and Browser Accounts through that resolver, and add workspace filters/guards to all reads and writes. Preserve all existing tenant data; production membership assignment is a separate data operation after code verification.

**Tech Stack:** NestJS, Prisma, PostgreSQL/Supabase, Jest

**Spec:** `docs/superpowers/specs/2026-09-02-shared-workspace-scope.md`

## Global Constraints

- No merge, rebase, squash, cherry-pick, auto-merge, force push, or production deployment without explicit authorization.
- Do not move, duplicate, or delete existing Knowledge, Assets, Channels, Scheduled Posts, History, or Campaigns in the code migration.
- Cross-workspace IDs must never fall back to another tenant.
- System/background context without an authenticated user must continue to use the `mgmbetmyr` workspace.
- Use TDD: failing regression first, then minimal implementation, then full API tests/build.

---

### Task 1: Membership-first workspace resolution

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260902010000_add_workspace_membership/migration.sql`
- Create: `apps/api/src/auth/workspace-scope.service.ts`
- Modify: `apps/api/src/auth/auth-context.module.ts`
- Modify/Test: `apps/api/src/brands/workspace-isolation.spec.ts`
- Modify: `apps/api/src/brands/brands.service.ts`

**Interfaces:**
- Produces: `WorkspaceScopeService.getCurrentWorkspace()` and `getCurrentWorkspaceId()`.
- Produces: `WorkspaceScopeService.requireWorkspaceAccess(workspaceId)`.

- [x] **Step 1: Write failing membership regression tests**

Add tests proving a user’s default `WorkspaceMember` wins over their legacy personal owner workspace and that a brand from a non-member workspace is rejected.

- [x] **Step 2: Run targeted test and verify RED**

Run: `npm test --workspace apps/api -- workspace-isolation.spec.ts --runInBand`
Expected: FAIL because current `BrandsService` only resolves `Workspace.ownerUserId`.

- [x] **Step 3: Add schema + migration**

Add `WorkspaceMember` with `workspaceId`, `userId`, `role`, `isDefault`, timestamps, unique `(workspaceId,userId)`, index `(userId,isDefault)`, and a partial unique SQL index allowing one default membership per user. Backfill current non-null `Workspace.ownerUserId` rows as default OWNER memberships.

- [x] **Step 4: Implement `WorkspaceScopeService`**

Resolve authenticated users in this order: default membership, any membership, legacy owner fallback with membership repair, then creation of a personal workspace + OWNER/default membership. Resolve unauthenticated system context to `mgmbetmyr`. `requireWorkspaceAccess()` must only accept a workspace that has a membership for the current user.

- [x] **Step 5: Route BrandsService through the resolver**

`list`, `getActiveBrand`, `create`, and `get(id)` must use the current workspace ID; `get(id)` must query `id + workspaceId` rather than nested owner-only conditions.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run the workspace isolation spec and Prisma generate/build.

### Task 2: Automation / Calendar scope

**Files:**
- Modify/Test: `apps/api/src/automation/automation.service.spec.ts`
- Modify: `apps/api/src/automation/automation.service.ts`

**Interfaces:**
- Consumes: `WorkspaceScopeService.getCurrentWorkspaceId()`.

- [ ] **Step 1: Write failing tests**

Add regressions that `listChannels`, `listCalendarPosts`, `listPosts`, `getSettings`, `getChannel`, `getPost`, channel creation/update/delete/test, and scheduled-post creation reject or filter data outside the current workspace.

- [ ] **Step 2: Verify RED**

Run only `automation.service.spec.ts`; expect failures because current queries are global.

- [ ] **Step 3: Implement minimal workspace filters/guards**

Filter channels by `workspaceId`; filter scheduled posts by `brand.workspaceId`; resolve settings by current workspace; make `ensureBrand`, `ensureChannel`, `getChannel`, `getPost`, create/update/delete/test operations require current workspace ownership.

- [ ] **Step 4: Verify GREEN**

Run automation tests.

### Task 3: Campaign and Generation History scope

**Files:**
- Modify/Test: `apps/api/src/campaigns/campaigns.service.spec.ts`
- Modify: `apps/api/src/campaigns/campaigns.service.ts`
- Create/Test: `apps/api/src/history/history.service.spec.ts`
- Modify: `apps/api/src/history/history.service.ts`

**Interfaces:**
- Consumes: `BrandsService.getActiveBrand()` or `WorkspaceScopeService.getCurrentWorkspaceId()`.

- [ ] **Step 1: Add failing cross-workspace tests**

Campaign/history list/get/update/delete must only operate on the active brand/current workspace.

- [ ] **Step 2: Verify RED**

Run targeted campaign/history tests.

- [ ] **Step 3: Scope implementations**

Campaign list/get must filter by current workspace brand; updates/deletes reuse scoped lookup. History list/get must filter by active brand; updates/deletes reuse scoped lookup.

- [ ] **Step 4: Verify GREEN**

Run targeted tests.

### Task 4: Image Settings scope

**Files:**
- Create/Test: `apps/api/src/image-settings/image-settings.service.spec.ts`
- Modify: `apps/api/src/image-settings/image-settings.service.ts`

**Interfaces:**
- Consumes: `WorkspaceScopeService.getCurrentWorkspaceId()`.

- [ ] **Step 1: Write failing test**

Prove settings use authenticated current workspace rather than most recently updated ACTIVE brand/oldest workspace.

- [ ] **Step 2: Verify RED**

Run targeted image-settings test.

- [ ] **Step 3: Replace ad-hoc workspace lookup**

Remove `getWorkspaceId()` global brand/workspace scan and use the shared resolver.

- [ ] **Step 4: Verify GREEN**

Run targeted test.

### Task 5: Sports News Settings and Browser Account scope

**Files:**
- Modify/Test: `apps/api/src/automation/sports-news-settings.service.spec.ts`
- Modify: `apps/api/src/automation/sports-news-settings.service.ts`
- Modify/Test: `apps/api/src/browser-runtime/services/browser-account.service.spec.ts`
- Modify: `apps/api/src/browser-runtime/services/browser-account.service.ts`

**Interfaces:**
- Consumes: `WorkspaceScopeService.getCurrentWorkspaceId()`.

- [ ] **Step 1: Write failing Sports News scope tests**

Prove settings/channels use the authenticated current workspace rather than the oldest database workspace, and selected channel IDs must belong to that workspace.

- [ ] **Step 2: Write failing Browser Account scope tests**

Prove list/get/create/update/page-sync cannot read or bind a Browser Account or Brand outside the current workspace. Client-supplied `workspaceId` must never override authenticated scope.

- [ ] **Step 3: Verify RED**

Run targeted sports settings and browser-account tests.

- [ ] **Step 4: Implement resolver-based scope**

Sports News Settings must use current workspace and validate selected channels within it. Browser Account reads/writes must force current workspace and validate every brand/channel relationship within it.

- [ ] **Step 5: Verify GREEN**

Run targeted tests.

### Task 6: Full verification and production-data handoff

**Files:**
- No production data mutation in source control.

- [ ] **Step 1: Run full API test suite**

Run: `npm test --workspace apps/api -- --runInBand`
Expected: all tests PASS.

- [ ] **Step 2: Run build**

Run: `npm run build --workspace apps/api`
Expected: PASS.

- [ ] **Step 3: Inspect branch diff**

Confirm only scoped schema/migration/service/tests/docs changed and no production branch was modified.

- [ ] **Step 4: Prepare production membership operation**

After deployment authorization, add Yushi as default MEMBER of the existing MGMBETMYR workspace, set Yushi’s empty personal workspace membership non-default, preserve Xiaoen OWNER/default membership, then verify both authenticated sessions see the same 20 Knowledge, 442 Assets, channels and calendar data.

- [ ] **Step 5: Defer cleanup**

Only after shared scope is verified, separately review hidden/duplicate channel cleanup; do not delete historical channels in this patch.

- [ ] **Step 6: Record remaining AI Usage scope gap**

`AiUsage` currently has no first-class `workspaceId`; do not fake tenant scoping. Treat its dashboard totals as a separate follow-up schema/backfill unless this patch is explicitly expanded.
