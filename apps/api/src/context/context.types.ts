export interface BuildContextInput {
  prompt: string;
  campaignId?: string | null;
  platforms?: string[];
  language?: string;
  style?: string;
  knowledgeLimit?: number;
}

export interface RequestContext {
  prompt: string;
  campaignId: string | null;
  platforms: string[];
  language: string;
  style: string;
}

export interface BrandContext {
  id: string;
  name: string;
  country: string;
  primaryLanguage: string;
  targetAudience: string;
  brandVoice: string;
  visualStyle: string;
  contentGoals: string;
  keywords: string[];
  brandRules: string[];
  forbiddenWords: string[];
}

export interface MemoryFactContext {
  id: string;
  type: string;
  key: string;
  value: string;
  description: string | null;
  confidence: number;
  sourceType: string;
}

export interface MemoryContext {
  confirmedCount: number;
  facts: MemoryFactContext[];
}

export interface KnowledgeDocumentContext {
  id: string;
  title: string;
  category: string;
  tags: string[];
  relevanceScore: number;
  matchedTerms: string[];
  reasons: string[];
  updatedAt: Date;
}

export interface KnowledgeContext {
  matchedCount: number;
  documents: KnowledgeDocumentContext[];
}

export interface AIContext {
  request: RequestContext;
  brand: BrandContext;
  memory: MemoryContext;
  knowledge: KnowledgeContext;
  metadata: {
    version: string;
    createdAt: Date;
    sources: string[];
  };
}
