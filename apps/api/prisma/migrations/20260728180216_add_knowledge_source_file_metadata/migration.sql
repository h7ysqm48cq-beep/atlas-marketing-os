-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN     "sourceFileName" TEXT,
ADD COLUMN     "sourceFileSize" INTEGER,
ADD COLUMN     "sourceMimeType" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "storagePath" TEXT,
ADD COLUMN     "storageProvider" TEXT;
