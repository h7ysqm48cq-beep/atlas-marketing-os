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
import { PromptChainService } from '../prompt-chain/prompt-chain.service';
import { GenerateContentDto } from './dto/generate-content.dto';
import { PromptBuilderService } from './prompt-builder.service';

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
  promptChain: {
    loadedSourceCount: number;
    totalSourceCount: number;
    sources: Array<{
      key: string;
      label: string;
      loaded: boolean;
      summary: string;
    }>;
    knowledgeUsed: Array<{
      id: string;
      title: string;
      category: string;
      tags: string[];
      summary: string;
    }>;
  };
};

@Injectable()
export class AiService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly brandsService: BrandsService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly promptChainService: PromptChainService,
    private readonly historyService: HistoryService,
    private readonly knowledgeService: KnowledgeService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async generate(dto: GenerateContentDto): Promise<GeneratedOutputs> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured in apps/api/.env',
      );
    }

    const brand = await this.brandsService.getActiveBrand();
    const context = await this.resolveCampaignContext(dto, brand.id);
    const promptChain = await this.promptChainService.preview({
      topic: dto.topic,
      platform: dto.platforms.join(', '),
      style: dto.style,
      language: dto.language,
      campaignId: dto.campaignId,
    });

    const outputContract = this.promptBuilder.build(dto, brand);

    const prompt = [
      promptChain.mergedPrompt,
      '',
      'ATLAS OUTPUT CONTRACT',
      outputContract,
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
            name: 'atlas_content_package',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                facebook: { type: 'string' },
                telegram: { type: 'string' },
                reels: { type: 'string' },
                image: { type: 'string' },
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

      const generated = JSON.parse(response.output_text) as GeneratedContent;

      const history = await this.historyService.save({
        brandId: brand.id,
        campaignId: context.campaign?.id,
        ideaId: context.idea?.id,
        topic: dto.topic,
        platforms: dto.platforms,
        style: dto.style,
        language: dto.language,
        facebook: generated.facebook,
        telegram: generated.telegram,
        reels: generated.reels,
        imagePrompt: generated.image,
        analysis: generated.analysis,
      });

      if (context.idea) {
        await this.prisma.campaignIdea.update({
          where: { id: context.idea.id },
          data: { status: 'GENERATED' },
        });
      }

      await this.knowledgeService.recordUsage(
        promptChain.knowledgeUsed.map(
          (document) => document.id,
        ),
      );

      return {
        ...generated,
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
        promptChain: {
          loadedSourceCount: promptChain.loadedSourceCount,
          totalSourceCount: promptChain.totalSourceCount,
          sources: promptChain.sources,
          knowledgeUsed: promptChain.knowledgeUsed,
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

  async previewPrompt(dto: GenerateContentDto) {
    const brand = await this.brandsService.getActiveBrand();
    return this.promptBuilder.preview(dto, brand);
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
