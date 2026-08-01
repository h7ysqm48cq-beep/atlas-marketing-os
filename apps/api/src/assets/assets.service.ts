import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
    private readonly storageService: SupabaseStorageService,
  ) {}

  async upload(input: {
    file?: Express.Multer.File;
    name?: string;
    collection?: string;
    campaignId?: string;
  }) {
    if (!input.file) {
      throw new BadRequestException('Image file is required.');
    }

    const brand = await this.brandsService.getActiveBrand();

    if (input.campaignId) {
      await this.validateRelations(brand.id, input.campaignId, undefined);
    }

    const originalExtension = extname(input.file.originalname).toLowerCase();

    const safeExtension =
      originalExtension === '.jpeg'
        ? '.jpg'
        : ['.jpg', '.png', '.webp'].includes(originalExtension)
          ? originalExtension
          : this.extensionFromMimeType(input.file.mimetype);

    const storagePath = [
      'brands',
      brand.id,
      'uploads',
      new Date().getUTCFullYear().toString(),
      String(new Date().getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}${safeExtension}`,
    ].join('/');

    const uploaded = await this.storageService.uploadImage({
      path: storagePath,
      buffer: input.file.buffer,
      contentType: input.file.mimetype,
    });

    try {
      return await this.prisma.asset.create({
        data: {
          brandId: brand.id,
          campaignId: input.campaignId || undefined,
          name: input.name?.trim() || input.file.originalname,
          type: 'IMAGE',
          provider: 'user-upload',
          url: uploaded.publicUrl,
          thumbnailUrl: uploaded.publicUrl,
          storageProvider: uploaded.provider,
          storagePath: uploaded.path,
          fileSize: uploaded.size,
          mimeType: uploaded.contentType,
          collection: input.collection?.trim() || 'Uploads',
          tags: ['uploaded'],
          remark: null,
          aiEnabled: false,
        },
        include: this.assetInclude,
      });
    } catch (error) {
      await this.storageService.remove(uploaded.path).catch(() => undefined);

      throw error;
    }
  }

  private extensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      default:
        throw new BadRequestException('Unsupported image format.');
    }
  }

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
        revisedPrompt: dto.revisedPrompt,
        negativePrompt: dto.negativePrompt,
        generationModel: dto.generationModel,
        generationSize: dto.generationSize,
        generationQuality: dto.generationQuality,
        generationDurationMs: dto.generationDurationMs,
        storageProvider: dto.storageProvider,
        storagePath: dto.storagePath,
        fileSize: dto.fileSize,
        tags: dto.tags,
        collection: dto.collection,
        remark: dto.remark?.trim() || null,
        aiEnabled: dto.aiEnabled ?? false,
        downloadCount: dto.downloadCount,
        usedCount: dto.usedCount,
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
    tag?: string;
    collection?: string;
    platform?: string;
    provider?: string;
    generationModel?: string;
    storageProvider?: string;
    sort?: string;
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
        platform: query?.platform || undefined,
        provider: query?.provider || undefined,
        generationModel: query?.generationModel || undefined,
        storageProvider: query?.storageProvider || undefined,
        collection: query?.collection || undefined,
        tags: query?.tag
          ? {
              has: query.tag,
            }
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
                revisedPrompt: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                negativePrompt: {
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
              {
                collection: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ]
          : undefined,
      },
      orderBy:
        query?.sort === 'downloads'
          ? {
              downloadCount: 'desc',
            }
          : query?.sort === 'used'
            ? {
                usedCount: 'desc',
              }
            : query?.sort === 'oldest'
              ? {
                  createdAt: 'asc',
                }
              : query?.sort === 'name'
                ? {
                    name: 'asc',
                  }
                : {
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
        revisedPrompt: dto.revisedPrompt,
        negativePrompt: dto.negativePrompt,
        generationModel: dto.generationModel,
        generationSize: dto.generationSize,
        generationQuality: dto.generationQuality,
        generationDurationMs: dto.generationDurationMs,
        storageProvider: dto.storageProvider,
        storagePath: dto.storagePath,
        fileSize: dto.fileSize,
        tags: dto.tags,
        collection: dto.collection,
        remark:
          dto.remark === undefined
            ? undefined
            : dto.remark?.trim() || null,
        aiEnabled: dto.aiEnabled,
        downloadCount: dto.downloadCount,
        usedCount: dto.usedCount,
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
