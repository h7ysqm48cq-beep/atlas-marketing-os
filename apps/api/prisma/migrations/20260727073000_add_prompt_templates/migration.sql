CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PromptTemplate_brandId_idx"
ON "PromptTemplate"("brandId");

CREATE INDEX "PromptTemplate_brandId_category_idx"
ON "PromptTemplate"("brandId", "category");

CREATE INDEX "PromptTemplate_brandId_isFavorite_idx"
ON "PromptTemplate"("brandId", "isFavorite");

CREATE INDEX "PromptTemplate_updatedAt_idx"
ON "PromptTemplate"("updatedAt");

ALTER TABLE "PromptTemplate"
ADD CONSTRAINT "PromptTemplate_brandId_fkey"
FOREIGN KEY ("brandId")
REFERENCES "Brand"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
