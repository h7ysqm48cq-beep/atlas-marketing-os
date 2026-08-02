CREATE TYPE "BackgroundJobStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED'
);

CREATE TYPE "BackgroundJobType" AS ENUM (
  'AI_STUDIO',
  'COPILOT_CHAT',
  'COPILOT_MARKETING_PLAN'
);

CREATE TABLE "BackgroundJob" (
  "id" TEXT NOT NULL,
  "type" "BackgroundJobType" NOT NULL,
  "status" "BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
  "payload" JSONB NOT NULL,
  "result" JSONB,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackgroundJob_type_status_createdAt_idx"
  ON "BackgroundJob"("type", "status", "createdAt");

CREATE INDEX "BackgroundJob_createdAt_idx"
  ON "BackgroundJob"("createdAt");
