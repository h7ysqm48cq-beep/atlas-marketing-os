import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
  ) {}

  async create(dto: CreateAssetDto) {
    const brand = await this.brandsService.getActiveBrand();
    await this.validateRelations(brand.id, dto.campaignId, dto.historyId);

    return this.prisma.asset.create({
      data: {
        brandId: brand.id,
        campaignId: dto.campaignId,
        historyId: dto.historyId,
        name: dto.name,
        type: dto.type,
        provider: dto.provider,
        platform: dto.platform,
        prompt: dto.prompt,
        url: dto.url,
        thumbnailUrl: dto.thumbnailUrl,
        mimeType: dto.mimeType,
        width: dto.width,
        height: dto.height,
        isFavorite: dto.isFavorite,
      },
      include: this.assetInclude,
    });
  }

  async findAll(query?: {
    search?: string;
    type?: string;
    campaignId?: string;
    favorite?: string;
  }) {
    const brand = await this.brandsService.getActiveBrand();
    const search = query?.search?.trim();

    return this.prisma.asset.findMany({
      where: {
        brandId: brand.id,
        campaignId: query?.campaignId || undefined,
        type:
          query?.type && query.type !== 'ALL'
            ? (query.type as 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'TEMPLATE')
            : undefined,
        isFavorite:
          query?.favorite === 'true'
            ? true
            : query?.favorite === 'false'
              ? false
              : undefined,
        OR: search
          ? [
              {
                name: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                prompt: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                provider: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ]
          : undefined,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: this.assetInclude,
    });
  }

  async findOne(id: string) {
    const brand = await this.brandsService.getActiveBrand();

    const asset = await this.prisma.asset.findFirst({
      where: {
        id,
        brandId: brand.id,
      },
      include: this.assetInclude,
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    return asset;
  }

  async update(id: string, dto: UpdateAssetDto) {
    const current = await this.findOne(id);
    const campaignId =
      dto.campaignId === undefined ? current.campaignId : dto.campaignId;
    const historyId =
      dto.historyId === undefined ? current.historyId : dto.historyId;

    await this.validateRelations(current.brandId, campaignId, historyId);

    return this.prisma.asset.update({
      where: { id },
      data: {
        campaignId: dto.campaignId,
        historyId: dto.historyId,
        name: dto.name,
        type: dto.type,
        provider: dto.provider,
        platform: dto.platform,
        prompt: dto.prompt,
        url: dto.url,
        thumbnailUrl: dto.thumbnailUrl,
        mimeType: dto.mimeType,
        width: dto.width,
        height: dto.height,
        isFavorite: dto.isFavorite,
      },
      include: this.assetInclude,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.asset.delete({ where: { id } });

    return {
      deleted: true,
      id,
    };
  }

  private async validateRelations(
    brandId: string,
    campaignId?: string | null,
    historyId?: string | null,
  ) {
    if (campaignId) {
      const campaign = await this.prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brandId,
        },
        select: { id: true },
      });

      if (!campaign) {
        throw new BadRequestException(
          'Campaign was not found for the active brand.',
        );
      }
    }

    if (historyId) {
      const history = await this.prisma.generationHistory.findFirst({
        where: {
          id: historyId,
          brandId,
        },
        select: { id: true },
      });

      if (!history) {
        throw new BadRequestException(
          'History record was not found for the active brand.',
        );
      }
    }
  }

  private readonly assetInclude = {
    brand: {
      select: {
        id: true,
        name: true,
      },
    },
    campaign: {
      select: {
        id: true,
        name: true,
      },
    },
    history: {
      select: {
        id: true,
        topic: true,
      },
    },
  } as const;
}
