-- AlterTable
ALTER TABLE "BrowserActionHistory" ADD COLUMN     "flowId" TEXT;

-- CreateIndex
CREATE INDEX "BrowserActionHistory_flowId_idx" ON "BrowserActionHistory"("flowId");
