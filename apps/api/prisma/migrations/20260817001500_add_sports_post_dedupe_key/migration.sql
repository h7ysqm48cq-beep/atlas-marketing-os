ALTER TABLE "ScheduledPost"
ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledPost_dedupeKey_key"
ON "ScheduledPost"("dedupeKey");
