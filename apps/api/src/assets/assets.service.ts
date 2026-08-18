import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
    private readonly storage: SupabaseStorageService,
  ) {}

  async upload(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Image file is required.');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are supported.');
    }

    const brand = await this.brandsService.getActiveBrand();
    const path = `calendar/${brand.id}/${Date.now()}-${file.originalname}`;

    const uploaded = await this.storage.uploadImage({
      path,
      buffer: file.buffer,
      contentType: file.mimetype,
    });

    return this.prisma.asset.create({
      data: {
        brandId: brand.id,
        name: file.originalname,
        type: 'IMAGE',
        url: uploaded.publicUrl,
        storageProvider: uploaded.provider,
        storagePath: uploaded.path,
        fileSize: uploaded.size,
        mimeType: uploaded.contentType,
      },
    });
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
        type: query?.type && query.type !== 'ALL' ? query.type as never : undefined,
        OR: search
          ? [{ name: { contains: search, mode: 'insensitive' } }]
          : undefined,
      },
      orderBy: { createdAt: 'desc' },
      include: this.assetInclude,
    });
  }

  async findOne(id: string) {
    const brand = await this.brandsService.getActiveBrand();
    const asset = await this.prisma.asset.findFirst({ where: { id, brandId: brand.id }, include: this.assetInclude });
    if (!asset) throw new NotFoundException('Asset not found.');
    return asset;
  }

  async update(id: string, dto: UpdateAssetDto) {
    await this.findOne(id);
    return this.prisma.asset.update({ where: { id }, data: dto, include: this.assetInclude });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.asset.delete({ where: { id } });
    return { deleted: true, id };
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
    brand: { select: { id: true, name: true } },
  } as const;
}
