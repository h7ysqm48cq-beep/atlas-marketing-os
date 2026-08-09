/*
  Warnings:

  - A unique constraint covering the columns `[facebookEmailHash]` on the table `BrowserAccount` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "BrowserAccount" ADD COLUMN     "facebookEmailHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BrowserAccount_facebookEmailHash_key" ON "BrowserAccount"("facebookEmailHash");
