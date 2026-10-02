-- CreateEnum
CREATE TYPE "SocialProxyType" AS ENUM ('DIRECT', 'HTTP', 'HTTPS', 'SOCKS5');

-- AlterTable
ALTER TABLE "GenerationHistory" ADD COLUMN     "socialChannelRuntimeProfileId" TEXT;

-- CreateTable
CREATE TABLE "SocialChannelRuntimeProfile" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "browserProfileKey" TEXT NOT NULL,
    "browserProfileName" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-MY',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
    "proxyType" "SocialProxyType" NOT NULL DEFAULT 'DIRECT',
    "proxyHost" TEXT,
    "proxyPort" INTEGER,
    "proxyUsernameEncrypted" TEXT,
    "proxyPasswordEncrypted" TEXT,
    "proxyCountry" TEXT,
    "lastKnownIp" TEXT,
    "lastConnectionStatus" TEXT,
    "lastConnectionError" TEXT,
    "lastConnectionTestAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialChannelRuntimeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialChannelRuntimeProfile_channelId_key" ON "SocialChannelRuntimeProfile"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialChannelRuntimeProfile_browserProfileKey_key" ON "SocialChannelRuntimeProfile"("browserProfileKey");

-- CreateIndex
CREATE INDEX "SocialChannelRuntimeProfile_proxyType_idx" ON "SocialChannelRuntimeProfile"("proxyType");

-- CreateIndex
CREATE INDEX "SocialChannelRuntimeProfile_proxyCountry_idx" ON "SocialChannelRuntimeProfile"("proxyCountry");

-- AddForeignKey
ALTER TABLE "GenerationHistory" ADD CONSTRAINT "GenerationHistory_socialChannelRuntimeProfileId_fkey" FOREIGN KEY ("socialChannelRuntimeProfileId") REFERENCES "SocialChannelRuntimeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialChannelRuntimeProfile" ADD CONSTRAINT "SocialChannelRuntimeProfile_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "SocialChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
