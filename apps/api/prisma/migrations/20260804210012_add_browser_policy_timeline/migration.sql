-- CreateEnum
CREATE TYPE "BrowserAccountEventStatus" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'FAILED');

-- CreateTable
CREATE TABLE "BrowserAutomationPolicy" (
    "id" TEXT NOT NULL,
    "browserAccountId" TEXT NOT NULL,
    "autoVerifyLogin" BOOLEAN NOT NULL DEFAULT true,
    "autoDiscoverPages" BOOLEAN NOT NULL DEFAULT true,
    "autoSyncPages" BOOLEAN NOT NULL DEFAULT true,
    "autoHealthCheck" BOOLEAN NOT NULL DEFAULT true,
    "autoCloseBrowser" BOOLEAN NOT NULL DEFAULT false,
    "autoNotifications" BOOLEAN NOT NULL DEFAULT true,
    "keepBrowserOpenAfterLogin" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserAutomationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrowserAccountEvent" (
    "id" TEXT NOT NULL,
    "browserAccountId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "BrowserAccountEventStatus" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrowserAccountEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrowserAutomationPolicy_browserAccountId_key" ON "BrowserAutomationPolicy"("browserAccountId");

-- CreateIndex
CREATE INDEX "BrowserAccountEvent_browserAccountId_idx" ON "BrowserAccountEvent"("browserAccountId");

-- CreateIndex
CREATE INDEX "BrowserAccountEvent_eventType_idx" ON "BrowserAccountEvent"("eventType");

-- CreateIndex
CREATE INDEX "BrowserAccountEvent_status_idx" ON "BrowserAccountEvent"("status");

-- CreateIndex
CREATE INDEX "BrowserAccountEvent_createdAt_idx" ON "BrowserAccountEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "BrowserAutomationPolicy" ADD CONSTRAINT "BrowserAutomationPolicy_browserAccountId_fkey" FOREIGN KEY ("browserAccountId") REFERENCES "BrowserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserAccountEvent" ADD CONSTRAINT "BrowserAccountEvent_browserAccountId_fkey" FOREIGN KEY ("browserAccountId") REFERENCES "BrowserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
