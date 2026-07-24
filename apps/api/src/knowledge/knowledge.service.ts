import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { CreateKnowledgeDocumentDto } from './dto/create-knowledge-document.dto';
import { UpdateKnowledgeDocumentDto } from './dto/update-knowledge-document.dto';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
  ) {}

  async create(dto: CreateKnowledgeDocumentDto) {
    const brand = await this.brandsService.getActiveBrand();

    this.validateRequiredFields(dto);

    return this.prisma.knowledgeDocument.create({
      data: {
        brandId: brand.id,
        title: dto.title.trim(),
        category: dto.category.trim(),
        content: dto.content.trim(),
        tags: this.cleanTags(dto.tags),
      },
      include: this.documentInclude,
    });
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
          .filter((value): value is string => Boolean(value?.trim()))
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

    const scored = documents
      .map((document) => {
        const title = document.title.toLowerCase();
        const category = document.category.toLowerCase();
        const content = document.content.toLowerCase();
        const tags = document.tags.map((tag) => tag.toLowerCase());

        const score = terms.reduce((total, term) => {
          let next = total;

          if (title.includes(term)) next += 6;
          if (category.includes(term)) next += 4;
          if (tags.some((tag) => tag.includes(term))) next += 5;
          if (content.includes(term)) next += 2;

          return next;
        }, 0);

        return {
          document,
          score,
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;

        return (
          b.document.updatedAt.getTime() -
          a.document.updatedAt.getTime()
        );
      });

    const relevant = scored
      .filter((item) => item.score > 0)
      .slice(0, input.limit || 5)
      .map((item) => item.document);

    if (relevant.length > 0) {
      return relevant;
    }

    return documents.slice(0, input.limit || 5);
  }

  async recordUsage(documentIds: string[]) {
    const uniqueIds = Array.from(
      new Set(documentIds.filter(Boolean)),
    );

    if (uniqueIds.length === 0) {
      return {
        updated: 0,
      };
    }

    const brand = await this.brandsService.getActiveBrand();

    const result =
      await this.prisma.knowledgeDocument.updateMany({
        where: {
          id: {
            in: uniqueIds,
          },
          brandId: brand.id,
        },
        data: {
          usageCount: {
            increment: 1,
          },
          lastUsedAt: new Date(),
        },
      });

    return {
      updated: result.count,
    };
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

    return this.prisma.knowledgeDocument.update({
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
