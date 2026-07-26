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
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured.',
      );
    }

    const brand = await this.brands.getActiveBrand();

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
      throw new NotFoundException('Campaign not found.');
    }

    const mode = dto.mode || 'chat';

    const baseContext = [
      'You are Elena, the AI marketing strategist inside Atlas Marketing OS.',
      'You are practical, commercially aware, creative and direct.',
      `Brand: ${brand.name}`,
      `Country: ${brand.country}`,
      `Audience: ${brand.targetAudience}`,
      `Voice: ${brand.brandVoice}`,
      `Visual style: ${brand.visualStyle}`,
      `Content goals: ${brand.contentGoals}`,
      `Keywords: ${brand.keywords.join(', ')}`,
      `Rules: ${brand.brandRules.join(' | ')}`,
      `Forbidden words: ${brand.forbiddenWords.join(', ')}`,
      campaign
        ? `Campaign: ${campaign.name}
Objective: ${campaign.objective || 'Not set'}
Description: ${campaign.description || 'Not set'}`
        : 'Campaign: none selected',
      'Preserve Malaysian Chinese context when relevant.',
      'Avoid unsupported claims, fake urgency and unverified current facts.',
      'When rewriting, provide the improved version before the explanation.',
      'Keep outputs ready to copy and use.',
    ];

    const modeContext =
      mode === 'marketing-plan'
        ? [
            'The user has selected MARKETING PLAN mode.',
            'Always produce a complete marketing package using this exact structure:',
            '',
            '## 核心创意',
            'Explain the central idea in 2 to 4 concise sentences.',
            '',
            '## Facebook 文案',
            'Write a natural Facebook-ready caption.',
            '',
            '## Telegram 文案',
            'Write a shorter, more direct Telegram version.',
            '',
            '## Reels Hook',
            'Give 3 strong opening hooks suitable for short video.',
            '',
            '## CTA',
            'Give one clear but natural call to action.',
            '',
            '## Hashtags',
            'Give 5 to 10 relevant hashtags.',
            '',
            '## 图片 Prompt',
            'Write one detailed English image-generation prompt.',
            '',
            '## 风险检查',
            'Mention any brand, compliance, factual or platform risk. Write "无明显风险" when appropriate.',
            '',
            'Use clear headings and do not omit any section.',
          ]
        : [
            'The user has selected CHAT mode.',
            'Answer naturally as an ongoing marketing conversation.',
            'Do not force the full marketing-plan structure unless the user asks for a complete package.',
          ];

    const context = [...baseContext, ...modeContext].join('\n');

    try {
      const response = await this.client.responses.create({
        model:
          this.config.get<string>('OPENAI_MODEL') ||
          'gpt-4.1-mini',
        input: [
          {
            role: 'developer',
            content: context,
          },
          ...dto.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      });

      return {
        reply: response.output_text,
        mode,
        brand: {
          id: brand.id,
          name: brand.name,
        },
        campaign: campaign
          ? {
              id: campaign.id,
              name: campaign.name,
            }
          : null,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error';

      throw new InternalServerErrorException(
        `Elena Copilot failed: ${message}`,
      );
    }
  }
}
