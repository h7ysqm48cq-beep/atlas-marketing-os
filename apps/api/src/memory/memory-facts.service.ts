import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BrandMemoryFactStatus,
  BrandMemoryFactType,
} from '../generated/prisma/client';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { CreateMemoryFactDto } from './dto/create-memory-fact.dto';
import { UpdateMemoryFactDto } from './dto/update-memory-fact.dto';

@Injectable()
export class MemoryFactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandsService,
  ) {}

  async create(dto: CreateMemoryFactDto) {
    const brand = await this.brands.getActiveBrand();

    const key = this.required(dto.key, 'Memory key');
    const value = this.required(dto.value, 'Memory value');

    const status = dto.status || BrandMemoryFactStatus.CANDIDATE;

    return this.prisma.brandMemoryFact.create({
      data: {
        brandId: brand.id,
        type: dto.type || BrandMemoryFactType.PREFERENCE,
        key,
        value,
        description: dto.description?.trim() || null,
        confidence: dto.confidence ?? 80,
        status,
        sourceType: dto.sourceType?.trim() || 'manual',
        sourceId: dto.sourceId?.trim() || null,
        confirmedAt:
          status === BrandMemoryFactStatus.CONFIRMED ? new Date() : null,
        rejectedAt:
          status === BrandMemoryFactStatus.REJECTED ? new Date() : null,
      },
    });
  }

  async findAll(query?: { search?: string; status?: string; type?: string }) {
    const brand = await this.brands.getActiveBrand();

    const search = query?.search?.trim();

    const status = this.enumValue(BrandMemoryFactStatus, query?.status);

    const type = this.enumValue(BrandMemoryFactType, query?.type);

    return this.prisma.brandMemoryFact.findMany({
      where: {
        brandId: brand.id,
        status,
        type,
        OR: search
          ? [
              {
                key: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                value: {
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
            ]
          : undefined,
      },
      orderBy: [
        {
          status: 'asc',
        },
        {
          updatedAt: 'desc',
        },
      ],
    });
  }

  async findOne(id: string) {
    const brand = await this.brands.getActiveBrand();

    const fact = await this.prisma.brandMemoryFact.findFirst({
      where: {
        id,
        brandId: brand.id,
      },
    });

    if (!fact) {
      throw new NotFoundException('Memory fact not found.');
    }

    return fact;
  }

  async update(id: string, dto: UpdateMemoryFactDto) {
    const fact = await this.findOne(id);

    const status = dto.status;

    return this.prisma.brandMemoryFact.update({
      where: {
        id: fact.id,
      },
      data: {
        type: dto.type,
        key:
          dto.key === undefined
            ? undefined
            : this.required(dto.key, 'Memory key'),
        value:
          dto.value === undefined
            ? undefined
            : this.required(dto.value, 'Memory value'),
        description:
          dto.description === undefined
            ? undefined
            : dto.description.trim() || null,
        confidence: dto.confidence,
        status,
        confirmedAt:
          status === BrandMemoryFactStatus.CONFIRMED
            ? new Date()
            : status
              ? null
              : undefined,
        rejectedAt:
          status === BrandMemoryFactStatus.REJECTED
            ? new Date()
            : status
              ? null
              : undefined,
      },
    });
  }

  async confirm(id: string) {
    const fact = await this.findOne(id);

    return this.prisma.brandMemoryFact.update({
      where: {
        id: fact.id,
      },
      data: {
        status: BrandMemoryFactStatus.CONFIRMED,
        confirmedAt: new Date(),
        rejectedAt: null,
      },
    });
  }

  async reject(id: string) {
    const fact = await this.findOne(id);

    return this.prisma.brandMemoryFact.update({
      where: {
        id: fact.id,
      },
      data: {
        status: BrandMemoryFactStatus.REJECTED,
        rejectedAt: new Date(),
        confirmedAt: null,
      },
    });
  }

  async remove(id: string) {
    const fact = await this.findOne(id);

    await this.prisma.brandMemoryFact.delete({
      where: {
        id: fact.id,
      },
    });

    return {
      deleted: true,
      id: fact.id,
    };
  }

  async confirmedPromptContext() {
    const brand = await this.brands.getActiveBrand();

    const facts = await this.prisma.brandMemoryFact.findMany({
      where: {
        brandId: brand.id,
        status: BrandMemoryFactStatus.CONFIRMED,
      },
      orderBy: [
        {
          confidence: 'desc',
        },
        {
          updatedAt: 'desc',
        },
      ],
      take: 30,
    });

    if (!facts.length) {
      return [
        'ELENA CONFIRMED MEMORY',
        '- No confirmed long-term preferences yet.',
      ].join('\n');
    }

    return [
      'ELENA LONG TERM BRAND MEMORY',
      '',
      'Use these confirmed preferences as persistent guidance.',
      '',
      ...facts.map((fact) => `[${fact.type}]\n- ${fact.key}: ${fact.value}`),
      '',
      'Memory priority:',
      '- Follow confirmed memory when relevant.',
      '- Current user instructions always override memory.',
      '- Brand Brain rules override memory when conflicts exist.',
    ].join('\n');
  }

  private required(value: string, field: string) {
    const clean = value.replace(/\s+/g, ' ').trim();

    if (!clean) {
      throw new BadRequestException(`${field} is required.`);
    }

    return clean;
  }

  private enumValue<T extends Record<string, string>>(
    values: T,
    value?: string,
  ): T[keyof T] | undefined {
    if (!value || value === 'ALL') {
      return undefined;
    }

    const normalized = value.toUpperCase();

    const match = Object.values(values).find((item) => item === normalized);

    if (!match) {
      throw new BadRequestException(`Unsupported filter value: ${value}`);
    }

    return match as T[keyof T];
  }
}
