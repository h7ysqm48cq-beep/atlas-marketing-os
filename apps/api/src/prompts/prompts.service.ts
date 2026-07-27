import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { CreatePromptDto } from './dto/create-prompt.dto';
import { UpdatePromptDto } from './dto/update-prompt.dto';

@Injectable()
export class PromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandsService,
  ) {}

  async create(dto: CreatePromptDto) {
    const brand = await this.brands.getActiveBrand();

    const title = this.required(dto.title, 'Title');
    const category = this.required(
      dto.category,
      'Category',
    );
    const content = this.required(
      dto.content,
      'Prompt content',
    );

    return this.prisma.promptTemplate.create({
      data: {
        brandId: brand.id,
        title,
        category,
        content,
        description:
          dto.description?.trim() || null,
      },
    });
  }

  async findAll(query?: {
    search?: string;
    category?: string;
    favorite?: string;
  }) {
    const brand = await this.brands.getActiveBrand();
    const search = query?.search?.trim();
    const category = query?.category?.trim();

    return this.prisma.promptTemplate.findMany({
      where: {
        brandId: brand.id,
        category:
          category && category !== 'ALL'
            ? category
            : undefined,
        isFavorite:
          query?.favorite === 'true'
            ? true
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
                description: {
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
            ]
          : undefined,
      },
      orderBy: [
        {
          isFavorite: 'desc',
        },
        {
          updatedAt: 'desc',
        },
      ],
    });
  }

  async findOne(id: string) {
    const brand = await this.brands.getActiveBrand();

    const prompt =
      await this.prisma.promptTemplate.findFirst({
        where: {
          id,
          brandId: brand.id,
        },
      });

    if (!prompt) {
      throw new NotFoundException(
        'Prompt template not found.',
      );
    }

    return prompt;
  }

  async update(
    id: string,
    dto: UpdatePromptDto,
  ) {
    const prompt = await this.findOne(id);

    const data = {
      title:
        dto.title === undefined
          ? undefined
          : this.required(dto.title, 'Title'),
      category:
        dto.category === undefined
          ? undefined
          : this.required(
              dto.category,
              'Category',
            ),
      content:
        dto.content === undefined
          ? undefined
          : this.required(
              dto.content,
              'Prompt content',
            ),
      description:
        dto.description === undefined
          ? undefined
          : dto.description.trim() || null,
      isFavorite: dto.isFavorite,
    };

    return this.prisma.promptTemplate.update({
      where: {
        id: prompt.id,
      },
      data,
    });
  }

  async remove(id: string) {
    const prompt = await this.findOne(id);

    await this.prisma.promptTemplate.delete({
      where: {
        id: prompt.id,
      },
    });

    return {
      deleted: true,
      id: prompt.id,
    };
  }

  async recordUsage(id: string) {
    const prompt = await this.findOne(id);

    return this.prisma.promptTemplate.update({
      where: {
        id: prompt.id,
      },
      data: {
        usageCount: {
          increment: 1,
        },
      },
    });
  }

  private required(
    value: string,
    field: string,
  ) {
    const clean = value
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) {
      throw new BadRequestException(
        `${field} is required.`,
      );
    }

    return clean;
  }
}
