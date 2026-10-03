# Web Live Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the two production Web behaviors that exist only on Railway's diverged live branch back onto canonical `production/atlas` without merging the stale branch history.

**Architecture:** Start from canonical `581d270c71b9ebf6250e3931163f1ae536f81900` on isolated branch `reconcile/web-live-fixes-20260903`. Re-implement only the net production behaviors proven by the live-only commits: Excel knowledge upload acceptance and explicit account switching. Preserve canonical code outside the six scoped Web files and use deterministic regression contracts plus Web lint/build verification.

**Tech Stack:** Next.js 16, React 19, Supabase SSR/Auth, Node `node:test`, ESLint, npm workspaces.

**Spec:** User-authorized P0B-4 Web reconciliation in this conversation; source live deployment `4e9bd661dd5b731ab74aaf642de3c3c8fefdaa63`, canonical base `581d270c71b9ebf6250e3931163f1ae536f81900`.

## Global Constraints

- Do not merge, rebase, squash, cherry-pick, auto-merge, force-push, or update `production/atlas`.
- Do not deploy or change any Railway configuration.
- Do not touch Browser Worker files.
- Do not copy temporary CI-only history from the old live branch into the final patch.
- Keep the final production scope limited to Web behavior required to preserve the current live fixes.
- Follow TDD: regression tests must fail on canonical before production code is added.

---

### Task 1: Excel Knowledge Upload Contract

**Files:**
- Modify: `apps/web/src/components/knowledge/KnowledgeLibrary.tsx`
- Create: `apps/web/tests/knowledge-upload-contract.spec.cjs`

**Interfaces:**
- Consumes: existing `uploadKnowledgeFile(file: File)` and hidden file input in `KnowledgeLibrary`.
- Produces: client-side acceptance of `.xlsx` and `.xls`, updated validation copy, file-input `accept` attribute, and upload-zone capability copy.

- [ ] **Step 1: Write the failing test**

Create a Node contract test that reads `KnowledgeLibrary.tsx` and asserts `.xlsx`, `.xls`, the file input accept list, and Excel capability copy are present.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/web/tests/knowledge-upload-contract.spec.cjs`
Expected: FAIL because canonical currently allows only PDF, DOCX, TXT, MD, and Markdown.

- [ ] **Step 3: Write minimal implementation**

Add `.xlsx` and `.xls` to `allowedExtensions`, update the unsupported-file message, add both extensions to the input `accept` attribute, and update the visible upload capability copy. Do not alter upload transport or size limits.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/web/tests/knowledge-upload-contract.spec.cjs`
Expected: PASS.

### Task 2: Explicit Account Switching

**Files:**
- Modify: `apps/web/src/proxy.ts`
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/components/UserMenu.tsx`
- Create: `apps/web/tests/auth-switch-account.spec.cjs`

**Interfaces:**
- Consumes: `/login`, Supabase browser client, existing authenticated-login redirect, existing UserMenu.
- Produces: `/login?switch=1` bypass of authenticated redirect, local browser-session sign-out before accepting new credentials, disabled login controls while switch preparation is active, and a `Switch account` menu link.

- [ ] **Step 1: Write the failing test**

Use the proven Node contract from live commit `7f7c19f549043e89ddcbc36f88bf6bf52b45a096` to assert the proxy route exception, `signOut({ scope: "local" })`, and UserMenu switch link.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/web/tests/auth-switch-account.spec.cjs`
Expected: FAIL because canonical redirects authenticated `/login` requests and exposes no explicit switch path.

- [ ] **Step 3: Write minimal implementation**

In `proxy.ts`, detect `/login?switch=1` and skip only the authenticated-login redirect for that explicit route. In `login/page.tsx`, initialize switch preparation safely, clear only the local Supabase session for `switch=1`, block login controls until that operation resolves, and surface errors. In `UserMenu.tsx`, add `/login?switch=1` as `Switch account`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/web/tests/auth-switch-account.spec.cjs`
Expected: PASS.

### Task 3: Web Verification and Cleanup

**Files:**
- Temporary: `.github/workflows/p0b4-web-reconciliation-test.yml`
- Verify: all files from Tasks 1 and 2.

**Interfaces:**
- Consumes: reconciled Web branch.
- Produces: fresh CI evidence for focused regression tests, ESLint, and Next.js production build.

- [ ] **Step 1: Run focused regression tests**

Run: `node --test apps/web/tests/auth-switch-account.spec.cjs apps/web/tests/knowledge-upload-contract.spec.cjs`
Expected: 2 tests PASS, 0 failures.

- [ ] **Step 2: Run focused lint**

Run: `npm run lint --workspace apps/web -- src/proxy.ts src/app/login/page.tsx src/components/UserMenu.tsx src/components/knowledge/KnowledgeLibrary.tsx`
Expected: exit 0.

- [ ] **Step 3: Run Web production build**

Run: `npm run build --workspace apps/web` with `NEXT_PUBLIC_API_URL=http://localhost:3001`, `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-key`.
Expected: exit 0.

- [ ] **Step 4: Remove temporary CI harness**

Delete only `.github/workflows/p0b4-web-reconciliation-test.yml` after GREEN verification. Keep the two regression tests as permanent coverage.

- [ ] **Step 5: Verify final diff**

Compare `581d270c...` to the reconciliation branch. Expected final production/test scope: `KnowledgeLibrary.tsx`, `proxy.ts`, `login/page.tsx`, `UserMenu.tsx`, `auth-switch-account.spec.cjs`, `knowledge-upload-contract.spec.cjs`, plus this plan document. No Railway or Browser Worker files.
