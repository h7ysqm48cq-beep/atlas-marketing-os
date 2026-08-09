CREATE TABLE "SportsNewsSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',

    "morningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "morningTime" TEXT NOT NULL DEFAULT '09:00',

    "eveningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "eveningTime" TEXT NOT NULL DEFAULT '20:00',

    "telegramEnabled" BOOLEAN NOT NULL DEFAULT true,
    "telegramChannelId" TEXT,

    "facebookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "facebookChannelId" TEXT,

    "morningTelegramEnabled" BOOLEAN NOT NULL DEFAULT true,
    "morningFacebookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "eveningTelegramEnabled" BOOLEAN NOT NULL DEFAULT true,
    "eveningFacebookEnabled" BOOLEAN NOT NULL DEFAULT false,

    "autoPublishEnabled" BOOLEAN NOT NULL DEFAULT true,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,

    "language" TEXT NOT NULL DEFAULT 'zh-en',

    "sportsKnowledgeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "discussionQuestionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "referenceLinksEnabled" BOOLEAN NOT NULL DEFAULT true,

    "sameDaySourcesOnly" BOOLEAN NOT NULL DEFAULT true,
    "maxSourceAgeHours" INTEGER NOT NULL DEFAULT 24,
    "requirePublishedAt" BOOLEAN NOT NULL DEFAULT true,
    "requireSourceUrl" BOOLEAN NOT NULL DEFAULT false,
    "minimumSources" INTEGER NOT NULL DEFAULT 2,
    "freshnessFallbackEnabled" BOOLEAN NOT NULL DEFAULT false,

    "customPromptEnabled" BOOLEAN NOT NULL DEFAULT false,
    "systemPrompt" TEXT,
    "morningPrompt" TEXT,
    "eveningPrompt" TEXT,
    "knowledgePrompt" TEXT,
    "customInstructions" TEXT,

    "imageEnabled" BOOLEAN NOT NULL DEFAULT true,
    "imagePrompt" TEXT,
    "morningImagePrompt" TEXT,
    "eveningImagePrompt" TEXT,
    "imageAspectRatio" TEXT NOT NULL DEFAULT '4:5',
    "imageTextMode" TEXT NOT NULL DEFAULT 'minimal',
    "imageVisualStyle" TEXT,

    "logoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "logoPosition" TEXT NOT NULL DEFAULT 'bottom-right',

    "brandFooterEnabled" BOOLEAN NOT NULL DEFAULT true,
    "brandFooterText" TEXT NOT NULL DEFAULT '满贯门 mgmbetmyr.com',

    "lastMorningRunAt" TIMESTAMP(3),
    "lastEveningRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastError" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SportsNewsSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX
"SportsNewsSetting_workspaceId_key"
ON "SportsNewsSetting"("workspaceId");

CREATE INDEX
"SportsNewsSetting_telegramChannelId_idx"
ON "SportsNewsSetting"("telegramChannelId");

CREATE INDEX
"SportsNewsSetting_facebookChannelId_idx"
ON "SportsNewsSetting"("facebookChannelId");

ALTER TABLE "SportsNewsSetting"
ADD CONSTRAINT "SportsNewsSetting_workspaceId_fkey"
FOREIGN KEY ("workspaceId")
REFERENCES "Workspace"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "SportsNewsSetting"
ADD CONSTRAINT "SportsNewsSetting_telegramChannelId_fkey"
FOREIGN KEY ("telegramChannelId")
REFERENCES "SocialChannel"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "SportsNewsSetting"
ADD CONSTRAINT "SportsNewsSetting_facebookChannelId_fkey"
FOREIGN KEY ("facebookChannelId")
REFERENCES "SocialChannel"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
