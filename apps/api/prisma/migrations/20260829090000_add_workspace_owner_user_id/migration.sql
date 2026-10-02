ALTER TABLE "Workspace"
ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_ownerUserId_key"
ON "Workspace"("ownerUserId");
