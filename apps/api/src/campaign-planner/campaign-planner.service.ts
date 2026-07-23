import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../database/prisma.service';
import { GenerateCampaignPlanDto } from './dto/generate-campaign-plan.dto';

type GeneratedIdea = {
  title: string;
  angle: string;
  hook: string;
  platform: string;
  style: string;
  language: string;
};

@Injectable()
export class CampaignPlannerService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async listIdeas(campaignId: string) {
    await this.getCampaign(campaignId);

    return this.prisma.campaignIdea.findMany({
      where: { campaignId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async generate(campaignId: string, dto: GenerateCampaignPlanDto) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured in apps/api/.env',
      );
    }

    const campaign = await this.getCampaign(campaignId);
    const model =
      this.configService.get<string>('OPENAI_MODEL') || 'gpt-4.1-mini';

    const prompt = [
      'You are Atlas, an AI campaign strategist.',
      '',
      'CAMPAIGN',
      `Name: ${campaign.name}`,
      `Description: ${campaign.description || 'Not provided'}`,
      `Objective: ${campaign.objective || 'Not provided'}`,
      '',
      'BRAND',
      `Name: ${campaign.brand.name}`,
      `Audience: ${campaign.brand.targetAudience}`,
      `Voice: ${campaign.brand.brandVoice}`,
      `Content goals: ${campaign.brand.contentGoals}`,
      `Keywords: ${campaign.brand.keywords.join(', ')}`,
      `Rules: ${campaign.brand.brandRules.join(' | ')}`,
      `Forbidden words: ${campaign.brand.forbiddenWords.join(', ')}`,
      '',
      'PLAN REQUEST',
      `Number of ideas: ${dto.count}`,
      `Direction: ${dto.direction}`,
      `Language: ${dto.language}`,
      `Style: ${dto.style}`,
      `Primary platform: ${dto.platform || 'Multi-platform'}`,
      '',
      'Create distinct, non-repetitive content ideas.',
      'Each idea must have a concise title, strategic angle, strong opening hook, recommended platform, style and language.',
      'Do not invent current statistics, current trends or factual claims.',
      'Return only JSON matching the schema.',
    ].join('\n');

    try {
      const response = await this.client.responses.create({
        model,
        input: prompt,
        text: {
          format: {
            type: 'json_schema',
            name: 'atlas_campaign_plan',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ideas: {
                  type: 'array',
                  minItems: dto.count,
                  maxItems: dto.count,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      title: { type: 'string' },
                      angle: { type: 'string' },
                      hook: { type: 'string' },
                      platform: { type: 'string' },
                      style: { type: 'string' },
                      language: { type: 'string' },
                    },
                    required: [
                      'title',
                      'angle',
                      'hook',
                      'platform',
                      'style',
                      'language',
                    ],
                  },
                },
              },
              required: ['ideas'],
            },
          },
        },
      });

      const parsed = JSON.parse(response.output_text) as {
        ideas: GeneratedIdea[];
      };

      await this.prisma.campaignIdea.deleteMany({
        where: {
          campaignId,
          status: 'PLANNED',
        },
      });

      const created = await this.prisma.$transaction(
        parsed.ideas.map((idea, index) =>
          this.prisma.campaignIdea.create({
            data: {
              campaignId,
              title: idea.title,
              angle: idea.angle,
              hook: idea.hook,
              platform: idea.platform,
              style: idea.style,
              language: idea.language,
              sortOrder: index + 1,
            },
          }),
        ),
      );

      return {
        campaign: {
          id: campaign.id,
          name: campaign.name,
        },
        ideas: created,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown campaign planner error';

      throw new InternalServerErrorException(
        `Campaign planning failed: ${message}`,
      );
    }
  }

  async removeIdea(campaignId: string, ideaId: string) {
    await this.getCampaign(campaignId);

    const idea = await this.prisma.campaignIdea.findFirst({
      where: {
        id: ideaId,
        campaignId,
      },
    });

    if (!idea) {
      throw new NotFoundException('Campaign idea not found.');
    }

    await this.prisma.campaignIdea.delete({
      where: { id: ideaId },
    });

    return {
      deleted: true,
      id: ideaId,
    };
  }

  private async getCampaign(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        brand: true,
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found.');
    }

    return campaign;
  }
}
