ALTER TABLE "SportsNewsSetting" ADD COLUMN IF NOT EXISTS "instagramEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SportsNewsSetting" ADD COLUMN IF NOT EXISTS "instagramChannelId" TEXT;
ALTER TABLE "SportsNewsSetting" ADD COLUMN IF NOT EXISTS "morningInstagramEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SportsNewsSetting" ADD COLUMN IF NOT EXISTS "eveningInstagramEnabled" BOOLEAN NOT NULL DEFAULT false;
DO $$
BEGIN
  ALTER TABLE "SportsNewsSetting" ADD CONSTRAINT "SportsNewsSetting_instagramChannelId_fkey" FOREIGN KEY ("instagramChannelId") REFERENCES "SocialChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "SportsNewsSetting_instagramChannelId_idx" ON "SportsNewsSetting"("instagramChannelId");
