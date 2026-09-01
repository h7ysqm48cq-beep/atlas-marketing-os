-- Persist immutable Engineering Copilot patch proposals before approval/apply.
CREATE TYPE "EngineeringPatchProposalStatus" AS ENUM (
  'DRAFT',
  'READY_FOR_REVIEW',
  'APPROVED',
  'APPLIED',
  'REJECTED',
  'STALE'
);

CREATE TABLE "EngineeringPatchProposal" (
  "id" TEXT NOT NULL,
  "request" TEXT NOT NULL,
  "status" "EngineeringPatchProposalStatus" NOT NULL DEFAULT 'READY_FOR_REVIEW',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "snapshotHash" TEXT NOT NULL,
  "patches" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "rejectedByUserId" TEXT,
  "appliedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "staleAt" TIMESTAMP(3),

  CONSTRAINT "EngineeringPatchProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EngineeringPatchProposal_status_createdAt_idx"
  ON "EngineeringPatchProposal"("status", "createdAt");

CREATE INDEX "EngineeringPatchProposal_createdByUserId_createdAt_idx"
  ON "EngineeringPatchProposal"("createdByUserId", "createdAt");

CREATE INDEX "EngineeringPatchProposal_snapshotHash_idx"
  ON "EngineeringPatchProposal"("snapshotHash");
