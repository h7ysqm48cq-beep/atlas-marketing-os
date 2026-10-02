ALTER TABLE "ImageGenerationSetting"
ADD COLUMN IF NOT EXISTS "textOverlayText" TEXT NOT NULL DEFAULT '';
