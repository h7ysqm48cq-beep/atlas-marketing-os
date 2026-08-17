ALTER TABLE "AiRuntimeSetting"
  ADD COLUMN IF NOT EXISTS "imageGenerationInstructions" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "imageNegativeInstructions" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "imageModelLogoEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "imageAtlasLogoOverlayEnabled" BOOLEAN NOT NULL DEFAULT true;
