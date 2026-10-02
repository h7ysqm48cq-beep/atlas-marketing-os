-- CreateEnum
CREATE TYPE "AiUsageFeature" AS ENUM ('CONTENT_GENERATION', 'COPILOT_CHAT', 'COPILOT_MARKETING_PLAN', 'OTHER');

-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "feature" "AiUsageFeature" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "reasoningTokens" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "AiUsage_conversationId_idx" ON "AiUsage"("conversationId");

-- CreateIndex
CREATE INDEX "AiUsage_feature_idx" ON "AiUsage"("feature");
