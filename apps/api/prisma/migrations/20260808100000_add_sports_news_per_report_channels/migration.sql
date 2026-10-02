ALTER TABLE "SportsNewsSetting"
ADD COLUMN "morningTelegramEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "morningFacebookEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "eveningTelegramEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "eveningFacebookEnabled" BOOLEAN NOT NULL DEFAULT false;
