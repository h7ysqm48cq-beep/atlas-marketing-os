# ATLAS Auth Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect Atlas API routes with Supabase JWT authentication while preserving only explicitly public health, OAuth callback, and public-key endpoints.

**Architecture:** Browser requests use a same-origin Next.js catch-all route. The route validates the Supabase session from cookies and forwards the access token to the API. The Nest API validates the bearer token with Supabase/JWKS and applies a global guard with explicit `@Public()` exceptions.

**Tech Stack:** Next.js App Router, `@supabase/ssr`, NestJS global guard, `jose`, Jest.

**Spec:** User-confirmed “同源 Next.js API Proxy + Supabase JWT 校验”.

## Global Constraints

- Preserve the dirty checkout and unrelated changes.
- Do not merge, rebase, squash, cherry-pick, auto-merge, force-push, deploy, or alter Railway configuration.
- Keep health and OAuth callback routes explicitly public; fail closed when authentication configuration is missing.
- Do not expose access tokens to browser JavaScript or log them.

### Task 1: API authentication guard

**Files:**
- Create: `apps/api/src/auth/public.decorator.ts`
- Create: `apps/api/src/auth/supabase-auth.guard.ts`
- Create: `apps/api/src/auth/supabase-auth.guard.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: public controllers to add `@Public()` only to documented exceptions.

- [ ] Write failing tests for missing bearer rejection and public-route bypass.
- [ ] Run the focused Jest test and confirm it fails because the guard is absent.
- [ ] Implement token extraction, Supabase JWT verification, and global `APP_GUARD` registration.
- [ ] Mark `/`, `/system-health`, `/workflow/health`, `/automation/facebook/callback`, `/notifications/vapid-public-key`, and `/automation/browser-worker/health` public.
- [ ] Run the focused tests and API build.

### Task 2: Same-origin Next.js API proxy

**Files:**
- Create: `apps/web/src/app/api/atlas/[...path]/route.ts`
- Modify: `apps/web/src/lib/api.ts`

- [ ] Add a failing route/base-path test or type-checking fixture for same-origin API URL resolution.
- [ ] Implement authenticated cookie-to-bearer forwarding with raw body preservation for JSON, multipart, and binary requests.
- [ ] Return upstream status/body/headers without logging credentials.
- [ ] Make browser-side `API_URL` point to `/api/atlas`; keep server-side configuration for the upstream API target.
- [ ] Run the Web build and focused route checks.

### Task 3: Regression and release gate

**Files:**
- Modify only files required by failing tests or build output.

- [ ] Run API focused auth tests plus existing API regression suites.
- [ ] Run Web build and Browser Worker build/tests.
- [ ] Run `git diff --check` and inspect branch/status/diff.
- [ ] Verify production only through read-only health/status checks; do not deploy local changes.
