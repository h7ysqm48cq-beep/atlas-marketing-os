import type {
  StructuredMarketingOutput,
} from '../prompt-builder/prompt-builder.types';
import type {
  ContentValidationResult,
} from '../content-validator/content-validator.types';

export interface GenerateContentInput {
  prompt: string;
  campaignId?: string;
  platforms?: string[];
  language?: string;
  style?: string;
  model?: string;
}

export interface ContentEngineResult {
  output: StructuredMarketingOutput;
  validation: ContentValidationResult;
  historyId: string | null;
  provider: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  durationMs: number;
}
