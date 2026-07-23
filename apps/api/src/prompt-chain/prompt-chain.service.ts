import { Injectable, NotFoundException } from '@nestjs/common';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { PreviewPromptChainDto } from './dto/preview-prompt-chain.dto';

type PromptSource = {
  key: string;
  label: string;
  loaded: boolean;
  summary: string;
};

@Injectable()
export class PromptChainService {
  constructor(
    private readonly brandsService: BrandsService,
    private readonly prisma: PrismaService,
  ) {}

  async preview(dto: PreviewPromptChainDto) {
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
            status: true,
          },
        })
      : null;

    if (dto.campaignId && !campaign) {
      throw new NotFoundException(
        'Campaign was not found for the active brand.',
      );
    }

    const platform = dto.platform || 'Multi-platform';
    const style = dto.style || 'Brand default';
    const language = dto.language || brand.primaryLanguage;

    const sources: PromptSource[] = [
      {
        key: 'brandBrain',
        label: 'Brand Brain',
        loaded: true,
        summary: `${brand.name} · ${brand.brandVoice}`,
      },
      {
        key: 'audience',
        label: 'Audience',
        loaded: Boolean(brand.targetAudience),
        summary: brand.targetAudience,
      },
      {
        key: 'campaign',
        label: 'Campaign',
        loaded: Boolean(campaign),
        summary: campaign
          ? `${campaign.name} · ${campaign.objective || 'No objective set'}`
          : 'No campaign selected',
      },
      {
        key: 'platformRules',
        label: 'Platform Rules',
        loaded: true,
        summary: `${platform} · ${style} · ${language}`,
      },
      {
        key: 'brandRules',
        label: 'Brand Rules',
        loaded: brand.brandRules.length > 0,
        summary:
          brand.brandRules.length > 0
            ? `${brand.brandRules.length} rules loaded`
            : 'No brand rules configured',
      },
      {
        key: 'examples',
        label: 'Reference Posts',
        loaded: brand.examplePosts.length > 0,
        summary:
          brand.examplePosts.length > 0
            ? `${brand.examplePosts.length} reference posts loaded`
            : 'No reference posts configured',
      },
    ];

    const mergedPrompt = [
      'You are Atlas, an AI marketing strategist and content producer.',
      '',
      'CURRENT TASK',
      `Topic: ${dto.topic}`,
      `Platform: ${platform}`,
      `Style: ${style}`,
      `Language: ${language}`,
      '',
      'BRAND IDENTITY',
      `Brand: ${brand.name}`,
      `Website: ${brand.website || 'Not configured'}`,
      `Industry: ${brand.industry || 'Not configured'}`,
      `Country: ${brand.country}`,
      '',
      'AUDIENCE',
      brand.targetAudience,
      '',
      'BRAND VOICE',
      brand.brandVoice,
      '',
      'VISUAL STYLE',
      brand.visualStyle,
      '',
      'CONTENT GOALS',
      brand.contentGoals,
      '',
      'CAMPAIGN CONTEXT',
      campaign
        ? [
            `Name: ${campaign.name}`,
            `Description: ${campaign.description || 'Not configured'}`,
            `Objective: ${campaign.objective || 'Not configured'}`,
            `Status: ${campaign.status}`,
          ].join('\n')
        : 'No campaign selected.',
      '',
      'BRAND RULES',
      brand.brandRules.length
        ? brand.brandRules.map((rule) => `- ${rule}`).join('\n')
        : '- No rules configured',
      '',
      'PREFERRED CALLS TO ACTION',
      brand.callsToAction.length
        ? brand.callsToAction.map((cta) => `- ${cta}`).join('\n')
        : '- No calls to action configured',
      '',
      'KEYWORDS',
      brand.keywords.length
        ? brand.keywords.map((keyword) => `- ${keyword}`).join('\n')
        : '- No keywords configured',
      '',
      'FORBIDDEN WORDS OR CLAIMS',
      brand.forbiddenWords.length
        ? brand.forbiddenWords.map((word) => `- ${word}`).join('\n')
        : '- None configured',
      '',
      'REFERENCE POSTS',
      brand.examplePosts.length
        ? brand.examplePosts
            .map((post, index) => `${index + 1}. ${post}`)
            .join('\n')
        : 'No reference posts configured.',
    ].join('\n');

    return {
      brandId: brand.id,
      brandName: brand.name,
      campaign: campaign
        ? {
            id: campaign.id,
            name: campaign.name,
          }
        : null,
      sources,
      loadedSourceCount: sources.filter((source) => source.loaded).length,
      totalSourceCount: sources.length,
      mergedPrompt,
    };
  }
}
