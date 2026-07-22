import { Injectable } from '@nestjs/common';
import { Brand } from '../generated/prisma/client';
import { GenerateContentDto } from './dto/generate-content.dto';

type BrandWithWorkspace = Brand & { workspace: { id: string; name: string; slug: string; createdAt: Date; updatedAt: Date } };

@Injectable()
export class PromptBuilderService {
  build(dto: GenerateContentDto, brand: BrandWithWorkspace): string {
    return [
      'You are Atlas, an AI marketing strategist and content producer.',
      '', 'CURRENT TASK', `Topic: ${dto.topic}`, `Requested platforms: ${dto.platforms.join(', ')}`,
      `Requested style: ${dto.style}`, `Requested language: ${dto.language}`,
      '', 'BRAND IDENTITY', `Workspace: ${brand.workspace.name}`, `Brand: ${brand.name}`,
      `Website: ${brand.website || 'Not provided'}`, `Industry: ${brand.industry || 'Not provided'}`,
      `Country: ${brand.country}`, `Primary brand language: ${brand.primaryLanguage}`,
      '', 'AUDIENCE', brand.targetAudience,
      '', 'BRAND VOICE', brand.brandVoice,
      '', 'VISUAL SYSTEM', brand.visualStyle,
      '', 'CONTENT GOALS', brand.contentGoals,
      '', 'BRAND RULES', this.list(brand.brandRules),
      '', 'PREFERRED CALLS TO ACTION', this.list(brand.callsToAction),
      '', 'KEYWORDS AND CONTENT PILLARS', this.list(brand.keywords),
      '', 'FORBIDDEN WORDS OR CLAIMS', this.list(brand.forbiddenWords),
      '', 'REFERENCE POSTS', this.list(brand.examplePosts),
      '', 'OUTPUT REQUIREMENTS',
      '1. Facebook: polished platform-ready post with a strong hook, natural body, one clear CTA and one discussion question.',
      '2. Telegram: shorter, conversational and easy to scan.',
      '3. Reels: an 18–25 second scene-by-scene script with hook, visual direction and ending question.',
      '4. Image: a detailed English image-generation prompt following the brand visual system. No text or logos unless explicitly requested.',
      '5. Analysis: concise strategy, four scores from 0–100, and a recommended Malaysia posting time.',
      '6. Do not invent current trends, performance statistics or factual claims.',
      '7. Keep all content lawful, responsible and suitable for adults.',
      '', 'Return only valid JSON matching the supplied schema.',
    ].join('\n');
  }

  preview(dto: GenerateContentDto, brand: BrandWithWorkspace) {
    return {
      brandId: brand.id, brandName: brand.name, workspaceName: brand.workspace.name,
      prompt: this.build(dto, brand),
      includedMemory: {
        audience: Boolean(brand.targetAudience), voice: Boolean(brand.brandVoice),
        visualStyle: Boolean(brand.visualStyle), contentGoals: Boolean(brand.contentGoals),
        brandRules: brand.brandRules.length, callsToAction: brand.callsToAction.length,
        keywords: brand.keywords.length, forbiddenWords: brand.forbiddenWords.length,
        examplePosts: brand.examplePosts.length,
      },
    };
  }

  private list(items: string[]) { return items.length ? items.map((x)=>`- ${x}`).join('\n') : '- None configured'; }
}
