import { Injectable } from '@nestjs/common';
import { Brand } from '../generated/prisma/client';
import { StrategyResult } from '../strategy/types/strategy';
import { MemoryFactsService } from '../memory/memory-facts.service';
import { GenerateContentDto } from './dto/generate-content.dto';

type BrandWithWorkspace = Brand & {
  workspace: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    updatedAt: Date;
  };
};

type MarketingPlanBrand = {
  name: unknown;
  country: unknown;
  primaryLanguage?: unknown;
  targetAudience: unknown;
  brandVoice: unknown;
  visualStyle: unknown;
  contentGoals: unknown;
  keywords: unknown;
  brandRules: unknown;
  forbiddenWords: unknown;
  callsToAction?: unknown;
  examplePosts?: unknown;
};

type MarketingPlanCampaign = {
  name: string;
  objective: string | null;
  description: string | null;
} | null;

type RelevantKnowledge = {
  relevanceScore: number;
  reasons: string[];
  document: {
    id: string;
    title: string;
    category: string;
    content: string;
    tags: string[];
  };
};

type BuildMarketingPlanPromptInput = {
  brand: MarketingPlanBrand;
  campaign: MarketingPlanCampaign;
  strategy: StrategyResult;
  knowledge: RelevantKnowledge[];
};

@Injectable()
export class PromptBuilderService {
  constructor(private readonly memoryFacts: MemoryFactsService) {}

  build(dto: GenerateContentDto, brand: BrandWithWorkspace): string {
    return [
      'You are Atlas, an AI marketing strategist and content producer.',
      '',
      'CURRENT TASK',
      `Topic: ${dto.topic}`,
      `Requested platforms: ${dto.platforms.join(', ')}`,
      `Requested style: ${dto.style}`,
      `Requested language: ${dto.language}`,
      '',
      'BRAND IDENTITY',
      `Workspace: ${brand.workspace.name}`,
      `Brand: ${brand.name}`,
      `Website: ${brand.website || 'Not provided'}`,
      `Industry: ${brand.industry || 'Not provided'}`,
      `Country: ${brand.country}`,
      `Primary brand language: ${brand.primaryLanguage}`,
      '',
      'AUDIENCE',
      brand.targetAudience,
      '',
      'BRAND VOICE',
      brand.brandVoice,
      '',
      'VISUAL SYSTEM',
      brand.visualStyle,
      '',
      'CONTENT GOALS',
      brand.contentGoals,
      '',
      'BRAND RULES',
      this.list(brand.brandRules),
      '',
      'PREFERRED CALLS TO ACTION',
      this.list(brand.callsToAction),
      '',
      'KEYWORDS AND CONTENT PILLARS',
      this.list(brand.keywords),
      '',
      'FORBIDDEN WORDS OR CLAIMS',
      this.list(brand.forbiddenWords),
      '',
      'REFERENCE POSTS',
      this.list(brand.examplePosts),
      '',
      'OUTPUT REQUIREMENTS',
      '1. Facebook: polished platform-ready post with a strong hook, natural body, one clear CTA and one discussion question.',
      '2. Telegram: shorter, conversational and easy to scan.',
      '3. Reels: an 18–25 second scene-by-scene script with hook, visual direction and ending question.',
      '4. Image: a detailed English image-generation prompt following the brand visual system.',
      '5. Image generation rules:',
      '- Focus on creative direction, storytelling, composition, lighting, mood and visual quality.',
      '- Do not generate logos, QR codes, watermarks or footer text inside the image.',
      '- Brand assets will be automatically applied by Atlas rendering system after image generation.',
      '6. Analysis: concise strategy, four scores from 0–100, and a recommended Malaysia posting time.',
      '7. Do not invent current trends, performance statistics or factual claims.',
      '8. Keep all content lawful, responsible and suitable for adults.',
      '',
      'Return only valid JSON matching the supplied schema.',
    ].join('\n');
  }

