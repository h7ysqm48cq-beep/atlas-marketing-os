import { Injectable, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { ChatCopilotDto } from './dto/chat-copilot.dto';

@Injectable()
export class CopilotService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly config: ConfigService,
    private readonly brands: BrandsService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async chat(dto: ChatCopilotDto) {
    if (!this.client) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not configured.');
    }

    const brand = await this.brands.getActiveBrand();
    const campaign = dto.campaignId
      ? await this.prisma.campaign.findFirst({
          where: { id: dto.campaignId, brandId: brand.id },
          select: { id: true, name: true, description: true, objective: true },
        })
      : null;

    if (dto.campaignId && !campaign) {
      throw new NotFoundException('Campaign not found.');
    }

    const context = [
      'You are Atlas Brand Copilot, a senior marketing strategist and content editor.',
      `Brand: ${brand.name}`,
      `Country: ${brand.country}`,
      `Audience: ${brand.targetAudience}`,
      `Voice: ${brand.brandVoice}`,
      `Visual style: ${brand.visualStyle}`,
      `Content goals: ${brand.contentGoals}`,
      `Keywords: ${brand.keywords.join(', ')}`,
      `Rules: ${brand.brandRules.join(' | ')}`,
      `Forbidden words: ${brand.forbiddenWords.join(', ')}`,
      campaign ? `Campaign: ${campaign.name}\nObjective: ${campaign.objective || 'Not set'}\nDescription: ${campaign.description || 'Not set'}` : 'Campaign: none selected',
      'Provide practical, ready-to-use outputs. Preserve Malaysian Chinese context when relevant. Avoid unsupported current claims. When rewriting, give the improved version first.',
    ].join('\n');

    try {
      const response = await this.client.responses.create({
        model: this.config.get<string>('OPENAI_MODEL') || 'gpt-4.1-mini',
        input: [
          { role: 'developer', content: context },
          ...dto.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      });

      return {
        reply: response.output_text,
        brand: { id: brand.id, name: brand.name },
        campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new InternalServerErrorException(`Brand Copilot failed: ${message}`);
    }
  }
}
