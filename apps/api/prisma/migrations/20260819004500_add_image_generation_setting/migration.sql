CREATE TABLE "ImageGenerationSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT,
    "channelId" TEXT,

    "textOverlayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "brandFooterEnabled" BOOLEAN NOT NULL DEFAULT true,

    "footerText" TEXT NOT NULL DEFAULT '满贯门 mgmbetmyr.com',
    "footerPosition" TEXT NOT NULL DEFAULT 'bottom-center',
    "footerStyle" TEXT NOT NULL DEFAULT 'minimal',

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageGenerationSetting_pkey"
        PRIMARY KEY ("id")
);

CREATE INDEX
    "ImageGenerationSetting_workspaceId_idx"
ON
    "ImageGenerationSetting"("workspaceId");

CREATE INDEX
    "ImageGenerationSetting_pageId_idx"
ON
    "ImageGenerationSetting"("pageId");

CREATE INDEX
    "ImageGenerationSetting_channelId_idx"
ON
    "ImageGenerationSetting"("channelId");

ALTER TABLE
    "ImageGenerationSetting"
ADD CONSTRAINT
    "ImageGenerationSetting_workspaceId_fkey"
FOREIGN KEY
    ("workspaceId")
REFERENCES
    "Workspace"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
