CREATE TYPE "BrandMemoryFactType" AS ENUM (
  'PREFERENCE',
  'AVOIDANCE',
  'AUDIENCE',
  'VOICE',
  'VISUAL',
  'CONTENT',
  'PLATFORM',
  'WORKFLOW',
  'OTHER'
);

CREATE TYPE "BrandMemoryFactStatus" AS ENUM (
  'CANDIDATE',
  'CONFIRMED',
  'REJECTED'
);

CREATE TABLE "BrandMemoryFact" (
  "id" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "type" "BrandMemoryFactType" NOT NULL DEFAULT 'PREFERENCE',
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "description" TEXT,
  "confidence" INTEGER NOT NULL DEFAULT 80,
  "status" "BrandMemoryFactStatus" NOT NULL DEFAULT 'CANDIDATE',
  "sourceType" TEXT NOT NULL DEFAULT 'manual',
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),

  CONSTRAINT "BrandMemoryFact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BrandMemoryFact_brandId_idx"
ON "BrandMemoryFact"("brandId");

CREATE INDEX "BrandMemoryFact_brandId_status_idx"
ON "BrandMemoryFact"("brandId", "status");

CREATE INDEX "BrandMemoryFact_brandId_type_idx"
ON "BrandMemoryFact"("brandId", "type");

CREATE INDEX "BrandMemoryFact_updatedAt_idx"
ON "BrandMemoryFact"("updatedAt");

ALTER TABLE "BrandMemoryFact"
ADD CONSTRAINT "BrandMemoryFact_brandId_fkey"
FOREIGN KEY ("brandId")
REFERENCES "Brand"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
