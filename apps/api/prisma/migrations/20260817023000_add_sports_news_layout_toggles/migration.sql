ALTER TABLE "SportsNewsSetting"
ADD COLUMN "storyPanelEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "mastheadEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "headlineTextEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "footerTextEnabled" BOOLEAN NOT NULL DEFAULT true;
