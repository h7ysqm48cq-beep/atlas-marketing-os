ALTER TABLE "SupervisorExecution"
ADD COLUMN "runnerId" TEXT,
ADD COLUMN "claimEpoch" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "SupervisorExecution_status_createdAt_id_idx"
ON "SupervisorExecution"("status", "createdAt", "id");

CREATE INDEX "SupervisorExecution_status_leaseExpiresAt_idx"
ON "SupervisorExecution"("status", "leaseExpiresAt");
