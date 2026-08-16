ALTER TABLE "ScheduledPost"
ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "ScheduledPost_dedupeKey_key"
ON "ScheduledPost"("dedupeKey");
