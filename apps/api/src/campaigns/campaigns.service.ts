import { Injectable, NotFoundException } from '@nestjs/common';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
  ) {}

  async create(dto: CreateCampaignDto) {
    const brand = await this.brandsService.getActiveBrand();

    return this.prisma.campaign.create({
      data: {
        brandId: brand.id,
        name: dto.name,
        description: dto.description,
        objective: dto.objective,
        status: dto.status,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
      include: {
        brand: {
          select: {
            id: true,
            name: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });
  }

  findAll() {
    return this.prisma.campaign.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        brand: {
          select: {
            id: true,
            name: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        brand: {
          include: {
            workspace: true,
          },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found.');
    }

    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto) {
    await this.findOne(id);

    return this.prisma.campaign.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        objective: dto.objective,
        status: dto.status,
        startDate:
          dto.startDate === undefined
            ? undefined
            : dto.startDate
              ? new Date(dto.startDate)
              : null,
        endDate:
          dto.endDate === undefined
            ? undefined
            : dto.endDate
              ? new Date(dto.endDate)
              : null,
      },
      include: {
        brand: {
          select: {
            id: true,
            name: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.campaign.delete({
      where: { id },
    });

    return {
      deleted: true,
      id,
    };
  }
}
