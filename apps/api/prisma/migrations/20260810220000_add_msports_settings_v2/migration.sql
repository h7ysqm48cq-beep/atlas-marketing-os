ALTER TABLE "SportsNewsSetting"
ADD COLUMN "storyMinimum" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "storyMaximum" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "sportsPriority" TEXT NOT NULL DEFAULT 'football,basketball,formula1,badminton,tennis,baseball,motorsport',

ADD COLUMN "verificationInstructions" TEXT,
ADD COLUMN "imageHeadlineInstructions" TEXT,
ADD COLUMN "visibleCopyInstructions" TEXT,

ADD COLUMN "telegramMorningHeader" TEXT NOT NULL DEFAULT '⚡ 满贯门体育早报 | M-Sports Morning',
ADD COLUMN "telegramEveningHeader" TEXT NOT NULL DEFAULT '🌙 满贯门体育晚报 | M-Sports Evening',
ADD COLUMN "telegramSectionLabel" TEXT NOT NULL DEFAULT '🔥 今日焦点 | Top Stories',

ADD COLUMN "telegramCtaEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "telegramCtaText" TEXT NOT NULL DEFAULT '立即查看今日体育焦点，加入满贯门 / Follow today’s sports focus with 满贯门',
ADD COLUMN "telegramCtaUrl" TEXT NOT NULL DEFAULT 'https://rebrand.ly/mgmbetae0dcf',

ADD COLUMN "telegramShowSummaries" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "telegramCaptionTarget" INTEGER NOT NULL DEFAULT 940,

ADD COLUMN "telegramSummaryZhLong" INTEGER NOT NULL DEFAULT 72,
ADD COLUMN "telegramSummaryEnLong" INTEGER NOT NULL DEFAULT 112,
ADD COLUMN "telegramSummaryZhMedium" INTEGER NOT NULL DEFAULT 58,
ADD COLUMN "telegramSummaryEnMedium" INTEGER NOT NULL DEFAULT 88,
ADD COLUMN "telegramSummaryZhShort" INTEGER NOT NULL DEFAULT 46,
ADD COLUMN "telegramSummaryEnShort" INTEGER NOT NULL DEFAULT 68,
ADD COLUMN "telegramSummaryZhCompact" INTEGER NOT NULL DEFAULT 34,
ADD COLUMN "telegramSummaryEnCompact" INTEGER NOT NULL DEFAULT 52,

ADD COLUMN "visualDirectorEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "visualDirectorPrompt" TEXT,

ADD COLUMN "heroStoryWeight" INTEGER NOT NULL DEFAULT 65,

ADD COLUMN "singleSportVisualPrompt" TEXT,
ADD COLUMN "multiSportVisualPrompt" TEXT,

ADD COLUMN "completedEventVisualPrompt" TEXT,
ADD COLUMN "upcomingEventVisualPrompt" TEXT,
ADD COLUMN "developmentVisualPrompt" TEXT,

ADD COLUMN "morningVisualDirection" TEXT,
ADD COLUMN "eveningVisualDirection" TEXT,

ADD COLUMN "imagePhotographyPrompt" TEXT,
ADD COLUMN "imageNegativePrompt" TEXT,

ADD COLUMN "imageUpperSafeAreaPrompt" TEXT,
ADD COLUMN "imageLowerSafeAreaPrompt" TEXT,

ADD COLUMN "imageLayoutEnabled" BOOLEAN NOT NULL DEFAULT true,

ADD COLUMN "mastheadScale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN "mastheadTopPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.018,

ADD COLUMN "highlightsPanelWidthPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.89,
ADD COLUMN "highlightsPanelHeightPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.235,
ADD COLUMN "highlightsPanelTopPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.61,
ADD COLUMN "highlightsPanelOpacityStart" DOUBLE PRECISION NOT NULL DEFAULT 0.80,
ADD COLUMN "highlightsPanelOpacityMiddle" DOUBLE PRECISION NOT NULL DEFAULT 0.60,
ADD COLUMN "highlightsPanelOpacityEnd" DOUBLE PRECISION NOT NULL DEFAULT 0.22,
ADD COLUMN "highlightsPanelRadius" INTEGER NOT NULL DEFAULT 10,

ADD COLUMN "heroHeadlineScale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN "secondaryHeadlineScale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

ADD COLUMN "story02PositionPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.70,
ADD COLUMN "story03PositionPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.89,

ADD COLUMN "footerHeightPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.085,

ADD COLUMN "qrEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "qrLink" TEXT NOT NULL DEFAULT 'https://mgmbetmyr.com';

ALTER TABLE "SportsNewsSetting"
ADD COLUMN "mastheadBrandText" TEXT NOT NULL DEFAULT 'M-SPORTS',
ADD COLUMN "morningEditionZh" TEXT NOT NULL DEFAULT '满贯门体育早报',
ADD COLUMN "eveningEditionZh" TEXT NOT NULL DEFAULT '满贯门体育晚报',
ADD COLUMN "morningEditionEn" TEXT NOT NULL DEFAULT 'MORNING REPORT',
ADD COLUMN "eveningEditionEn" TEXT NOT NULL DEFAULT 'EVENING REPORT',
ADD COLUMN "imageSectionLabel" TEXT NOT NULL DEFAULT '今日焦点  /  TOP STORIES',

ADD COLUMN "morningAccentColor" TEXT NOT NULL DEFAULT '#f0c14b',
ADD COLUMN "eveningAccentColor" TEXT NOT NULL DEFAULT '#d7a449',
ADD COLUMN "morningSecondaryColor" TEXT NOT NULL DEFAULT '#1476d4',
ADD COLUMN "eveningSecondaryColor" TEXT NOT NULL DEFAULT '#b9232f',

