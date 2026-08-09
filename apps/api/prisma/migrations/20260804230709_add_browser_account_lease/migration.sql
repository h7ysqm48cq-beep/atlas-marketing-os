-- CreateTable
CREATE TABLE "BrowserAccountLease" (
    "id" TEXT NOT NULL,
    "browserAccountId" TEXT NOT NULL,
    "leaseToken" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "channelId" TEXT,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserAccountLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrowserAccountLease_browserAccountId_key" ON "BrowserAccountLease"("browserAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserAccountLease_leaseToken_key" ON "BrowserAccountLease"("leaseToken");

-- CreateIndex
CREATE INDEX "BrowserAccountLease_ownerKey_idx" ON "BrowserAccountLease"("ownerKey");

-- CreateIndex
CREATE INDEX "BrowserAccountLease_channelId_idx" ON "BrowserAccountLease"("channelId");

-- CreateIndex
CREATE INDEX "BrowserAccountLease_expiresAt_idx" ON "BrowserAccountLease"("expiresAt");

-- CreateIndex
CREATE INDEX "BrowserAccountLease_releasedAt_idx" ON "BrowserAccountLease"("releasedAt");

-- AddForeignKey
ALTER TABLE "BrowserAccountLease" ADD CONSTRAINT "BrowserAccountLease_browserAccountId_fkey" FOREIGN KEY ("browserAccountId") REFERENCES "BrowserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
