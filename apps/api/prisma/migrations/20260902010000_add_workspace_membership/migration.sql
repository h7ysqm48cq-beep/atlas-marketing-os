CREATE TABLE "WorkspaceMember" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key"
  ON "WorkspaceMember"("workspaceId", "userId");

CREATE INDEX "WorkspaceMember_userId_isDefault_idx"
  ON "WorkspaceMember"("userId", "isDefault");

CREATE INDEX "WorkspaceMember_workspaceId_idx"
  ON "WorkspaceMember"("workspaceId");

CREATE UNIQUE INDEX "WorkspaceMember_one_default_per_user"
  ON "WorkspaceMember"("userId")
  WHERE "isDefault" = true;

ALTER TABLE "WorkspaceMember"
  ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "WorkspaceMember" (
  "id",
  "workspaceId",
  "userId",
  "role",
  "isDefault",
  "createdAt",
  "updatedAt"
)
SELECT
  'wm_' || replace(gen_random_uuid()::text, '-', ''),
  "id",
  "ownerUserId",
  'OWNER',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Workspace"
WHERE "ownerUserId" IS NOT NULL
ON CONFLICT ("workspaceId", "userId") DO NOTHING;
