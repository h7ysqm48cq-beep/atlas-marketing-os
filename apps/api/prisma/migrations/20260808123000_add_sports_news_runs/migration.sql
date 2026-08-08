CREATE TABLE "SportsNewsRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "runKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "sourceCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedSourceCount" INTEGER NOT NULL DEFAULT 0,
  "scheduledPostIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SportsNewsRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SportsNewsRun_runKey_key" ON "SportsNewsRun"("runKey");
CREATE INDEX "SportsNewsRun_workspaceId_idx" ON "SportsNewsRun"("workspaceId");
CREATE INDEX "SportsNewsRun_kind_idx" ON "SportsNewsRun"("kind");
CREATE INDEX "SportsNewsRun_status_idx" ON "SportsNewsRun"("status");
CREATE INDEX "SportsNewsRun_startedAt_idx" ON "SportsNewsRun"("startedAt");
ALTER TABLE "SportsNewsRun" ADD CONSTRAINT "SportsNewsRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
