ALTER TABLE "Brand"
ADD COLUMN "primaryLogoAssetId" TEXT,
ADD COLUMN "brandBannerAssetId" TEXT,
ADD COLUMN "mascotAssetId" TEXT,
ADD COLUMN "referenceAssetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
