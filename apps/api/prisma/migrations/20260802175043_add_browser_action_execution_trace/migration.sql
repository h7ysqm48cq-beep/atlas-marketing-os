-- CreateEnum
CREATE TYPE "BrowserTraceStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "BrowserActionTrace" (
    "id" TEXT NOT NULL,
    "browserActionId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "status" "BrowserTraceStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "errorMessage" TEXT,
    "screenshotPath" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrowserActionTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrowserActionTrace_browserActionId_idx" ON "BrowserActionTrace"("browserActionId");

-- CreateIndex
CREATE INDEX "BrowserActionTrace_status_idx" ON "BrowserActionTrace"("status");

-- CreateIndex
CREATE INDEX "BrowserActionTrace_stepKey_idx" ON "BrowserActionTrace"("stepKey");

-- CreateIndex
CREATE INDEX "BrowserActionTrace_createdAt_idx" ON "BrowserActionTrace"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserActionTrace_browserActionId_stepOrder_key" ON "BrowserActionTrace"("browserActionId", "stepOrder");

-- AddForeignKey
ALTER TABLE "BrowserActionTrace" ADD CONSTRAINT "BrowserActionTrace_browserActionId_fkey" FOREIGN KEY ("browserActionId") REFERENCES "BrowserActionHistory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
