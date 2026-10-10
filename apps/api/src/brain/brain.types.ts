export enum AtlasIntent {
  CONTENT_GENERATION = 'CONTENT_GENERATION',
  IMAGE_GENERATION = 'IMAGE_GENERATION',
  CAMPAIGN_PLANNING = 'CAMPAIGN_PLANNING',
  PUBLISHING = 'PUBLISHING',
  SCHEDULING = 'SCHEDULING',
  ANALYSIS = 'ANALYSIS',
  RESEARCH = 'RESEARCH',
  KNOWLEDGE_QUERY = 'KNOWLEDGE_QUERY',
  GENERAL_ASSISTANCE = 'GENERAL_ASSISTANCE',
  UNKNOWN = 'UNKNOWN',
}

export type AtlasConfidence = 'low' | 'medium' | 'high';

export interface AtlasBrainInput {
  message: string;
  userId?: string;
  brandId?: string;
  conversationId?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
}

export interface AtlasIntentResult {
  intent: AtlasIntent;
  confidence: AtlasConfidence;
  reasons: string[];
  matchedSignals: string[];
}

export interface AtlasBrainContext {
  message: string;
  normalizedMessage: string;
  userId?: string;
  brandId?: string;
  conversationId?: string;
  locale: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AtlasPlanStep {
  id: string;
  order: number;
  action: string;
  description: string;
  required: boolean;
  status: 'pending' | 'ready' | 'blocked';
}

export interface AtlasExecutionPlan {
  intent: AtlasIntent;
  objective: string;
  needsClarification: boolean;
  clarificationQuestion?: string;
  steps: AtlasPlanStep[];
}

export interface AtlasBrainResult {
  requestId: string;
  intent: AtlasIntentResult;
  context: AtlasBrainContext;
  plan: AtlasExecutionPlan;
}
