-- CreateTable
CREATE TABLE "CopilotConversationEmbedding" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "vector" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotConversationEmbedding_pkey"
        PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX
    "CopilotConversationEmbedding_conversationId_key"
ON "CopilotConversationEmbedding"("conversationId");

-- CreateIndex
CREATE INDEX
    "CopilotConversationEmbedding_brandId_idx"
ON "CopilotConversationEmbedding"("brandId");

-- CreateIndex
CREATE INDEX
    "CopilotConversationEmbedding_createdAt_idx"
ON "CopilotConversationEmbedding"("createdAt");

-- AddForeignKey
ALTER TABLE "CopilotConversationEmbedding"
ADD CONSTRAINT "CopilotConversationEmbedding_brandId_fkey"
FOREIGN KEY ("brandId")
REFERENCES "Brand"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotConversationEmbedding"
ADD CONSTRAINT "CopilotConversationEmbedding_conversationId_fkey"
FOREIGN KEY ("conversationId")
REFERENCES "CopilotConversation"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
