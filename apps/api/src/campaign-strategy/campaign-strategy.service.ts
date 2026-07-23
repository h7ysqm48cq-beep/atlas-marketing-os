import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { GenerateCampaignStrategyDto } from './dto/generate-campaign-strategy.dto';

type CampaignStrategy = {
  campaignSummary: string;
  objective: string;
  audienceStrategy: {
    primaryAudience: string;
    audienceInsight: string;
    motivation: string;
    barrier: string;
  };
  coreMessage: string;
  supportingMessages: string[];
  contentPillars: Array<{
    name: string;
    purpose: string;
    exampleTopics: string[];
  }>;
  platformStrategy: Array<{
    platform: string;
    role: string;
    contentFormat: string;
    frequency: string;
    recommendation: string;
  }>;
  contentMix: Array<{
    category: string;
    percentage: number;
    purpose: string;
  }>;
  callsToAction: string[];
  postingRecommendations: Array<{
    platform: string;
    recommendedTime: string;
    rationale: string;
  }>;
  successMetrics: Array<{
    metric: string;
    targetDirection: string;
    reason: string;
  }>;
  risks: Array<{
    risk: string;
    mitigation: string;
  }>;
  nextActions: string[];
};

@Injectable()
export class CampaignStrategyService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly brandsService: BrandsService,
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async generate(dto: GenerateCampaignStrategyDto) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured in apps/api/.env',
      );
    }

    const brand = await this.brandsService.getActiveBrand();

    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id: dto.campaignId,
        brandId: brand.id,
      },
      include: {
        ideas: {
          orderBy: { sortOrder: 'asc' },
          take: 20,
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException(
        'Campaign was not found for the active brand.',
      );
    }

    const memory = await this.memoryService.summary();

    const durationDays = dto.durationDays || 30;
    const platforms =
      dto.platforms?.length
        ? dto.platforms
        : ['Facebook', 'Telegram', 'Reels'];

    const prompt = [
      'You are Atlas, a senior marketing strategist.',
      'Create a practical campaign strategy for a Malaysian audience.',
      '',
      'CAMPAIGN',
      `Name: ${campaign.name}`,
      `Description: ${campaign.description || 'Not configured'}`,
      `Objective: ${dto.objective || campaign.objective || 'Increase engagement and brand awareness'}`,
      `Status: ${campaign.status}`,
      `Duration: ${durationDays} days`,
      `Platforms: ${platforms.join(', ')}`,
      `Requested style: ${dto.style || 'Follow Brand Brain'}`,
      `Requested language: ${dto.language || brand.primaryLanguage}`,
      '',
      'BRAND BRAIN',
      `Brand: ${brand.name}`,
      `Industry: ${brand.industry || 'Not configured'}`,
      `Country: ${brand.country}`,
      `Audience: ${dto.targetAudience || brand.targetAudience}`,
      `Voice: ${brand.brandVoice}`,
      `Visual style: ${brand.visualStyle}`,
      `Content goals: ${brand.contentGoals}`,
      `Brand rules: ${brand.brandRules.join(' | ') || 'None'}`,
      `Preferred CTAs: ${brand.callsToAction.join(' | ') || 'None'}`,
      `Keywords: ${brand.keywords.join(' | ') || 'None'}`,
      `Forbidden claims: ${brand.forbiddenWords.join(' | ') || 'None'}`,
      '',
      'ATLAS MEMORY',
      `Learning sample: ${memory.learningSampleSize}`,
      `Preferred style: ${memory.preferredStyle || 'Not learned'}`,
      `Preferred language: ${memory.preferredLanguage || 'Not learned'}`,
      `Best platform: ${memory.bestPlatform || 'Not learned'}`,
      `Best posting time: ${memory.bestPostingTime || 'Not learned'}`,
      `Average viral score: ${memory.averageScores.viral}`,
      `Average discussion score: ${memory.averageScores.discussion}`,
      `Average shareability score: ${memory.averageScores.shareability}`,
      `Average brand fit: ${memory.averageScores.brandFit}`,
      '',
      'EXISTING CAMPAIGN IDEAS',
      campaign.ideas.length
        ? campaign.ideas
            .map((idea, index) => `${index + 1}. ${idea.title}`)
            .join('\n')
        : 'No existing ideas.',
      '',
      'STRATEGY REQUIREMENTS',
      `1. Build a coherent ${durationDays}-day campaign strategy.`,
      '2. Make every recommendation suitable for Malaysia.',
      '3. Avoid invented performance statistics or guaranteed outcomes.',
      '4. Use percentages in contentMix that total exactly 100.',
      '5. Provide 4 to 6 content pillars.',
      '6. Include one platform strategy entry for every requested platform.',
      '7. Recommendations must be practical and implementation-ready.',
      '8. Use Memory as guidance, but prioritise the current campaign objective.',
      '9. Return only JSON matching the required schema.',
    ].join('\n');

    const model =
      this.configService.get<string>('OPENAI_MODEL') || 'gpt-4.1-mini';

    try {
      const response = await this.client.responses.create({
        model,
        input: prompt,
        text: {
          format: {
            type: 'json_schema',
            name: 'atlas_campaign_strategy',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                campaignSummary: { type: 'string' },
                objective: { type: 'string' },
                audienceStrategy: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    primaryAudience: { type: 'string' },
                    audienceInsight: { type: 'string' },
                    motivation: { type: 'string' },
                    barrier: { type: 'string' },
                  },
                  required: [
                    'primaryAudience',
                    'audienceInsight',
                    'motivation',
                    'barrier',
                  ],
                },
                coreMessage: { type: 'string' },
                supportingMessages: {
                  type: 'array',
                  items: { type: 'string' },
                },
                contentPillars: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      name: { type: 'string' },
                      purpose: { type: 'string' },
                      exampleTopics: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                    },
                    required: ['name', 'purpose', 'exampleTopics'],
                  },
                },
                platformStrategy: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      platform: { type: 'string' },
                      role: { type: 'string' },
                      contentFormat: { type: 'string' },
                      frequency: { type: 'string' },
                      recommendation: { type: 'string' },
                    },
                    required: [
                      'platform',
                      'role',
                      'contentFormat',
                      'frequency',
                      'recommendation',
                    ],
                  },
                },
                contentMix: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      category: { type: 'string' },
                      percentage: {
                        type: 'integer',
                        minimum: 0,
                        maximum: 100,
                      },
                      purpose: { type: 'string' },
                    },
                    required: ['category', 'percentage', 'purpose'],
                  },
                },
                callsToAction: {
                  type: 'array',
                  items: { type: 'string' },
                },
                postingRecommendations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      platform: { type: 'string' },
                      recommendedTime: { type: 'string' },
                      rationale: { type: 'string' },
                    },
                    required: [
                      'platform',
                      'recommendedTime',
                      'rationale',
                    ],
                  },
                },
                successMetrics: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      metric: { type: 'string' },
                      targetDirection: { type: 'string' },
                      reason: { type: 'string' },
                    },
                    required: ['metric', 'targetDirection', 'reason'],
                  },
                },
                risks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      risk: { type: 'string' },
                      mitigation: { type: 'string' },
                    },
                    required: ['risk', 'mitigation'],
                  },
                },
                nextActions: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: [
                'campaignSummary',
                'objective',
                'audienceStrategy',
                'coreMessage',
                'supportingMessages',
                'contentPillars',
                'platformStrategy',
                'contentMix',
                'callsToAction',
                'postingRecommendations',
                'successMetrics',
                'risks',
                'nextActions',
              ],
            },
          },
        },
      });

      const strategy = JSON.parse(
        response.output_text,
      ) as CampaignStrategy;

      return {
        campaign: {
          id: campaign.id,
          name: campaign.name,
        },
        brand: {
          id: brand.id,
          name: brand.name,
        },
        durationDays,
        platforms,
        memoryUsed: {
          learningSampleSize: memory.learningSampleSize,
          preferredStyle: memory.preferredStyle,
          bestPlatform: memory.bestPlatform,
          bestPostingTime: memory.bestPostingTime,
          confidence: memory.confidence,
        },
        strategy,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown campaign strategy error';

      throw new InternalServerErrorException(
        `Campaign strategy generation failed: ${message}`,
      );
    }
  }
}
