# Shared Workspace Scope Spec

## Problem

Atlas currently resolves authenticated users to separate `Workspace.ownerUserId` workspaces, while multiple legacy services still read global data. This creates mixed-scope pages: a user-scoped Brand can be combined with global Channels, Calendar posts, settings, history, campaigns, and image settings.

## Required behavior

- Xiaoen and Yushi must be able to belong to the same existing MGMBETMYR workspace and see/use the same workspace data.
- Workspace access must be explicit membership, not inferred from a single owner column.
- Every authenticated read/write for tenant data must resolve one current workspace and enforce it consistently.
- Existing MGMBETMYR data must remain in place. Do not duplicate or move Knowledge, Assets, Channels, Scheduled Posts, History, or Campaigns as part of the code migration.
- Existing `ownerUserId` remains for backwards compatibility during migration, but membership becomes the access-control source of truth.
- A user with no membership receives a personal workspace and owner membership.
- A user may have multiple memberships; exactly one default membership is used as the current workspace until a workspace switcher is introduced.
- System/background execution without an authenticated user continues to resolve the `mgmbetmyr` system workspace.
- Cross-workspace object IDs must return not-found/denied behavior; never fall back to another workspace.

## P0 scope targets

1. Brands / active brand resolution
2. Automation dashboard, channels, calendar posts, scheduled posts, automation settings, channel/post mutation guards
3. Campaign CRUD
4. Generation History CRUD
5. Image Generation Settings
6. Dashboard consistency via scoped dependencies

## Data migration boundary

The schema migration backfills existing `Workspace.ownerUserId` values into `WorkspaceMember` as default OWNER memberships. Production assignment of Yushi to the existing MGMBETMYR workspace is a separate explicit data operation after the code is verified; it must not hard-code user identifiers in repository migrations.

## Non-goals for this patch

- Deleting the empty Atlas workspace
- Deleting hidden/duplicate channels
- Rewriting historical rows
- Weakening Supabase authentication
- Building a multi-workspace switcher UI
- Merging or deploying without explicit authorization
