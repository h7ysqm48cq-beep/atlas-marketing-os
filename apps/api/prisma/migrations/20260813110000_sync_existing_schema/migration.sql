-- Sync columns already existing in database

ALTER TABLE "Campaign"
ADD COLUMN IF NOT EXISTS "brandRenderingSettings" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "ScheduledPost"
ADD COLUMN IF NOT EXISTS "brandRenderingSettings" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "SportsNewsSetting"
ADD COLUMN IF NOT EXISTS "footerLogoAssetId" TEXT,
ADD COLUMN IF NOT EXISTS "footerLogoEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "footerPlacement" TEXT NOT NULL DEFAULT 'bottom-right',
ADD COLUMN IF NOT EXISTS "footerQrAssetId" TEXT,
ADD COLUMN IF NOT EXISTS "footerQrEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "footerQrLink" TEXT;
