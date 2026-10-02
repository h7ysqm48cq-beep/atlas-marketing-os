-- CreateTable
CREATE TABLE "SupervisorTask" (
    "id" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "allowedPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forbiddenActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dependsOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptance" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence" JSONB,
    "blockingReason" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupervisorTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisorExecution" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workerRole" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignment" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SupervisorExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisorFileLock" (
    "path" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisorFileLock_pkey" PRIMARY KEY ("path")
);

-- CreateIndex
CREATE INDEX "SupervisorTask_status_createdAt_idx" ON "SupervisorTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupervisorTask_owner_status_idx" ON "SupervisorTask"("owner", "status");

-- CreateIndex
CREATE INDEX "SupervisorExecution_taskId_createdAt_idx" ON "SupervisorExecution"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "SupervisorExecution_taskId_status_idx" ON "SupervisorExecution"("taskId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupervisorExecution_one_active_per_task"
ON "SupervisorExecution" ("taskId")
WHERE "status" IN ('QUEUED', 'DISPATCHED', 'RUNNING');

-- CreateIndex
CREATE INDEX "SupervisorFileLock_taskId_idx" ON "SupervisorFileLock"("taskId");

-- AddForeignKey
ALTER TABLE "SupervisorExecution"
ADD CONSTRAINT "SupervisorExecution_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "SupervisorTask"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisorFileLock"
ADD CONSTRAINT "SupervisorFileLock_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "SupervisorTask"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
