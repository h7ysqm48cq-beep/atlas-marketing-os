ALTER TABLE "SupervisorExecution"
ADD COLUMN IF NOT EXISTS "runnerId" TEXT,
ADD COLUMN IF NOT EXISTS "claimEpoch" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "SupervisorExecution_status_createdAt_id_idx"
ON "SupervisorExecution"("status", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "SupervisorExecution_status_leaseExpiresAt_idx"
ON "SupervisorExecution"("status", "leaseExpiresAt");
