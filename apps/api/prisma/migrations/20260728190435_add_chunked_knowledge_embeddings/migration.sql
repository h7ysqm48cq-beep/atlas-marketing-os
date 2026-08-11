/*
  Warnings:

  - A unique constraint covering the columns `[documentId,chunkIndex]` on the table `KnowledgeEmbedding` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `chunkIndex` to the `KnowledgeEmbedding` table without a default value. This is not possible if the table is not empty.
  - Added the required column `chunkText` to the `KnowledgeEmbedding` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "KnowledgeEmbedding_documentId_key";

-- AlterTable
ALTER TABLE "KnowledgeEmbedding" ADD COLUMN     "chunkIndex" INTEGER NOT NULL,
ADD COLUMN     "chunkText" TEXT NOT NULL,
ADD COLUMN     "endOffset" INTEGER,
ADD COLUMN     "startOffset" INTEGER;

-- CreateIndex
CREATE INDEX "KnowledgeEmbedding_documentId_idx" ON "KnowledgeEmbedding"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEmbedding_documentId_chunkIndex_key" ON "KnowledgeEmbedding"("documentId", "chunkIndex");