  async buildMarketingPlanPrompt(
    input: BuildMarketingPlanPromptInput,
  ): Promise<string> {
    const { brand, campaign, strategy, knowledge } = input;

    const confirmedMemory = await this.memoryFacts
      .confirmedPromptContext()
      .catch(() =>
        [
          'ELENA CONFIRMED MEMORY',
          '- Confirmed memory could not be loaded.',
        ].join('\n'),
      );

    return [
      'You are Elena, the senior AI marketing strategist inside Atlas Marketing OS.',
      'Create a practical, commercially useful multi-platform marketing plan.',
      '',
      '================ BRAND BRAIN ================',
      `Brand name: ${this.text(brand.name)}`,
      `Country: ${this.text(brand.country)}`,
      `Primary language: ${this.text(brand.primaryLanguage)}`,
      `Target audience: ${this.text(brand.targetAudience)}`,
      `Brand voice: ${this.text(brand.brandVoice)}`,
      `Visual style: ${this.text(brand.visualStyle)}`,
      `Content goals: ${this.text(brand.contentGoals)}`,
      '',
      'Keywords:',
      this.unknownList(brand.keywords),
      '',
      'Preferred calls to action:',
      this.unknownList(brand.callsToAction),
      '',
      'Brand rules:',
      this.unknownList(brand.brandRules),
      '',
      'Forbidden words or claims:',
      this.unknownList(brand.forbiddenWords),
      '',
      'Reference posts:',
      this.unknownList(brand.examplePosts),
      '',
      '================ CAMPAIGN CONTEXT ================',
      campaign
        ? [
            `Campaign: ${campaign.name}`,
            `Objective: ${campaign.objective || 'Not set'}`,
            `Description: ${campaign.description || 'Not set'}`,
          ].join('\n')
        : 'No existing campaign was selected.',
      '',
      '================ STRATEGY BRAIN ================',
      `Detected intent: ${strategy.intent}`,
      `Confidence: ${strategy.confidence}`,
      `Primary goal: ${strategy.goal}`,
      `Recommended audiences: ${strategy.audience.join(', ')}`,
      `Recommended pillars: ${strategy.pillars.join(', ')}`,
      `Recommended KPIs: ${strategy.kpis.join(', ')}`,
      '',
      'Decision notes:',
      this.list(strategy.reasoning),
      '',
      '================ RELEVANT KNOWLEDGE ================',
      this.knowledgeContext(knowledge),
      '',
      '================ CONFIRMED LONG-TERM MEMORY ================',
      confirmedMemory,
      '',
      '================ INSTRUCTION PRIORITY ================',
      '1. The current explicit user request has the highest priority.',
      '2. Brand Brain rules and forbidden-word restrictions are mandatory.',
      '3. Selected campaign context and Strategy Brain guide the plan.',
      '4. Confirmed Elena Memory provides reusable preferences.',
      '5. Knowledge Library supplies supporting facts and context.',
      '6. Never use candidate or rejected memories.',
      '',
      '================ STRATEGY RULES ================',
      '- Treat Strategy Brain as the primary planning direction.',
      '- Align the objective, audience, content pillars, platform content and schedule with the selected goal.',
      '- Use relevant Knowledge Library information when it clearly supports the request.',
      '- Do not present internal strategy reasoning or knowledge retrieval scores to the end user.',
      '- Do not contradict Brand Brain rules or forbidden-word restrictions.',
      '- Refine a recommendation only when the user request, Brand Brain, campaign context or retrieved knowledge provides stronger evidence.',
      '',
      '================ OUTPUT REQUIREMENTS ================',
      '- Use the language requested by the user. For a Chinese request, use natural Simplified Chinese suitable for Malaysian Chinese audiences.',
      '- Produce 4 to 6 distinct content pillars.',
      '- Produce 10 practical content ideas.',
      '- Produce 3 ready-to-use Facebook captions.',
      '- Produce 3 concise Telegram captions.',
      '- Produce 3 Reels concepts with hook, scene direction and ending CTA.',
      '- Produce 3 detailed English image-generation prompts.',
      '- Produce a realistic 7-day publishing schedule.',
      '- Adapt each platform version instead of copying the same text.',
      '- Avoid unsupported current claims, fake urgency and prohibited brand wording.',
      '- Never invent a promotion, contest, giveaway, lucky draw, reward, bonus, discount, free credit or prize unless explicitly requested.',
      '- Never claim an activity, offer, campaign or event exists unless supplied by the user or campaign context.',
      '- Do not use phrases such as limited time, claim now, guaranteed, instant reward or act now unless explicitly supported.',
      '- Do not reproduce copyrighted television footage, screenshots, posters, logos, celebrity likenesses or identifiable real actors.',
      '- Image prompts must use original fictional scenes and generic people.',
      '- Return only data matching the required JSON schema.',
    ].join('\n');
  }

  preview(dto: GenerateContentDto, brand: BrandWithWorkspace) {
    return {
      brandId: brand.id,
      brandName: brand.name,
      workspaceName: brand.workspace.name,
      prompt: this.build(dto, brand),
      includedMemory: {
        audience: Boolean(brand.targetAudience),
        voice: Boolean(brand.brandVoice),
        visualStyle: Boolean(brand.visualStyle),
        contentGoals: Boolean(brand.contentGoals),
        brandRules: brand.brandRules.length,
        callsToAction: brand.callsToAction.length,
        keywords: brand.keywords.length,
        forbiddenWords: brand.forbiddenWords.length,
        examplePosts: brand.examplePosts.length,
      },
    };
  }

  private knowledgeContext(knowledge: RelevantKnowledge[]) {
    if (!knowledge.length) {
      return 'No directly relevant Knowledge Library documents were found.';
    }

    return knowledge
      .slice(0, 3)
      .map((item, index) => {
        const content = item.document.content
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1800);

        return [
          `Knowledge ${index + 1}`,
          `Title: ${item.document.title}`,
          `Category: ${item.document.category}`,
          `Tags: ${item.document.tags.join(', ') || 'None'}`,
          `Content: ${content}`,
        ].join('\n');
      })
      .join('\n\n');
  }

  private text(value: unknown) {
    if (value === null || value === undefined || value === '') {
      return 'Not configured';
    }

    return String(value);
  }

  private unknownList(value: unknown) {
    if (!Array.isArray(value)) {
      return '- None configured';
    }

    return this.list(value.map((item) => String(item).trim()).filter(Boolean));
  }

  private list(items: string[]) {
    return items.length
      ? items.map((item) => `- ${item}`).join('\n')
      : '- None configured';
  }
}
