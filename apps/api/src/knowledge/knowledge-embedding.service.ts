import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';

type KnowledgeDocumentInput = {
  id: string;
  brandId: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
};

@Injectable()
export class KnowledgeEmbeddingService {
  private readonly queryEmbeddingCache =
    new Map<string, Promise<number[]>>();

  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
  ) {
    const apiKey =
      this.configService.get<string>('OPENAI_API_KEY');

    this.client = apiKey
      ? new OpenAI({ apiKey })
      : null;

    this.model =
      this.configService.get<string>(
        'OPENAI_EMBEDDING_MODEL',
      ) || 'text-embedding-3-small';
  }

  async safeEmbedDocument(documentId: string) {
    try {
      const result = await this.embedDocument(documentId);

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      return {
        success: false,
        documentId,
        embedded: false,
        reason:
          error instanceof Error
            ? error.message
            : 'Unknown embedding error',
      };
    }
  }

  async embedDocument(documentId: string) {
    const brand =
      await this.brandsService.getActiveBrand();

    const document =
      await this.prisma.knowledgeDocument.findFirst({
        where: {
          id: documentId,
          brandId: brand.id,
        },
        select: {
          id: true,
          brandId: true,
          title: true,
          category: true,
          content: true,
          tags: true,
        },
      });

    if (!document) {
      throw new NotFoundException(
        'Knowledge document not found.',
      );
    }

    return this.embed(document);
  }

  async backfill() {
    const brand =
      await this.brandsService.getActiveBrand();

    const documents =
      await this.prisma.knowledgeDocument.findMany({
        where: {
          brandId: brand.id,
        },
        select: {
          id: true,
          brandId: true,
          title: true,
          category: true,
          content: true,
          tags: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

    const results: Array<{
      documentId: string;
      embedded: boolean;
      skipped?: boolean;
      reason?: string;
      dimensions?: number;
    }> = [];

    for (const document of documents) {
      try {
        results.push(await this.embed(document));
      } catch (error) {
        results.push({
          documentId: document.id,
          embedded: false,
          reason:
            error instanceof Error
              ? error.message
              : 'Unknown embedding error',
        });
      }
    }

    return {
      total: documents.length,
      embedded: results.filter(
        (item) => item.embedded,
      ).length,
      skipped: results.filter(
        (item) => item.skipped,
      ).length,
      failed: results.filter(
        (item) =>
          !item.embedded && !item.skipped,
      ).length,
      results,
    };
  }

  async semanticSearch(input: {
    query: string;
    limit?: number;
    threshold?: number;
  }) {
    const query = input.query?.trim();

    if (!query) {
      throw new BadRequestException(
        'Search query is required.',
      );
    }

    const [
      brand,
      queryVector,
    ] = await Promise.all([
      this.brandsService.getActiveBrand(),
      this.getCachedQueryEmbedding(query),
    ]);

    const rows =
      await this.prisma.knowledgeEmbedding.findMany({
        where: {
          brandId: brand.id,
        },
        include: {
          document: {
            include: {
              brand: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

    const threshold =
      typeof input.threshold === 'number'
        ? Math.min(
            Math.max(input.threshold, -1),
            1,
          )
        : 0.2;

    const limit = Math.min(
      Math.max(input.limit || 5, 1),
      25,
    );

    const stopWords = new Set([
      'a',
      'an',
      'and',
      'are',
      'as',
      'at',
      'be',
      'by',
      'for',
      'from',
      'in',
      'is',
      'it',
      'of',
      'on',
      'or',
      'that',
      'the',
      'this',
      'to',
      'with',
      'content',
      'create',
      'generate',
      'marketing',
      'post',
      'social',
    ]);

    const queryTerms = Array.from(
      new Set(
        query
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .map((term) => term.trim())
          .filter(
            (term) =>
              term.length >= 2 &&
              !stopWords.has(term),
          ),
      ),
    );

    const now = Date.now();

    return rows
      .map((row) => {
        const storedVector =
          this.readVector(row.vector);

        const similarity = this.cosineSimilarity(
          queryVector,
          storedVector,
        );

        const document = row.document;
        const title = document.title.toLowerCase();
        const category =
          document.category.toLowerCase();
        const content =
          document.content.toLowerCase();
        const tags = document.tags.map((tag) =>
          tag.toLowerCase(),
        );

        const matchedTerms = queryTerms.filter(
          (term) =>
            title.includes(term) ||
            category.includes(term) ||
            content.includes(term) ||
            tags.some((tag) => tag.includes(term)),
        );

        const rawKeywordScore =
          matchedTerms.reduce(
            (total, term) => {
              let score = total;

              if (title.includes(term)) score += 10;
              if (
                tags.some((tag) => tag.includes(term))
              ) {
                score += 8;
              }
              if (category.includes(term)) {
                score += 6;
              }
              if (content.includes(term)) {
                score += 3;
              }

              return score;
            },
            0,
          );

        const keywordScore = Math.min(
          20,
          rawKeywordScore,
        );

        const semanticScore = Math.max(
          0,
          Math.min(65, similarity * 65),
        );

        const usageScore = Math.min(
          7,
          Math.log2(document.usageCount + 1) * 2,
        );

        const ageInDays = Math.max(
          0,
          (now - document.updatedAt.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        const freshnessScore = Math.max(
          0,
          5 - ageInDays / 60,
        );

        const qualityScore = Math.min(
          3,
          [
            document.title.trim().length >= 8,
            document.content.trim().length >= 120,
            document.tags.length >= 2,
          ].filter(Boolean).length,
        );

        const hybridScore = Math.min(
          100,
          semanticScore +
            keywordScore +
            usageScore +
            freshnessScore +
            qualityScore,
        );

        const reasons: string[] = [
          `Semantic similarity ${Math.round(
            similarity * 100,
          )}%`,
        ];

        if (matchedTerms.length > 0) {
          reasons.push(
            `Matched ${matchedTerms.length} keyword${
              matchedTerms.length === 1 ? '' : 's'
            }`,
          );
        }

        if (document.usageCount > 0) {
          reasons.push(
            `Used ${document.usageCount} times`,
          );
        }

        if (freshnessScore >= 4) {
          reasons.push('Recently updated');
        }

        return {
          document,
          similarity:
            Math.round(similarity * 10000) /
            10000,
          similarityPercent:
            Math.round(similarity * 100),
          hybridScore:
            Math.round(hybridScore * 100) / 100,
          scoreBreakdown: {
            semantic:
              Math.round(semanticScore * 100) /
              100,
            keyword:
              Math.round(keywordScore * 100) /
              100,
            usage:
              Math.round(usageScore * 100) /
              100,
            freshness:
              Math.round(freshnessScore * 100) /
              100,
            quality:
              Math.round(qualityScore * 100) /
              100,
          },
          matchedTerms,
          reasons,
          embedding: {
            model: row.model,
            dimensions: row.dimensions,
            embeddedAt: row.embeddedAt,
          },
        };
      })
      .filter(
        (item) =>
          item.similarity >= threshold ||
          item.matchedTerms.length > 0,
      )
      .sort((a, b) => {
        if (b.hybridScore !== a.hybridScore) {
          return b.hybridScore - a.hybridScore;
        }

        return b.similarity - a.similarity;
      })
      .slice(0, limit);
  }

  private async embed(
    document: KnowledgeDocumentInput,
  ) {
    const input =
      this.buildDocumentInput(document);

    const contentHash =
      this.createContentHash(input);

    const existing =
      await this.prisma.knowledgeEmbedding.findUnique({
        where: {
          documentId: document.id,
        },
        select: {
          contentHash: true,
          model: true,
          dimensions: true,
        },
      });

    if (
      existing?.contentHash === contentHash &&
      existing.model === this.model
    ) {
      return {
        documentId: document.id,
        embedded: false,
        skipped: true,
        reason: 'Embedding already current',
        dimensions: existing.dimensions,
      };
    }

    const vector =
      await this.createEmbedding(input);

    await this.prisma.knowledgeEmbedding.upsert({
      where: {
        documentId: document.id,
      },
      update: {
        brandId: document.brandId,
        vector,
        model: this.model,
        dimensions: vector.length,
        contentHash,
        embeddedAt: new Date(),
      },
      create: {
        documentId: document.id,
        brandId: document.brandId,
        vector,
        model: this.model,
        dimensions: vector.length,
        contentHash,
      },
    });

    return {
      documentId: document.id,
      embedded: true,
      skipped: false,
      model: this.model,
      dimensions: vector.length,
    };
  }

  private async createEmbedding(
    input: string,
  ) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured.',
      );
    }

    const response =
      await this.client.embeddings.create({
        model: this.model,
        input,
        encoding_format: 'float',
      });

    const vector =
      response.data[0]?.embedding;

    if (!vector?.length) {
      throw new ServiceUnavailableException(
        'Embedding API returned no vector.',
      );
    }

    return vector;
  }

  private buildDocumentInput(
    document: KnowledgeDocumentInput,
  ) {
    return [
      `Title: ${document.title}`,
      `Category: ${document.category}`,
      document.tags.length
        ? `Tags: ${document.tags.join(', ')}`
        : 'Tags: None',
      '',
      document.content,
    ]
      .join('\n')
      .slice(0, 24000);
  }

  private createContentHash(value: string) {
    return createHash('sha256')
      .update(value)
      .digest('hex');
  }

  private readVector(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => Number(item))
      .filter((item) =>
        Number.isFinite(item),
      );
  }

  private cosineSimilarity(
    first: number[],
    second: number[],
  ) {
    if (
      first.length === 0 ||
      first.length !== second.length
    ) {
      return -1;
    }

    let dotProduct = 0;
    let firstMagnitude = 0;
    let secondMagnitude = 0;

    for (
      let index = 0;
      index < first.length;
      index += 1
    ) {
      const firstValue = first[index] || 0;
      const secondValue = second[index] || 0;

      dotProduct +=
        firstValue * secondValue;

      firstMagnitude +=
        firstValue * firstValue;

      secondMagnitude +=
        secondValue * secondValue;
    }

    if (
      firstMagnitude === 0 ||
      secondMagnitude === 0
    ) {
      return -1;
    }

    return (
      dotProduct /
      (Math.sqrt(firstMagnitude) *
        Math.sqrt(secondMagnitude))
    );
  }
  private getCachedQueryEmbedding(
    query: string,
  ): Promise<number[]> {
    const normalizedQuery = query
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

    const cacheKey =
      `${this.model}:${normalizedQuery}`;

    const cached =
      this.queryEmbeddingCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const embeddingPromise =
      this.createEmbedding(query).catch(
        (error: unknown) => {
          this.queryEmbeddingCache.delete(
            cacheKey,
          );

          throw error;
        },
      );

    this.queryEmbeddingCache.set(
      cacheKey,
      embeddingPromise,
    );

    if (
      this.queryEmbeddingCache.size > 500
    ) {
      const oldestKey =
        this.queryEmbeddingCache
          .keys()
          .next()
          .value as string | undefined;

      if (oldestKey) {
        this.queryEmbeddingCache.delete(
          oldestKey,
        );
      }
    }

    return embeddingPromise;
  }

}
