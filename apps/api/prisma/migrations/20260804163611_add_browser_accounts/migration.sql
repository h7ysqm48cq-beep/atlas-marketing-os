-- CreateTable
CREATE TABLE "BrowserAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "brandId" TEXT,
    "platform" "SocialPlatform" NOT NULL DEFAULT 'FACEBOOK',
    "displayName" TEXT NOT NULL,
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
    "facebookUserId" TEXT,
    "facebookUserName" TEXT,
    "loginStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "cookieStatus" TEXT NOT NULL DEFAULT 'NOT_CREATED',
    "lastKnownIp" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastLoginError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrowserAccountChannel" (
    "id" TEXT NOT NULL,
    "browserAccountId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserAccountChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrowserAccount_browserProfileKey_key" ON "BrowserAccount"("browserProfileKey");

-- CreateIndex
CREATE INDEX "BrowserAccount_workspaceId_idx" ON "BrowserAccount"("workspaceId");

-- CreateIndex
CREATE INDEX "BrowserAccount_brandId_idx" ON "BrowserAccount"("brandId");

-- CreateIndex
CREATE INDEX "BrowserAccount_platform_idx" ON "BrowserAccount"("platform");

-- CreateIndex
CREATE INDEX "BrowserAccount_loginStatus_idx" ON "BrowserAccount"("loginStatus");

-- CreateIndex
CREATE INDEX "BrowserAccount_cookieStatus_idx" ON "BrowserAccount"("cookieStatus");

-- CreateIndex
CREATE INDEX "BrowserAccount_proxyType_idx" ON "BrowserAccount"("proxyType");

-- CreateIndex
CREATE INDEX "BrowserAccount_proxyCountry_idx" ON "BrowserAccount"("proxyCountry");

-- CreateIndex
CREATE INDEX "BrowserAccount_facebookUserId_idx" ON "BrowserAccount"("facebookUserId");

-- CreateIndex
CREATE INDEX "BrowserAccountChannel_browserAccountId_idx" ON "BrowserAccountChannel"("browserAccountId");

-- CreateIndex
CREATE INDEX "BrowserAccountChannel_channelId_idx" ON "BrowserAccountChannel"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserAccountChannel_browserAccountId_channelId_key" ON "BrowserAccountChannel"("browserAccountId", "channelId");

-- AddForeignKey
ALTER TABLE "BrowserAccountChannel" ADD CONSTRAINT "BrowserAccountChannel_browserAccountId_fkey" FOREIGN KEY ("browserAccountId") REFERENCES "BrowserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserAccountChannel" ADD CONSTRAINT "BrowserAccountChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "SocialChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
