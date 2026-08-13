import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRuntimeSettingsService } from '../ai-runtime/ai-runtime-settings.service';
import OpenAI from 'openai';

export type QueryUnderstanding = {
  intent: string;
  contentType: string;
  audience: string;
  tone: string;
  industry: string;
  platform: string;
  language: string;
  concepts: string[];
  retrievalQueries: string[];
  expandedQuery: string;
  source: 'AI' | 'FALLBACK';
};

@Injectable()
export class QueryUnderstandingService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiRuntime: AiRuntimeSettingsService,
  ) {
    const apiKey =
      this.configService.get<string>('OPENAI_API_KEY');

    this.client = apiKey
      ? new OpenAI({ apiKey })
      : null;

  }

  async understand(input: {
    topic: string;
    platform?: string;
    style?: string;
    language?: string;
  }): Promise<QueryUnderstanding> {
    return this.fallback(input);
  }

  private fallback(input: {
    topic: string;
    platform?: string;
    style?: string;
    language?: string;
  }): QueryUnderstanding {
    const concepts = Array.from(
      new Set(
        [
          input.topic,
          input.platform,
          input.style,
          input.language,
        ]
          .filter((value): value is string =>
            Boolean(value?.trim()),
          )
          .flatMap((value) =>
            value
              .split(/[,，|/\n]+/)
              .map((item) => item.trim())
              .filter(Boolean),
          ),
      ),
    ).slice(0, 12);

    const result = {
      intent: 'Marketing content generation',
      contentType: 'Multi-platform content',
      audience: 'Brand target audience',
      tone: input.style || 'Brand default',
      industry: 'Brand industry',
      platform: input.platform || 'Multi-platform',
      language: input.language || 'Brand default',
      concepts,
    };

    return {
      ...result,
      retrievalQueries: this.buildFallbackQueries({
        topic: input.topic,
        platform: result.platform,
        tone: result.tone,
        language: result.language,
        audience: result.audience,
        industry: result.industry,
        concepts,
      }),
      expandedQuery: this.buildExpandedQuery({
        topic: input.topic,
        ...result,
      }),
      source: 'FALLBACK',
    };
  }

  private buildFallbackQueries(input: {
    topic: string;
    platform: string;
    tone: string;
    language: string;
    audience: string;
    industry: string;
    concepts: string[];
  }) {
    return Array.from(
      new Set(
        [
          input.topic,
          `${input.topic} ${input.platform}`,
          `${input.audience} ${input.tone}`,
          `${input.industry} ${input.platform}`,
          `${input.language} ${input.tone}`,
          ...input.concepts,
        ]
          .map((query) => query.trim())
          .filter(Boolean),
      ),
    ).slice(0, 6);
  }

  private buildExpandedQuery(input: {
    topic: string;
    intent: string;
    contentType: string;
    audience: string;
    tone: string;
    industry: string;
    platform: string;
    language: string;
    concepts: string[];
  }) {
    return [
      input.topic,
      input.intent,
      input.contentType,
      input.audience,
      input.tone,
      input.industry,
      input.platform,
      input.language,
      ...input.concepts,
    ]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ');
  }
}
