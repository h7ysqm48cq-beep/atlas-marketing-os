ALTER TABLE "SportsNewsSetting"
ALTER COLUMN "requireSourceUrl" SET DEFAULT false,
ALTER COLUMN "logoSize" SET DEFAULT 'medium',
ALTER COLUMN "logoOpacity" SET DEFAULT 100,
ALTER COLUMN "logoOpacity" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "logoMargin" SET DEFAULT 10,
ALTER COLUMN "logoMargin" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "footerLogoEnabled" SET DEFAULT false,
ALTER COLUMN "footerPlacement" SET DEFAULT 'bottom',
ALTER COLUMN "newsAiModel" SET DEFAULT 'gpt-5.6-luna';

CREATE TABLE IF NOT EXISTS "EngineeringAudit" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "approvalState" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EngineeringAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EngineeringAudit_createdAt_idx"
ON "EngineeringAudit"("createdAt");

CREATE INDEX IF NOT EXISTS "EngineeringAudit_filePath_idx"
ON "EngineeringAudit"("filePath");

CREATE INDEX IF NOT EXISTS "SportsNewsSetting_telegramChannelId_idx"
ON "SportsNewsSetting"("telegramChannelId");

CREATE INDEX IF NOT EXISTS "SportsNewsSetting_facebookChannelId_idx"
ON "SportsNewsSetting"("facebookChannelId");
