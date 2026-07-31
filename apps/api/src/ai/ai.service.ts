import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { HistoryService } from '../history/history.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { MemoryFactsService } from '../memory/memory-facts.service';
import { PromptChainService } from '../prompt-chain/prompt-chain.service';
import { GenerateContentDto } from './dto/generate-content.dto';
import type { TopicSuggestionsDto } from './dto/topic-suggestions.dto';
import { PromptBuilderService } from './prompt-builder.service';
import { ContentQualityService } from './content-quality.service';
import { AssetContextService } from './asset-context.service';
import {
  MarketingThinkingResult,
  MarketingThinkingService,
} from '../brain/marketing-thinking.service';

type GeneratedContent = {
  facebook: string;
  telegram: string;
  reels: string;
  image: string;
  analysis: {
    summary: string;
    viralScore: number;
    discussionScore: number;
    shareabilityScore: number;
    brandFitScore: number;
    bestPostingTime: string;
  };
};

type GeneratedOutputs = GeneratedContent & {
  brandUsed: {
    id: string;
    name: string;
    workspaceName: string;
  };
  campaignUsed?: {
    id: string;
    name: string;
  };
  ideaUsed?: {
    id: string;
    title: string;
  };
  historyId: string;
  factualGuard: {
    passed: boolean;
    revised: boolean;
    factualRiskScore: number;
    entityRiskScore: number;
    promotionalRiskScore: number;
    detectedIssues: string[];
    corrections: string[];
    reviewer: 'AI' | 'FALLBACK';
  };
  qualityGate: {
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
  marketingThinking: MarketingThinkingResult;
  promptChain: {
    loadedSourceCount: number;
    totalSourceCount: number;
    sources: Array<{
      key: string;
      label: string;
      loaded: boolean;
      summary: string;
    }>;
    queryUnderstanding: {
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
    knowledgeUsed: Array<{
      id: string;
      title: string;
      category: string;
      tags: string[];
      summary: string;
      similarity: number;
      similarityPercent: number;
      hybridScore: number;
      scoreBreakdown: {
        semantic: number;
        keyword: number;
        usage: number;
        freshness: number;
        quality: number;
      };
      matchedTerms: string[];
      matchedQueries: string[];
      reasons: string[];
      embeddingModel: string;
      embeddingDimensions: number;
      embeddedAt: Date;
    }>;
    mergedPrompt: string;
  };
};

@Injectable()
export class AiService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly brandsService: BrandsService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly contentQualityService: ContentQualityService,
    private readonly promptChainService: PromptChainService,
    private readonly historyService: HistoryService,
    private readonly knowledgeService: KnowledgeService,
    private readonly memoryFacts: MemoryFactsService,
    private readonly assetContextService: AssetContextService,
    private readonly marketingThinkingService: MarketingThinkingService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async generate(dto: GenerateContentDto): Promise<GeneratedOutputs> {
    console.time('[AI] total');
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured in apps/api/.env',
      );
    }

    const brand = await this.brandsService.getActiveBrand();
    const context = await this.resolveCampaignContext(dto, brand.id);

    const assetContext = await this.assetContextService.resolve({
      brand,
      selectedAssetIds: dto.assetIds,
    });

    console.time('[AI] prompt-chain');
    const promptChain = await this.promptChainService.preview({
      topic: dto.topic,
      platform: dto.platforms.join(', '),
      style: dto.style,
      language: dto.language,
      campaignId: dto.campaignId,
    });
    console.timeEnd('[AI] prompt-chain');

    const marketingThinking = this.marketingThinkingService.think({
      topic: dto.topic,
      platforms: dto.platforms,
      style: dto.style,
      language: dto.language,
      brandName: brand.name,
      targetAudience: brand.targetAudience,
      brandVoice: brand.brandVoice,
      visualStyle: brand.visualStyle,
      contentGoals: brand.contentGoals,
      callsToAction: brand.callsToAction,
      keywords: brand.keywords,
      forbiddenWords: brand.forbiddenWords,
      brandRules: brand.brandRules,
      campaign: context.campaign
        ? {
            name: context.campaign.name,
            objective: context.campaign.objective,
          }
        : null,
      memory: {
        preferredStyle: promptChain.queryUnderstanding.tone || dto.style,
        bestPlatform:
          promptChain.queryUnderstanding.platform || dto.platforms[0] || null,
        bestPostingTime: null,
        recommendations: [],
      },
    });

    const outputContract = this.promptBuilder.build(dto, brand);

    const confirmedMemoryContext = await this.memoryFacts
      .confirmedPromptContext()
      .catch(() =>
        [
          'ELENA CONFIRMED MEMORY',
          '- Confirmed memory could not be loaded.',
        ].join('\\n'),
      );

    const model = this.selectModel(dto);

    console.log(`[AI] model: ${model}`);

    const selectedPlatforms = new Set(
      dto.platforms.map((platform) => platform.trim().toLowerCase()),
    );

    const wantsFacebook = selectedPlatforms.has('facebook');

    const wantsTelegram = selectedPlatforms.has('telegram');

    const wantsReels =
      selectedPlatforms.has('reels') || selectedPlatforms.has('reel');

    const wantsImage =
      selectedPlatforms.has('image prompt') ||
      selectedPlatforms.has('image') ||
      selectedPlatforms.has('visual');

    const selectedOutputInstruction = [
      '',
      'SELECTED PLATFORM OUTPUTS',
      wantsFacebook
        ? '- Generate Facebook content.'
        : '- Return facebook as an empty string.',
      wantsTelegram
        ? '- Generate Telegram content.'
        : '- Return telegram as an empty string.',
      wantsReels
        ? '- Generate Reels content.'
        : '- Return reels as an empty string.',
      wantsImage
        ? '- Generate the image prompt.'
        : '- Return image as an empty string.',
      '- Always generate the analysis object.',
      '- Do not create content for unselected platforms.',
    ].join('\n');

    const compactMergedPrompt = this.compressPromptChainPrompt(
      promptChain.mergedPrompt,
    );

    console.log(
      `[AI] prompt-size: ${promptChain.mergedPrompt.length} -> ${compactMergedPrompt.length} chars`,
    );

    const prompt = [
      compactMergedPrompt,
      '',
      'ELENA CONFIRMED LONG-TERM MEMORY',
      confirmedMemoryContext,
      '',
      'MEMORY USAGE RULES',
      '- Use only confirmed memory.',
      '- The current explicit user request has highest priority.',
      '- Brand Brain rules and forbidden words remain mandatory.',
      '- Treat memory as reusable preference guidance.',
      '- Never expose internal memory records to the user.',
      '',
      assetContext.promptContext,
      '',
      marketingThinking.promptContext,
      '',
      'ATLAS OUTPUT CONTRACT',
      outputContract,
      selectedOutputInstruction,
    ]
      .filter(Boolean)
      .join('\n');

    const generationInput = this.assetContextService.buildVisionInput(
      prompt,
      assetContext.assets,
    );

    const requestStartedAt = Date.now();

    try {
      console.time('[AI] generation');
      const createGeneration = () =>
        this.client!.responses.create({
          model,
          input: generationInput,
          text: {
            format: {
              type: 'json_schema',
              name: 'atlas_content_package',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  facebook: wantsFacebook
                    ? { type: 'string' }
                    : {
                        type: 'string',
                        enum: [''],
                      },
                  telegram: wantsTelegram
                    ? { type: 'string' }
                    : {
                        type: 'string',
                        enum: [''],
                      },
                  reels: wantsReels
                    ? { type: 'string' }
                    : {
                        type: 'string',
                        enum: [''],
                      },
                  image: wantsImage
                    ? { type: 'string' }
                    : {
                        type: 'string',
                        enum: [''],
                      },
                  analysis: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      summary: { type: 'string' },
                      viralScore: {
                        type: 'integer',
                        minimum: 0,
                        maximum: 100,
                      },
                      discussionScore: {
                        type: 'integer',
                        minimum: 0,
                        maximum: 100,
                      },
                      shareabilityScore: {
                        type: 'integer',
                        minimum: 0,
                        maximum: 100,
                      },
                      brandFitScore: {
                        type: 'integer',
                        minimum: 0,
                        maximum: 100,
                      },
                      bestPostingTime: { type: 'string' },
                    },
                    required: [
                      'summary',
                      'viralScore',
                      'discussionScore',
                      'shareabilityScore',
                      'brandFitScore',
                      'bestPostingTime',
                    ],
                  },
                },
                required: [
                  'facebook',
                  'telegram',
                  'reels',
                  'image',
                  'analysis',
                ],
              },
            },
          },
        });

      const withTimeout = async <T>(
        operation: Promise<T>,
        timeoutMs: number,
      ): Promise<T> => {
        let timeout: NodeJS.Timeout | undefined;

        try {
          return await Promise.race([
            operation,
            new Promise<T>((_, reject) => {
              timeout = setTimeout(
                () =>
                  reject(
                    new Error(`Generation timed out after ${timeoutMs}ms`),
                  ),
                timeoutMs,
              );
            }),
          ]);
        } finally {
          if (timeout) {
            clearTimeout(timeout);
          }
        }
      };

      let response;

      try {
        response = await withTimeout(createGeneration(), 30000);
      } catch (firstError) {
        console.warn(
          '[AI] generation retry:',
          firstError instanceof Error ? firstError.message : 'Unknown error',
        );

        response = await withTimeout(createGeneration(), 30000);
      }

      console.timeEnd('[AI] generation');

      const generated = JSON.parse(response.output_text) as GeneratedContent;

      console.time('[AI] unified-quality');

      const inspected = await this.contentQualityService.inspect({
        topic: dto.topic,
        style: dto.style,
        language: dto.language,
        brandName: brand.name,
        brandAliases: [brand.name, 'MGMBETMYR', 'MGM', '满贯门'],
        brandVoice: brand.brandVoice,
        brandRules: brand.brandRules,
        forbiddenWords: brand.forbiddenWords,
        content: {
          facebook: generated.facebook,
          telegram: generated.telegram,
          reels: generated.reels,
          image: generated.image,
        },
      });

      console.timeEnd('[AI] unified-quality');

      const finalGenerated: GeneratedContent = {
        ...generated,
        facebook: inspected.content.facebook,
        telegram: inspected.content.telegram,
        reels: inspected.content.reels,
        image: inspected.content.image,
      };

      console.time('[AI] history');
      const history = await this.historyService.save({
        brandId: brand.id,
        campaignId: context.campaign?.id,
        ideaId: context.idea?.id,
        topic: dto.topic,
        platforms: dto.platforms,
        style: dto.style,
        language: dto.language,
        facebook: finalGenerated.facebook,
        telegram: finalGenerated.telegram,
        reels: finalGenerated.reels,
        imagePrompt: finalGenerated.image,
        analysis: generated.analysis,
      });

      const usage = (response as any).usage ?? {};

      const promptTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;

      const cachedInputTokens =
        usage.input_tokens_details?.cached_tokens ??
        usage.prompt_tokens_details?.cached_tokens ??
        0;

      const completionTokens =
        usage.output_tokens ?? usage.completion_tokens ?? 0;

      const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

      const durationMs = Date.now() - requestStartedAt;

      const pricing = this.getModelPricing(model);

      const regularInputTokens = Math.max(0, promptTokens - cachedInputTokens);

      const estimatedCostUsd =
        (regularInputTokens * pricing.inputPerMillion +
          cachedInputTokens * pricing.cachedInputPerMillion +
          completionTokens * pricing.outputPerMillion) /
        1_000_000;

      const usdToMyrRate = Number(
        this.configService.get<string>('USD_TO_MYR_RATE') ?? '4.30',
      );

      const estimatedCostMyr = estimatedCostUsd * usdToMyrRate;

      await this.prisma.aiUsage.create({
        data: {
          historyId: history.id,
          feature: 'CONTENT_GENERATION',
          model,
          promptTokens,
          cachedInputTokens,
          completionTokens,
          reasoningTokens: 0,
          totalTokens,
          estimatedCostUsd,
          estimatedCostMyr,
          durationMs,
        },
      });

      console.timeEnd('[AI] history');

      if (context.idea) {
        await this.prisma.campaignIdea.update({
          where: { id: context.idea.id },
          data: { status: 'GENERATED' },
        });
      }

      console.time('[AI] knowledge');
      await this.knowledgeService.recordUsage(
        promptChain.knowledgeUsed.map((document) => document.id),
      );
      console.timeEnd('[AI] knowledge');

      console.timeEnd('[AI] total');

      return {
        ...finalGenerated,
        analysis: generated.analysis,
        qualityGate: inspected.qualityGate,
        factualGuard: inspected.factualGuard,
        brandUsed: {
          id: brand.id,
          name: brand.name,
          workspaceName: brand.workspace.name,
        },
        campaignUsed: context.campaign
          ? {
              id: context.campaign.id,
              name: context.campaign.name,
            }
          : undefined,
        ideaUsed: context.idea
          ? {
              id: context.idea.id,
              title: context.idea.title,
            }
          : undefined,
        historyId: history.id,
        marketingThinking,
        promptChain: {
          loadedSourceCount: promptChain.loadedSourceCount,
          totalSourceCount: promptChain.totalSourceCount,
          sources: promptChain.sources,
          queryUnderstanding: promptChain.queryUnderstanding,
          knowledgeUsed: promptChain.knowledgeUsed,
          mergedPrompt: promptChain.mergedPrompt,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown OpenAI error';

      throw new InternalServerErrorException(
        `Content generation failed: ${message}`,
      );
    }
  }

  async suggestTopics(dto: TopicSuggestionsDto) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured in apps/api/.env',
      );
    }

    const brand = await this.brandsService.getActiveBrand();

    const campaign = dto.campaignId
      ? await this.prisma.campaign.findFirst({
          where: {
            id: dto.campaignId,
            brandId: brand.id,
          },
          select: {
            id: true,
            name: true,
            description: true,
            objective: true,
          },
        })
      : null;

    if (dto.campaignId && !campaign) {
      throw new BadRequestException(
        'Campaign was not found for the active brand.',
      );
    }

    const recentHistory = await this.prisma.generationHistory.findMany({
      where: {
        brandId: brand.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
      select: {
        topic: true,
      },
    });

    const count = dto.count ?? 8;

    const recentTopics = recentHistory
      .map((item) => item.topic.trim())
      .filter(Boolean);

    const prompt = [
      'You are Atlas, an AI content strategist.',
      '',
      'Create fresh, practical and non-repetitive content topic ideas.',
      'The topics must be specific enough to generate immediately.',
      'Avoid statistics, current claims or unverifiable facts.',
      '',
      'BRAND',
      `Name: ${brand.name}`,
      `Audience: ${brand.targetAudience}`,
      `Voice: ${brand.brandVoice}`,
      `Content goals: ${brand.contentGoals}`,
      `Keywords: ${brand.keywords.join(', ')}`,
      `Rules: ${brand.brandRules.join(' | ')}`,
      `Forbidden words: ${brand.forbiddenWords.join(', ')}`,
      '',
      'REQUEST',
      `Number of suggestions: ${count}`,
      `Style: ${dto.style}`,
      `Language: ${dto.language}`,
      `Platforms: ${dto.platforms.join(', ')}`,
      `Direction: ${dto.direction?.trim() || 'Open recommendation'}`,
      '',
      'CAMPAIGN',
      campaign
        ? [
            `Name: ${campaign.name}`,
            `Description: ${campaign.description || 'Not provided'}`,
            `Objective: ${campaign.objective || 'Not provided'}`,
          ].join('\n')
        : 'No campaign selected.',
      '',
      'RECENT TOPICS TO AVOID REPEATING',
      recentTopics.length ? recentTopics.join('\n') : 'No recent topics.',
      '',
      'Each suggestion must contain:',
      '- title: a concise usable topic',
      '- angle: the creative direction',
      '- hook: a possible opening line',
      '- reason: why it suits this brand and audience',
      '',
      'Return only JSON matching the required schema.',
    ].join('\n');

    const model =
      this.configService.get<string>('OPENAI_MODEL') || 'gpt-5.6-luna';

    try {
      const response = await this.client.responses.create({
        model,
        input: prompt,
        text: {
          format: {
            type: 'json_schema',
            name: 'atlas_topic_suggestions',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                suggestions: {
                  type: 'array',
                  minItems: count,
                  maxItems: count,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      title: {
                        type: 'string',
                      },
                      angle: {
                        type: 'string',
                      },
                      hook: {
                        type: 'string',
                      },
                      reason: {
                        type: 'string',
                      },
                    },
                    required: ['title', 'angle', 'hook', 'reason'],
                  },
                },
              },
              required: ['suggestions'],
            },
          },
        },
      });

      const parsed = JSON.parse(response.output_text) as {
        suggestions: Array<{
          title: string;
          angle: string;
          hook: string;
          reason: string;
        }>;
      };

      return {
        success: true,
        count: parsed.suggestions.length,
        campaign: campaign
          ? {
              id: campaign.id,
              name: campaign.name,
            }
          : null,
        avoidedTopics: recentTopics,
        suggestions: parsed.suggestions,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown topic suggestion error';

      throw new InternalServerErrorException(
        `Topic suggestion failed: ${message}`,
      );
    }
  }

  async previewPrompt(dto: GenerateContentDto) {
    const brand = await this.brandsService.getActiveBrand();
    return this.promptBuilder.preview(dto, brand);
  }

  private getModelPricing(model: string): {
    inputPerMillion: number;
    cachedInputPerMillion: number;
    outputPerMillion: number;
  } {
    if (model.startsWith('gpt-5.6-luna')) {
      return {
        inputPerMillion: 1,
        cachedInputPerMillion: 0.1,
        outputPerMillion: 6,
      };
    }

    console.warn(`[AI] Missing pricing for model: ${model}`);

    return {
      inputPerMillion: 0,
      cachedInputPerMillion: 0,
      outputPerMillion: 0,
    };
  }

  private selectModel(_dto: GenerateContentDto): string {
    return this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-5.6-luna';
  }

  private compressPromptChainPrompt(prompt: string): string {
    const removablePrefixes = [
      'Hybrid score:',
      'Semantic similarity:',
      'Matched terms:',
      'Matched queries:',
      'Embedding model:',
      'Embedding dimensions:',
      'Average viral score:',
      'Average discussion score:',
      'Average shareability score:',
      'Average brand-fit score:',
    ];

    return prompt
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();

        return !removablePrefixes.some((prefix) => trimmed.startsWith(prefix));
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private async resolveCampaignContext(
    dto: GenerateContentDto,
    brandId: string,
  ) {
    if (!dto.campaignId && !dto.ideaId) {
      return {
        campaign: null,
        idea: null,
      };
    }

    if (!dto.campaignId) {
      throw new BadRequestException(
        'campaignId is required when ideaId is provided.',
      );
    }

    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id: dto.campaignId,
        brandId,
      },
      select: {
        id: true,
        name: true,
        objective: true,
      },
    });

    if (!campaign) {
      throw new BadRequestException(
        'Campaign was not found for the active brand.',
      );
    }

    if (!dto.ideaId) {
      return {
        campaign,
        idea: null,
      };
    }

    const idea = await this.prisma.campaignIdea.findFirst({
      where: {
        id: dto.ideaId,
        campaignId: campaign.id,
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (!idea) {
      throw new BadRequestException(
        'Campaign idea was not found in this campaign.',
      );
    }

    return {
      campaign,
      idea,
    };
  }
}