ADD COLUMN "mastheadPrimaryColor" TEXT NOT NULL DEFAULT '#ffffff',
ADD COLUMN "mastheadEnglishColor" TEXT NOT NULL DEFAULT 'rgba(255,255,255,0.84)',
ADD COLUMN "headlinePrimaryColor" TEXT NOT NULL DEFAULT '#ffffff',
ADD COLUMN "headlineSecondaryColor" TEXT NOT NULL DEFAULT 'rgba(255,255,255,0.72)',
ADD COLUMN "panelBaseColor" TEXT NOT NULL DEFAULT '4,10,18',

ADD COLUMN "watermarkEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "watermarkScale" DOUBLE PRECISION NOT NULL DEFAULT 0.72,
ADD COLUMN "watermarkOpacity" DOUBLE PRECISION NOT NULL DEFAULT 0.72,
ADD COLUMN "watermarkPosition" TEXT NOT NULL DEFAULT 'top-right',

ADD COLUMN "qrSizePercent" DOUBLE PRECISION NOT NULL DEFAULT 0.105,
ADD COLUMN "qrMarginPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.025,

ADD COLUMN "footerDateEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "footerDateSeparator" TEXT NOT NULL DEFAULT '  •  ',
ADD COLUMN "footerBackgroundColor" TEXT NOT NULL DEFAULT 'rgba(8,12,20,0.95)',
ADD COLUMN "footerSeparatorColor" TEXT NOT NULL DEFAULT 'rgba(255,255,255,0.14)',

ADD COLUMN "imageGenerationSize" TEXT NOT NULL DEFAULT '1024x1536',
ADD COLUMN "imageGenerationQuality" TEXT NOT NULL DEFAULT 'medium',

ADD COLUMN "footballKeywords" TEXT NOT NULL DEFAULT 'football,soccer,premier league,champions league,carabao,efl,fa cup,laliga,serie a,bundesliga,superliga,allsvenskan,jdt,chelsea,liverpool,arsenal,manchester',
ADD COLUMN "basketballKeywords" TEXT NOT NULL DEFAULT 'nba,wnba,basketball,cba',
ADD COLUMN "motorsportKeywords" TEXT NOT NULL DEFAULT 'formula 1,formula one,f1,grand prix,motorsport',
ADD COLUMN "motorcycleKeywords" TEXT NOT NULL DEFAULT 'motogp,motorcycle,superbike',
ADD COLUMN "tennisKeywords" TEXT NOT NULL DEFAULT 'tennis,atp,wta,wimbledon',
ADD COLUMN "badmintonKeywords" TEXT NOT NULL DEFAULT 'badminton,bwf,thomas cup,sudirman',
ADD COLUMN "baseballKeywords" TEXT NOT NULL DEFAULT 'mlb,baseball,dodgers,yankees,red sox,astros,giants,padres,brewers,royals',
ADD COLUMN "combatKeywords" TEXT NOT NULL DEFAULT 'ufc,mma,boxing',

ADD COLUMN "completedScoreRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "invalidStoryPolicy" TEXT NOT NULL DEFAULT 'SKIP',
ADD COLUMN "morningSameDaySourcesOnly" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SportsNewsSetting"
ADD COLUMN "newsAiModel" TEXT NOT NULL DEFAULT 'gpt-5.5',
ADD COLUMN "newsWebSearchEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "imageAiModel" TEXT,
ADD COLUMN "imageGenerationEnabled" BOOLEAN NOT NULL DEFAULT true,

ADD COLUMN "duplicateEditionPolicy" TEXT NOT NULL DEFAULT 'SKIP',
ADD COLUMN "forceRunExistingPolicy" TEXT NOT NULL DEFAULT 'MARK_OLD',
ADD COLUMN "queueStatusOnCreate" TEXT NOT NULL DEFAULT 'QUEUED',

ADD COLUMN "publishRetryEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "publishRetryLimit" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "publishRetryDelayMinutes" INTEGER NOT NULL DEFAULT 10,

ADD COLUMN "generationFailurePolicy" TEXT NOT NULL DEFAULT 'BLOCK',
ADD COLUMN "imageFailurePolicy" TEXT NOT NULL DEFAULT 'BLOCK',
ADD COLUMN "brandingFailurePolicy" TEXT NOT NULL DEFAULT 'USE_GENERATED_IMAGE',

ADD COLUMN "minimumSourcesPerStory" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "minimumStoriesPerEdition" INTEGER NOT NULL DEFAULT 3,

ADD COLUMN "completedEventPolicy" TEXT NOT NULL DEFAULT 'REQUIRE_FINAL_SCORE',
ADD COLUMN "upcomingEventPolicy" TEXT NOT NULL DEFAULT 'ALLOW',
ADD COLUMN "developmentStoryPolicy" TEXT NOT NULL DEFAULT 'ALLOW',

ADD COLUMN "sourceDeduplicationEnabled" BOOLEAN NOT NULL DEFAULT true,

ADD COLUMN "imageRulesEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "imageRulesPrompt" TEXT,

ADD COLUMN "imageBrandRulesEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "imageBrandRulesPrompt" TEXT,

ADD COLUMN "forceRunEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "forceMorningEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "forceEveningEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SportsNewsSetting"
ADD COLUMN "morningPostTitleTemplate" TEXT NOT NULL DEFAULT '满贯门体育早报 | M-Sports Morning {date}',
ADD COLUMN "eveningPostTitleTemplate" TEXT NOT NULL DEFAULT '满贯门体育晚报 | M-Sports Evening {date}',
ADD COLUMN "imageModelOverrideEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "previewNewsPromptEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "previewImagePromptEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "previewTelegramCaptionEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "recommendedDefaultsVersion" TEXT NOT NULL DEFAULT 'v2';
