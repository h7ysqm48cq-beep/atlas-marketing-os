-- CreateTable
CREATE TABLE "EngineeringSnapshot" (
    "id" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "backupPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineeringSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngineeringSnapshot_createdAt_idx" ON "EngineeringSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "EngineeringSnapshot_status_idx" ON "EngineeringSnapshot"("status");

