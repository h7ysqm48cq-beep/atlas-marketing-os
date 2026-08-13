import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRuntimeSettingsService } from '../ai-runtime/ai-runtime-settings.service';
import OpenAI from 'openai';

export type ReviewableContent = {
  facebook: string;
  telegram: string;
  reels: string;
  image: string;
};

export type ContentQualityGate = {
  passed: boolean;
  revised: boolean;
  overallScore: number;
  brandFitScore: number;
  platformFitScore: number;
  clarityScore: number;
  engagementScore: number;
  safetyScore: number;
  issues: string[];
  improvements: string[];
  reviewer: 'AI' | 'FALLBACK';
};

export type ReviewedContent = {
  content: ReviewableContent;
  qualityGate: ContentQualityGate;
};

@Injectable()
export class ContentReviewService {
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

  async review(input: {
    topic: string;
    style: string;
    language: string;
    content: ReviewableContent;
    brandName: string;
    brandVoice: string;
    brandRules: string[];
    forbiddenWords: string[];
  }): Promise<ReviewedContent> {
    if (!this.client) {
      return this.fallback(input.content);
    }

    try {
      const response =
        await this.client.responses.create({
          model: await this.aiRuntime.getTextModel(),
          input: [
            'You are Atlas Quality Gate, a strict marketing content reviewer.',
            '',
            'Review the generated content package.',
            'Improve content only when necessary.',
            'Preserve the original intent and platform format.',
            'Do not introduce unsupported claims.',
            '',
            'REVIEW CRITERIA',
            '- Brand voice and brand-rule compliance',
            '- Natural language and clarity',
            '- Platform suitability',
            '- Discussion and engagement potential',
            '- Safety and forbidden-word compliance',
            '- Avoid excessive promotion or hard selling',
            '',
            `Topic: ${input.topic}`,
            `Style: ${input.style}`,
            `Language: ${input.language}`,
            `Brand: ${input.brandName}`,
            `Brand voice: ${input.brandVoice}`,
            '',
            'Brand rules:',
            input.brandRules.length
              ? input.brandRules
                  .map((rule) => `- ${rule}`)
                  .join('\n')
              : '- None configured',
            '',
            'Forbidden words or claims:',
            input.forbiddenWords.length
              ? input.forbiddenWords
                  .map((word) => `- ${word}`)
                  .join('\n')
              : '- None configured',
            '',
            'CONTENT PACKAGE',
            `Facebook:\n${input.content.facebook}`,
            '',
            `Telegram:\n${input.content.telegram}`,
            '',
            `Reels:\n${input.content.reels}`,
            '',
            `Image prompt:\n${input.content.image}`,
          ].join('\n'),
          text: {
            format: {
              type: 'json_schema',
              name: 'atlas_content_quality_gate',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  facebook: { type: 'string' },
                  telegram: { type: 'string' },
                  reels: { type: 'string' },
                  image: { type: 'string' },
                  passed: { type: 'boolean' },
                  revised: { type: 'boolean' },
                  overallScore: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 100,
                  },
                  brandFitScore: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 100,
                  },
                  platformFitScore: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 100,
                  },
                  clarityScore: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 100,
                  },
                  engagementScore: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 100,
                  },
                  safetyScore: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 100,
                  },
                  issues: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  improvements: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
                required: [
                  'facebook',
                  'telegram',
                  'reels',
                  'image',
                  'passed',
                  'revised',
                  'overallScore',
                  'brandFitScore',
                  'platformFitScore',
                  'clarityScore',
                  'engagementScore',
                  'safetyScore',
                  'issues',
                  'improvements',
                ],
              },
            },
          },
        });

      const result = JSON.parse(
        response.output_text,
      ) as ReviewableContent &
        Omit<ContentQualityGate, 'reviewer'>;

      return {
        content: {
          facebook: result.facebook,
          telegram: result.telegram,
          reels: result.reels,
          image: result.image,
        },
        qualityGate: {
          passed: result.passed,
          revised: result.revised,
          overallScore: this.normalizeScore(
            result.overallScore,
          ),
          brandFitScore: this.normalizeScore(
            result.brandFitScore,
          ),
          platformFitScore: this.normalizeScore(
            result.platformFitScore,
          ),
          clarityScore: this.normalizeScore(
            result.clarityScore,
          ),
          engagementScore: this.normalizeScore(
            result.engagementScore,
          ),
          safetyScore: this.normalizeScore(
            result.safetyScore,
          ),
          issues: result.issues,
          improvements: result.improvements,
          reviewer: 'AI',
        },
      };
    } catch {
      return this.fallback(input.content);
    }
  }

  private normalizeScore(value: number) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return 0;
    }

    const normalized =
      numeric >= 0 && numeric <= 10
        ? numeric * 10
        : numeric;

    return Math.round(
      Math.min(100, Math.max(0, normalized)),
    );
  }

  private fallback(
    content: ReviewableContent,
  ): ReviewedContent {
    return {
      content,
      qualityGate: {
        passed: true,
        revised: false,
        overallScore: 0,
        brandFitScore: 0,
        platformFitScore: 0,
        clarityScore: 0,
        engagementScore: 0,
        safetyScore: 0,
        issues: [],
        improvements: [],
        reviewer: 'FALLBACK',
      },
    };
  }
}
