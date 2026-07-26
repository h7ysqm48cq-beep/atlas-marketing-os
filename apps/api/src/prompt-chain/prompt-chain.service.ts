import { Injectable, NotFoundException } from '@nestjs/common';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { KnowledgeEmbeddingService } from '../knowledge/knowledge-embedding.service';
import { PreviewPromptChainDto } from './dto/preview-prompt-chain.dto';
import { QueryUnderstandingService } from './query-understanding.service';

type PromptSource = {
  key: string;
  label: string;
  loaded: boolean;
  summary: string;
};

@Injectable()
export class PromptChainService {
  private readonly previewCache =
    new Map<
      string,
      {
        expires: number;
        value: any;
      }
    >();

  constructor(
    private readonly brandsService: BrandsService,
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService,
    private readonly knowledgeService: KnowledgeService,
    private readonly knowledgeEmbeddingService: KnowledgeEmbeddingService,
    private readonly queryUnderstandingService: QueryUnderstandingService,
  ) {}

  async preview(dto: PreviewPromptChainDto) {

    const cacheKey = JSON.stringify({
      topic: dto.topic,
      platform: dto.platform,
      style: dto.style,
      language: dto.language,
      campaignId: dto.campaignId ?? null,
    });

    const cached =
      this.previewCache.get(cacheKey);

    if (
      cached &&
      cached.expires > Date.now()
    ) {
      return cached.value;
    }


    const [
      brand,
      memory,
    ] = await Promise.all([
      this.brandsService.getActiveBrand(),
      this.memoryService.summary(),
    ]);

    const queryUnderstanding =
      await this.queryUnderstandingService.understand({
        topic: dto.topic,
        platform: dto.platform,
        style: dto.style,
        language: dto.language,
      });

    const retrievalQueries = Array.from(
      new Set(
        queryUnderstanding.retrievalQueries
          .map((query) => query.trim())
          .filter(Boolean),
      ),
    ).slice(0, 2);

    const retrievalResults = await Promise.all(
      retrievalQueries.map(async (query) => ({
        query,
        results:
          await this.knowledgeEmbeddingService.semanticSearch({
            query,
            limit: 5,
            threshold: 0.2,
          }),
      })),
    );

    const mergedKnowledge = new Map<
      string,
      (typeof retrievalResults)[number]['results'][number] & {
        matchedQueries: string[];
      }
    >();

    for (const retrieval of retrievalResults) {
      for (const item of retrieval.results) {
        const current = mergedKnowledge.get(
          item.document.id,
        );

        if (!current) {
          mergedKnowledge.set(item.document.id, {
            ...item,
            matchedQueries: [retrieval.query],
          });
          continue;
        }

        const matchedQueries = Array.from(
          new Set([
            ...current.matchedQueries,
            retrieval.query,
          ]),
        );

        if (item.hybridScore > current.hybridScore) {
          mergedKnowledge.set(item.document.id, {
            ...item,
            matchedQueries,
          });
        } else {
          mergedKnowledge.set(item.document.id, {
            ...current,
            matchedQueries,
          });
        }
      }
    }

    const semanticKnowledge = Array.from(
      mergedKnowledge.values(),
    )
      .sort((a, b) => {
        if (b.hybridScore !== a.hybridScore) {
          return b.hybridScore - a.hybridScore;
        }

        return b.similarity - a.similarity;
      })
      .slice(0, 5);

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
        key: 'memory',
        label: 'Atlas Memory',
        loaded: memory.learningSampleSize > 0,
        summary: memory.learningSampleSize > 0
          ? `${memory.preferredStyle || 'No style'} · ${memory.bestPlatform || 'No platform'} · ${memory.bestPostingTime || 'No time'}`
          : 'No memory available',
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
      {
        key: 'knowledge',
        label: 'Knowledge Library',
        loaded: semanticKnowledge.length > 0,
        summary:
          semanticKnowledge.length > 0
            ? `${semanticKnowledge.length} semantic matches loaded · threshold 20%`
            : 'No relevant knowledge documents found',
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
      'QUERY UNDERSTANDING',
      `Intent: ${queryUnderstanding.intent}`,
      `Content type: ${queryUnderstanding.contentType}`,
      `Audience: ${queryUnderstanding.audience}`,
      `Tone: ${queryUnderstanding.tone}`,
      `Industry: ${queryUnderstanding.industry}`,
      `Platform: ${queryUnderstanding.platform}`,
      `Language: ${queryUnderstanding.language}`,
      `Concepts: ${
        queryUnderstanding.concepts.length
          ? queryUnderstanding.concepts.join(', ')
          : 'None'
      }`,
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
      'ATLAS MEMORY',
      `Preferred style: ${memory.preferredStyle || 'Not learned yet'}`,
      `Preferred language: ${memory.preferredLanguage || 'Not learned yet'}`,
      `Best platform: ${memory.bestPlatform || 'Not learned yet'}`,
      `Best posting time: ${memory.bestPostingTime || 'Not learned yet'}`,
      `Average viral score: ${memory.averageScores.viral}`,
      `Average discussion score: ${memory.averageScores.discussion}`,
      `Average shareability score: ${memory.averageScores.shareability}`,
      `Average brand-fit score: ${memory.averageScores.brandFit}`,
      memory.recommendations.length
        ? memory.recommendations.map((item) => `- ${item}`).join('\n')
        : '- No memory recommendations yet',
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
      '',
      'RELEVANT KNOWLEDGE',
      semanticKnowledge.length
        ? semanticKnowledge
            .map((item, index) => {
              const document = item.document;
              const cleanContent = document.content
                .trim()
                .slice(0, 2400);

              return [
                `Knowledge ${index + 1}: ${document.title}`,
                `Hybrid score: ${item.hybridScore}%`,
                `Semantic similarity: ${item.similarityPercent}%`,
                item.matchedTerms.length
                  ? `Matched terms: ${item.matchedTerms.join(', ')}`
                  : 'Matched terms: None',
                item.matchedQueries.length
                  ? `Matched queries: ${item.matchedQueries.join(' | ')}`
                  : 'Matched queries: None',
                `Category: ${document.category}`,
                document.tags.length
                  ? `Tags: ${document.tags.join(', ')}`
                  : 'Tags: None',
                `Embedding model: ${item.embedding.model}`,
                `Embedding dimensions: ${item.embedding.dimensions}`,
                '',
                cleanContent,
              ].join('\n');
            })
            .join('\n\n')
        : 'No relevant knowledge documents available.',
    ].join('\n');

    const result = {
      brandId: brand.id,
      brandName: brand.name,
      campaign: campaign
        ? {
            id: campaign.id,
            name: campaign.name,
          }
        : null,
      sources,
      loadedSourceCount:
        sources.filter((source) => source.loaded).length,
      totalSourceCount: sources.length,
      queryUnderstanding: {
        ...queryUnderstanding,
        retrievalQueries,
      },
      knowledgeUsed: semanticKnowledge.map((item) => ({
        id: item.document.id,
        title: item.document.title,
        category: item.document.category,
        tags: item.document.tags,
        summary:
          item.document.content.trim().slice(0, 220),
        similarity: item.similarity,
        similarityPercent: item.similarityPercent,
        hybridScore: item.hybridScore,
        scoreBreakdown: item.scoreBreakdown,
        matchedTerms: item.matchedTerms,
        matchedQueries: item.matchedQueries,
        reasons: item.reasons,
        embeddingModel: item.embedding.model,
        embeddingDimensions:
          item.embedding.dimensions,
        embeddedAt: item.embedding.embeddedAt,
      })),
      mergedPrompt,
    };

    this.previewCache.set(
      cacheKey,
      {
        expires:
          Date.now() + 5 * 60 * 1000,
        value: result,
      },
    );

    if (this.previewCache.size > 200) {
      const oldestKey =
        this.previewCache.keys().next()
          .value as string | undefined;

      if (oldestKey) {
        this.previewCache.delete(oldestKey);
      }
    }

    return result;
  }
}
