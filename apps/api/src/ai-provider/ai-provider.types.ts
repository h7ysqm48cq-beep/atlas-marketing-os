export type AiProviderName =
  | 'openai'
  | 'google'
  | 'minimax';

export interface AiProviderPrompt {
  system: string;
  user: string;
}

export interface AiProviderOptions {
  model?: string;
  provider?: AiProviderName;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: 'text' | 'json';
}

export interface AiProviderRoutingMetadata {
  requestedProvider: AiProviderName;
  requestedModel: string;
  usedProvider: AiProviderName;
  usedModel: string;
  fallback: boolean;
  fallbackReason?: string;
}

export interface AiProviderResult {
  provider: AiProviderName;
  model: string;
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  durationMs: number;
  routing?: AiProviderRoutingMetadata;
}

export interface AiProvider {
  readonly name: AiProviderName;

  generate(
    prompt: AiProviderPrompt,
    options?: AiProviderOptions,
  ): Promise<AiProviderResult>;
}
