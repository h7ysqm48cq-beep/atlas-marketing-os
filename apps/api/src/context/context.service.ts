import { Injectable } from '@nestjs/common';
import { BrandsService } from '../brands/brands.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { MemoryFactsService } from '../memory/memory-facts.service';
import {
  AIContext,
  BuildContextInput,
} from './context.types';

@Injectable()
export class ContextService {
  constructor(
    private readonly brandsService: BrandsService,
    private readonly memoryFactsService: MemoryFactsService,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  async build(
    input: BuildContextInput,
  ): Promise<AIContext> {
    const prompt = input.prompt.trim();

    const platforms =
      input.platforms?.length
        ? input.platforms
        : ['Facebook', 'Telegram', 'Instagram', 'Reels'];

    const language =
      input.language ?? 'Chinese and English';

    const style =
      input.style ?? 'Natural and brand-aligned';

    const [
      brand,
      confirmedMemoryFacts,
      relevantKnowledge,
    ] = await Promise.all([
      this.brandsService.getActiveBrand(),

      this.memoryFactsService.findAll({
        status: 'CONFIRMED',
      }),

      this.knowledgeService.findRelevant({
        topic: prompt,
        platform: platforms.join(' '),
        language,
        style,
        limit: input.knowledgeLimit ?? 5,
      }),
    ]);

    return {
      request: {
        prompt,
        campaignId: input.campaignId ?? null,
        platforms,
        language,
        style,
      },

      brand: {
        id: brand.id,
        name: brand.name,
        country: brand.country,
        primaryLanguage: brand.primaryLanguage,
        targetAudience: brand.targetAudience,
        brandVoice: brand.brandVoice,
        visualStyle: brand.visualStyle,
        contentGoals: brand.contentGoals,
        keywords: brand.keywords,
        brandRules: brand.brandRules,
        forbiddenWords: brand.forbiddenWords,
      },

      memory: {
        confirmedCount:
          confirmedMemoryFacts.length,

        facts: confirmedMemoryFacts.map(
          (fact) => ({
            id: fact.id,
            type: fact.type,
            key: fact.key,
            value: fact.value,
            description: fact.description,
            confidence: fact.confidence,
            sourceType: fact.sourceType,
          }),
        ),
      },

      knowledge: {
        matchedCount:
          relevantKnowledge.length,

        documents: relevantKnowledge.map(
          (item) => ({
            id: item.document.id,
            title: item.document.title,
            category: item.document.category,
            tags: item.document.tags,
            relevanceScore:
              item.relevanceScore,
            matchedTerms:
              item.matchedTerms,
            reasons: item.reasons,
            updatedAt:
              item.document.updatedAt,
          }),
        ),
      },

      metadata: {
        version: '1.0',
        createdAt: new Date(),
        sources: [
          'active-brand',
          'confirmed-memory',
          'relevant-knowledge',
        ],
      },
    };
  }
}
