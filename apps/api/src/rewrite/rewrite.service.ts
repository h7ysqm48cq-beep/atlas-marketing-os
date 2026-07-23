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
import { RewriteContentDto } from './dto/rewrite-content.dto';

@Injectable()
export class RewriteService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly config: ConfigService,
    private readonly brands: BrandsService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async rewrite(dto: RewriteContentDto) {
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

    const actionInstructions: Record<
      RewriteContentDto['action'],
      string
    > = {
      improve:
        'Improve clarity, hook strength, emotional relevance, discussion potential and brand fit while preserving the original meaning.',
      rewrite:
        'Create a substantially fresher version with a stronger structure and less repetitive wording.',
      translate:
        `Translate naturally into ${dto.targetLanguage || 'English'} while preserving tone, formatting and marketing intent.`,
      shorter:
        'Reduce the length while retaining the core hook, message and CTA.',
      longer:
        'Expand the content with richer context and stronger flow without becoming repetitive.',
    };

    const toneInstructions: Record<string, string> = {
      Default: 'Use the configured brand voice.',
      Funny:
        'Make the content witty, relatable and naturally humorous without forcing jokes.',
      Professional:
        'Use a polished, credible and commercially professional tone.',
      'Malaysian Chinese':
        'Use natural Malaysian Chinese phrasing and culturally familiar expressions. Avoid Mainland-China-only wording.',
      Emotional:
        'Increase emotional resonance, warmth and personal connection.',
      Luxury:
        'Use refined, premium and understated language. Avoid exaggerated claims.',
      'Gen Z':
        'Use energetic, contemporary and concise language without sounding artificial or overly slang-heavy.',
    };

    const goalInstructions: Record<string, string> = {
      Balanced:
        'Balance clarity, brand fit, engagement and natural flow.',
      'More Viral':
        'Strengthen curiosity, emotional contrast, memorability and share potential.',
      'Better Hook':
        'Prioritize a stronger first line that stops scrolling immediately.',
      'More Comments':
        'End with one specific, easy-to-answer discussion question.',
      'More Shares':
        'Make the idea more relatable and worth sharing with friends.',
      'Stronger CTA':
        'Improve the final call to action while keeping it natural and non-pushy.',
    };

    const lengthInstructions: Record<string, string> = {
      Auto: 'Choose the best length for the selected platform.',
      Short:
        'Keep the final version concise and approximately 60–120 words where appropriate.',
      Medium:
        'Use a balanced medium length with enough context and one clear CTA.',
      Long:
        'Create a fuller version with richer storytelling while avoiding repetition.',
    };

    const tone = dto.tone || 'Default';
    const goal = dto.goal || 'Balanced';
    const length = dto.length || 'Auto';

    const prompt = [
      'You are Atlas Rewrite Engine Pro, a senior marketing editor.',
      '',
      `Platform: ${dto.platform}`,
      `Action: ${dto.action}`,
      `Selected tone: ${tone}`,
      `Selected goal: ${goal}`,
      `Selected length: ${length}`,
      '',
      'BRAND CONTEXT',
      `Brand: ${brand.name}`,
      `Country: ${brand.country}`,
      `Audience: ${brand.targetAudience}`,
      `Voice: ${brand.brandVoice}`,
      `Goals: ${brand.contentGoals}`,
      `Rules: ${brand.brandRules.join(' | ')}`,
      `Forbidden words: ${brand.forbiddenWords.join(', ')}`,
      '',
      campaign
        ? [
            'CAMPAIGN CONTEXT',
            `Name: ${campaign.name}`,
            `Description: ${campaign.description || 'Not set'}`,
            `Objective: ${campaign.objective || 'Not set'}`,
          ].join('\n')
        : 'CAMPAIGN CONTEXT\nNo campaign selected.',
      '',
      'EDITING INSTRUCTIONS',
      actionInstructions[dto.action],
      toneInstructions[tone],
      goalInstructions[goal],
      lengthInstructions[length],
      '',
      'QUALITY RULES',
      '- Preserve the original factual meaning unless the action requires a fresh angle.',
      '- Do not invent unsupported facts, statistics, promotions or guarantees.',
      '- Follow the brand rules and avoid forbidden words.',
      '- Return only the rewritten content.',
      '- Do not add explanations, headings, labels or quotation marks.',
      '',
      'ORIGINAL CONTENT',
      dto.content,
    ].join('\n');

    try {
      const response = await this.client.responses.create({
        model:
          this.config.get<string>('OPENAI_MODEL') ||
          'gpt-4.1-mini',
        input: prompt,
      });

      return {
        content: response.output_text.trim(),
        action: dto.action,
        platform: dto.platform,
        configuration: {
          tone,
          goal,
          length,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';

      throw new InternalServerErrorException(
        `Rewrite failed: ${message}`,
      );
    }
  }
}
