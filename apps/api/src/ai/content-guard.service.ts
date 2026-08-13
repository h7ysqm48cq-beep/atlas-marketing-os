import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRuntimeSettingsService } from '../ai-runtime/ai-runtime-settings.service';
import OpenAI from 'openai';
import type { ReviewableContent } from './content-review.service';

export type ContentGuardResult = {
  content: ReviewableContent;
  guard: {
    passed: boolean;
    revised: boolean;
    factualRiskScore: number;
    entityRiskScore: number;
    promotionalRiskScore: number;
    detectedIssues: string[];
    corrections: string[];
    reviewer: 'AI' | 'FALLBACK';
  };
};

@Injectable()
export class ContentGuardService {
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

  async guard(input: {
    topic: string;
    language: string;
    brandName: string;
    brandAliases: string[];
    forbiddenWords: string[];
    content: ReviewableContent;
  }): Promise<ContentGuardResult> {
    const deterministicIssues =
      this.detectDeterministicIssues(input);

    if (!this.client) {
      return {
        content: input.content,
        guard: {
          passed: deterministicIssues.length === 0,
          revised: false,
          factualRiskScore:
            deterministicIssues.length > 0 ? 60 : 0,
          entityRiskScore:
            deterministicIssues.length > 0 ? 80 : 0,
          promotionalRiskScore: 0,
          detectedIssues: deterministicIssues,
          corrections: [],
          reviewer: 'FALLBACK',
        },
      };
    }

    try {
      const response =
        await this.client.responses.create({
          model: await this.aiRuntime.getTextModel(),
          input: [
            'You are Atlas Factual and Entity Guard.',
            '',
            'Inspect the content package after editorial review.',
            'Correct factual, entity and brand-relationship errors.',
            'Return the complete corrected content package.',
            '',
            'STRICT ENTITY RULES',
            `- The brand is: ${input.brandName}`,
            `- Brand aliases: ${
              input.brandAliases.length
                ? input.brandAliases.join(', ')
                : 'None'
            }`,
            '- A brand name or alias must never be described as a historical event, football match, player, team, tournament, goal, championship or cultural tradition.',
            '- Use the brand only as a subtle signature, community name or restrained call to action.',
            '- Remove the brand completely when its placement creates factual confusion.',
            '',
            'FACTUAL RULES',
            '- Do not invent specific historical events, scores, players, years, quotes or records.',
            '- Keep unsupported statements general and experiential.',
            '- Do not imply official FIFA, World Cup, club or national-team affiliation.',
            '- Do not claim that an image contains an official logo unless explicitly provided.',
            '',
            'PROMOTIONAL RULES',
            '- Avoid hard selling, inducements and unsupported promises.',
            '- Do not introduce gambling claims or guaranteed outcomes.',
            '',
            'FORBIDDEN WORDS OR CLAIMS',
            input.forbiddenWords.length
              ? input.forbiddenWords
                  .map((word) => `- ${word}`)
                  .join('\n')
              : '- None configured',
            '',
            'DETERMINISTIC WARNINGS',
            deterministicIssues.length
              ? deterministicIssues
                  .map((issue) => `- ${issue}`)
                  .join('\n')
              : '- None detected',
            '',
            `Topic: ${input.topic}`,
            `Language: ${input.language}`,
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
              name: 'atlas_factual_entity_guard',
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
                  factualRiskScore: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 100,
                  },
                  entityRiskScore: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 100,
                  },
                  promotionalRiskScore: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 100,
                  },
                  detectedIssues: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  corrections: {
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
                  'factualRiskScore',
                  'entityRiskScore',
                  'promotionalRiskScore',
                  'detectedIssues',
                  'corrections',
                ],
              },
            },
          },
        });

      const parsed = JSON.parse(
        response.output_text,
      ) as ReviewableContent & {
        passed: boolean;
        revised: boolean;
        factualRiskScore: number;
        entityRiskScore: number;
        promotionalRiskScore: number;
        detectedIssues: string[];
        corrections: string[];
      };

      return {
        content: {
          facebook: parsed.facebook,
          telegram: parsed.telegram,
          reels: parsed.reels,
          image: parsed.image,
        },
        guard: {
          passed: parsed.passed,
          revised: parsed.revised,
          factualRiskScore: parsed.factualRiskScore,
          entityRiskScore: parsed.entityRiskScore,
          promotionalRiskScore:
            parsed.promotionalRiskScore,
          detectedIssues: Array.from(
            new Set([
              ...deterministicIssues,
              ...parsed.detectedIssues,
            ]),
          ),
          corrections: parsed.corrections,
          reviewer: 'AI',
        },
      };
    } catch {
      return {
        content: input.content,
        guard: {
          passed: deterministicIssues.length === 0,
          revised: false,
          factualRiskScore:
            deterministicIssues.length > 0 ? 60 : 0,
          entityRiskScore:
            deterministicIssues.length > 0 ? 80 : 0,
          promotionalRiskScore: 0,
          detectedIssues: deterministicIssues,
          corrections: [],
          reviewer: 'FALLBACK',
        },
      };
    }
  }

  private detectDeterministicIssues(input: {
    brandName: string;
    brandAliases: string[];
    forbiddenWords: string[];
    content: ReviewableContent;
  }) {
    const fullText = [
      input.content.facebook,
      input.content.telegram,
      input.content.reels,
      input.content.image,
    ].join('\n');

    const issues: string[] = [];

    const aliases = Array.from(
      new Set([
        input.brandName,
        ...input.brandAliases,
      ]),
    ).filter(Boolean);

    const entitySuffixes = [
      '事件',
      '比赛',
      '赛事',
      '球队',
      '球员',
      '冠军',
      '进球',
      '世界杯',
      '锦标赛',
      '传统',
      '历史',
    ];

    for (const alias of aliases) {
      for (const suffix of entitySuffixes) {
        if (
          fullText
            .toLowerCase()
            .includes(
              `${alias}${suffix}`.toLowerCase(),
            )
        ) {
          issues.push(
            `Possible brand entity misuse: "${alias}${suffix}"`,
          );
        }
      }
    }

    for (const forbidden of input.forbiddenWords) {
      if (
        forbidden.trim() &&
        fullText
          .toLowerCase()
          .includes(forbidden.trim().toLowerCase())
      ) {
        issues.push(
          `Forbidden wording detected: "${forbidden}"`,
        );
      }
    }

    return Array.from(new Set(issues));
  }
}
