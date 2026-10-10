export type PromptKnowledgeSource = {
  index: number;
  documentId?: string;
  documentName?: string;
  chunkId?: string;
  score?: number;
  content?: string;
};

export type PromptAttachment = {
  id?: string;
  kind?: string;
  name?: string;
  url?: string;
  documentId?: string;
  storageProvider?: string;
  storagePath?: string;
};

export type PromptConversationMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type UnifiedPromptContext = {
  systemInstructions: string[];

  brandContext?: string;
  campaignContext?: string;
  memoryContext?: string;
  knowledgeContext?: string;
  attachmentContext?: string;

  conversationMessages: PromptConversationMessage[];
  latestUserMessage: string;
  attachments: PromptAttachment[];

  knowledgeSources: PromptKnowledgeSource[];
};

export type BuildUnifiedPromptContextInput = {
  brandId?: string;
  campaignId?: string;
  conversationId?: string;

  latestUserMessage: string;
  conversationMessages?: PromptConversationMessage[];
  attachments?: PromptAttachment[];

  brandContext?: string;
  campaignContext?: string;
  memoryContext?: string;
  knowledgeContext?: string;
  attachmentContext?: string;

  systemInstructions?: string[];
  knowledgeSources?: PromptKnowledgeSource[];
};
