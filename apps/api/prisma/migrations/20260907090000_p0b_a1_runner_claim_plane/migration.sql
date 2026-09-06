ALTER TABLE "SupervisorExecution"
  ADD COLUMN "claimedBy" TEXT,
  ADD COLUMN "claimEpoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);

CREATE INDEX "SupervisorExecution_status_leaseExpiresAt_createdAt_idx"
ON "SupervisorExecution"("status", "leaseExpiresAt", "createdAt");

CREATE UNIQUE INDEX "SupervisorExecution_one_active_per_runner"
ON "SupervisorExecution"("claimedBy")
WHERE "claimedBy" IS NOT NULL
  AND "status" IN ('DISPATCHED', 'RUNNING');
