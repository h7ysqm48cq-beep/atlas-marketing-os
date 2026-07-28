import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { CreateKnowledgeDocumentDto } from './dto/create-knowledge-document.dto';
import { UpdateKnowledgeDocumentDto } from './dto/update-knowledge-document.dto';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
    private readonly embeddingService: KnowledgeEmbeddingService,
  ) {}

  async create(dto: CreateKnowledgeDocumentDto) {
    const brand = await this.brandsService.getActiveBrand();

    this.validateRequiredFields(dto);

    const document =
      await this.prisma.knowledgeDocument.create({
        data: {
          brandId: brand.id,
          title: dto.title.trim(),
          category: dto.category.trim(),
          content: dto.content.trim(),
          tags: this.cleanTags(dto.tags),
          sourceFileName: dto.sourceFileName,
          sourceMimeType: dto.sourceMimeType,
          sourceFileSize: dto.sourceFileSize,
          sourceUrl: dto.sourceUrl,
          storageProvider: dto.storageProvider,
          storagePath: dto.storagePath,
        },
        include: this.documentInclude,
      });

    const embedding =
      await this.embeddingService.safeEmbedDocument(
        document.id,
      );

    return {
      ...document,
      embeddingStatus: embedding,
    };
  }

  async findAll(query?: {
    search?: string;
    category?: string;
  }) {
    const brand = await this.brandsService.getActiveBrand();
    const search = query?.search?.trim();
    const category = query?.category?.trim();

    return this.prisma.knowledgeDocument.findMany({
      where: {
        brandId: brand.id,
        category:
          category && category !== 'ALL'
            ? category
            : undefined,
        OR: search
          ? [
              {
                title: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                content: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                category: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                tags: {
                  has: search,
                },
              },
            ]
          : undefined,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: this.documentInclude,
    });
  }

  async findRelevant(input: {
    topic: string;
    platform?: string;
    style?: string;
    language?: string;
    limit?: number;
  }) {
    const brand = await this.brandsService.getActiveBrand();

    const terms = Array.from(
      new Set(
        [
          input.topic,
          input.platform,
          input.style,
          input.language,
        ]
          .filter((value): value is string =>
            Boolean(value?.trim()),
          )
          .flatMap((value) =>
            value
              .toLowerCase()
              .split(/[^\p{L}\p{N}]+/u)
              .map((term) => term.trim())
              .filter((term) => term.length >= 2),
          ),
      ),
    );

    const documents =
      await this.prisma.knowledgeDocument.findMany({
        where: {
          brandId: brand.id,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

    const now = Date.now();

    return documents
      .map((document) => {
        const title = document.title.toLowerCase();
        const category = document.category.toLowerCase();
        const content = document.content.toLowerCase();
        const tags = document.tags.map((tag) =>
          tag.toLowerCase(),
        );

        const matchedTerms = terms.filter(
          (term) =>
            title.includes(term) ||
            category.includes(term) ||
            content.includes(term) ||
            tags.some((tag) => tag.includes(term)),
        );

        const rawMatchScore = matchedTerms.reduce(
          (total, term) => {
            let score = total;

            if (title.includes(term)) score += 12;
            if (tags.some((tag) => tag.includes(term))) {
              score += 10;
            }
            if (category.includes(term)) score += 8;
            if (content.includes(term)) score += 4;

            return score;
          },
          0,
        );

        const matchScore = Math.min(70, rawMatchScore);

        const usageScore = Math.min(
          15,
          Math.round(
            Math.log2(document.usageCount + 1) * 4,
          ),
        );

        const ageInDays = Math.max(
          0,
          (now - document.updatedAt.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        const freshnessScore = Math.max(
          0,
          Math.round(10 - ageInDays / 30),
        );

        const qualityScore = Math.min(
          5,
          [
            document.title.trim().length >= 8,
            document.content.trim().length >= 120,
            document.tags.length >= 2,
            Boolean(document.category.trim()),
            document.content.trim().length >= 400,
          ].filter(Boolean).length,
        );

        const relevanceScore = Math.min(
          100,
          matchScore +
            usageScore +
            freshnessScore +
            qualityScore,
        );

        const reasons: string[] = [];

        if (matchedTerms.length > 0) {
          reasons.push(
            `Matched ${matchedTerms.length} query term${
              matchedTerms.length === 1 ? '' : 's'
            }`,
          );
        }

        if (document.usageCount > 0) {
          reasons.push(
            `Used ${document.usageCount} times`,
          );
        }

        if (freshnessScore >= 8) {
          reasons.push('Recently updated');
        }

        if (qualityScore >= 4) {
          reasons.push('Well-structured document');
        }

        return {
          document,
          relevanceScore,
          matchedTerms,
          reasons,
        };
      })
      .filter((item) => item.matchedTerms.length > 0)
      .sort((a, b) => {
        if (
          b.relevanceScore !== a.relevanceScore
        ) {
          return b.relevanceScore - a.relevanceScore;
        }

        return (
          b.document.updatedAt.getTime() -
          a.document.updatedAt.getTime()
        );
      })
      .slice(0, input.limit || 5);
  }

  async recordUsage(documentIds: string[]) {
    if (!documentIds.length) {
      return;
    }

    // Fire-and-forget usage update.
    void this.prisma.knowledgeDocument.updateMany({
      where: {
        id: {
          in: documentIds,
        },
      },
      data: {
        usageCount: {
          increment: 1,
        },
        lastUsedAt: new Date(),
      },
    }).catch(() => {});
}

  async findOne(id: string) {
    const brand = await this.brandsService.getActiveBrand();

    const document =
      await this.prisma.knowledgeDocument.findFirst({
        where: {
          id,
          brandId: brand.id,
        },
        include: this.documentInclude,
      });

    if (!document) {
      throw new NotFoundException(
        'Knowledge document not found.',
      );
    }

    return document;
  }

  async update(
    id: string,
    dto: UpdateKnowledgeDocumentDto,
  ) {
    await this.findOne(id);

    if (dto.title !== undefined && !dto.title.trim()) {
      throw new BadRequestException('Title is required.');
    }

    if (
      dto.category !== undefined &&
      !dto.category.trim()
    ) {
      throw new BadRequestException(
        'Category is required.',
      );
    }

    if (
      dto.content !== undefined &&
      !dto.content.trim()
    ) {
      throw new BadRequestException('Content is required.');
    }

    const document =
      await this.prisma.knowledgeDocument.update({
        where: { id },
        data: {
          title:
            dto.title === undefined
              ? undefined
              : dto.title.trim(),
          category:
            dto.category === undefined
              ? undefined
              : dto.category.trim(),
          content:
            dto.content === undefined
              ? undefined
              : dto.content.trim(),
          tags:
            dto.tags === undefined
              ? undefined
              : this.cleanTags(dto.tags),
        },
        include: this.documentInclude,
      });

    const embedding =
      await this.embeddingService.safeEmbedDocument(
        document.id,
      );

    return {
      ...document,
      embeddingStatus: embedding,
    };
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.knowledgeDocument.delete({
      where: { id },
    });

    return {
      deleted: true,
      id,
    };
  }

  private validateRequiredFields(
    dto: CreateKnowledgeDocumentDto,
  ) {
    if (!dto.title?.trim()) {
      throw new BadRequestException('Title is required.');
    }

    if (!dto.category?.trim()) {
      throw new BadRequestException(
        'Category is required.',
      );
    }

    if (!dto.content?.trim()) {
      throw new BadRequestException('Content is required.');
    }
  }

  private cleanTags(tags?: string[]) {
    return Array.from(
      new Set(
        (tags || [])
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    );
  }

  private readonly documentInclude = {
    brand: {
      select: {
        id: true,
        name: true,
      },
    },
  };
}
