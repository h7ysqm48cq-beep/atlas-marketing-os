-- CreateEnum
CREATE TYPE "BrowserActionType" AS ENUM ('PREPARE', 'PUBLISH', 'DISCARD');

-- CreateEnum
CREATE TYPE "BrowserActionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "BrowserActionHistory" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "action" "BrowserActionType" NOT NULL,
    "status" "BrowserActionStatus" NOT NULL DEFAULT 'PENDING',
    "browserProfileKey" TEXT,
    "caption" TEXT,
    "imagePath" TEXT,
    "screenshotPath" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrowserActionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrowserActionHistory_channelId_idx" ON "BrowserActionHistory"("channelId");

-- CreateIndex
CREATE INDEX "BrowserActionHistory_action_idx" ON "BrowserActionHistory"("action");

-- CreateIndex
CREATE INDEX "BrowserActionHistory_status_idx" ON "BrowserActionHistory"("status");

-- CreateIndex
CREATE INDEX "BrowserActionHistory_createdAt_idx" ON "BrowserActionHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "BrowserActionHistory" ADD CONSTRAINT "BrowserActionHistory_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "SocialChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
