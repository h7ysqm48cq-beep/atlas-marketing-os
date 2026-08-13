CREATE TABLE "AiRuntimeSetting" (
    "id" TEXT NOT NULL,
    "textModel" TEXT NOT NULL DEFAULT 'gpt-5.6-luna',
    "imageModel" TEXT NOT NULL DEFAULT 'gpt-image-2',
    "embeddingModel" TEXT NOT NULL DEFAULT 'text-embedding-3-large',
    "sportsNewsModel" TEXT NOT NULL DEFAULT 'gpt-5.6-luna',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRuntimeSetting_pkey" PRIMARY KEY ("id")
);
