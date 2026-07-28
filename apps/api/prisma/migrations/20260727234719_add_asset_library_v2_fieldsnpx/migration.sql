-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "collection" TEXT,
ADD COLUMN     "downloadCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "generationDurationMs" INTEGER,
ADD COLUMN     "generationModel" TEXT,
ADD COLUMN     "generationQuality" TEXT,
ADD COLUMN     "generationSize" TEXT,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "negativePrompt" TEXT,
ADD COLUMN     "revisedPrompt" TEXT,
ADD COLUMN     "storagePath" TEXT,
ADD COLUMN     "storageProvider" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "usedCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Asset_collection_idx" ON "Asset"("collection");

-- CreateIndex
CREATE INDEX "Asset_isFavorite_idx" ON "Asset"("isFavorite");
