-- AlterTable
ALTER TABLE "BrowserAccount" ADD COLUMN     "browserEngine" TEXT NOT NULL DEFAULT 'chromium',
ADD COLUMN     "colorScheme" TEXT NOT NULL DEFAULT 'light',
ADD COLUMN     "deviceMemory" INTEGER,
ADD COLUMN     "deviceScaleFactor" DOUBLE PRECISION NOT NULL DEFAULT 2,
ADD COLUMN     "expectedIp" TEXT,
ADD COLUMN     "facebookEmailEncrypted" TEXT,
ADD COLUMN     "facebookPasswordEncrypted" TEXT,
ADD COLUMN     "fingerprintStatus" TEXT NOT NULL DEFAULT 'LOCKED',
ADD COLUMN     "hardwareConcurrency" INTEGER,
ADD COLUMN     "identityError" TEXT,
ADD COLUMN     "identityLocked" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "identityVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "ipStatus" TEXT NOT NULL DEFAULT 'NOT_CHECKED',
ADD COLUMN     "lastIpCheckedAt" TIMESTAMP(3),
ADD COLUMN     "operatingSystem" TEXT NOT NULL DEFAULT 'macOS',
ADD COLUMN     "screenHeight" INTEGER NOT NULL DEFAULT 900,
ADD COLUMN     "screenWidth" INTEGER NOT NULL DEFAULT 1440,
ADD COLUMN     "userAgent" TEXT,
ADD COLUMN     "webglRenderer" TEXT,
ADD COLUMN     "webglVendor" TEXT;

-- CreateIndex
CREATE INDEX "BrowserAccount_ipStatus_idx" ON "BrowserAccount"("ipStatus");

-- CreateIndex
CREATE INDEX "BrowserAccount_fingerprintStatus_idx" ON "BrowserAccount"("fingerprintStatus");
