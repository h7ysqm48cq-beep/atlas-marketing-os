import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { GenerateAssetImageDto } from './dto/generate-asset-image.dto';
import { BrandImageService } from '../brand-image/brand-image.service';

@Injectable()
export class AssetImageService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
    private readonly storageService: SupabaseStorageService,
    private readonly brandImageService: BrandImageService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async generateAndSave(dto: GenerateAssetImageDto) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured in apps/api/.env',
      );
    }

    const brand = await this.brandsService.getActiveBrand();

    const brandImageContext =
      this.brandImageService.build(brand);
    await this.validateRelations(brand.id, dto.campaignId, dto.historyId);

    const model =
      this.configService.get<string>('OPENAI_IMAGE_MODEL') || 'gpt-image-1';
    const size = dto.size || '1024x1536';
    const quality = dto.quality || 'medium';
    const generationStartedAt = Date.now();

    try {
      const response = await this.client.images.generate({
        model,
        prompt: `
${dto.prompt}

BRAND IMAGE REQUIREMENTS

Logo:
${brandImageContext.logoInstruction}

Footer:
${brandImageContext.footerInstruction}

QR:
${brandImageContext.qrInstruction}

Visual:
${brandImageContext.visualInstruction}

Rules:
${brandImageContext.rulesInstruction}
`, 
        size,
        quality,
        output_format: 'png',
      });

      const imageData = response.data?.[0];
      const base64 = imageData?.b64_json;

      if (!base64) {
        throw new Error('The image API did not return base64 image data.');
      }

      const shortName = this.slugify(dto.name).slice(0, 40);

      const uniqueId = randomUUID().replace(/-/g, '').slice(0, 8);

      const filename = `${Date.now()}-${shortName}-${uniqueId}.png`;
      const imageBuffer = Buffer.from(base64, 'base64');

      const now = new Date();
      const year = String(now.getUTCFullYear());
      const month = String(now.getUTCMonth() + 1).padStart(2, '0');

      const storagePath = ['brands', brand.id, year, month, filename].join('/');

      const uploaded = await this.storageService.uploadImage({
        buffer: imageBuffer,
        path: storagePath,
        contentType: 'image/png',
      });

      const url = uploaded.publicUrl;
      const [width, height] = size.split('x').map(Number);

      const asset = await this.prisma.asset.create({
        data: {
          brandId: brand.id,
          campaignId: dto.campaignId,
          historyId: dto.historyId,
          name: dto.name,
          type: 'IMAGE',
          provider: model,
          platform: dto.platform || 'Multi-platform',
          prompt: dto.prompt,
          revisedPrompt:
            'revised_prompt' in imageData
              ? imageData.revised_prompt
              : undefined,
          generationModel: model,
          generationSize: size,
          generationQuality: quality,
          generationDurationMs: Date.now() - generationStartedAt,
          storageProvider: uploaded.provider,
          storagePath: uploaded.path,
          fileSize: uploaded.size,
          tags: [
            'ai-generated',
            dto.platform?.toLowerCase() ?? 'multi-platform',
          ],
          url,
          thumbnailUrl: url,
          mimeType: 'image/png',
          width,
          height,
        },
        include: {
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
        },
      });

      return {
        asset,
        generation: {
          model,
          size,
          quality,
          revisedPrompt:
            'revised_prompt' in imageData
              ? imageData.revised_prompt
              : undefined,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown image generation error';

      throw new InternalServerErrorException(
        `Image generation failed: ${message}`,
      );
    }
  }

  private async validateRelations(
    brandId: string,
    campaignId?: string,
    historyId?: string,
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

  private slugify(value: string) {
    const safe = value
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();

    return safe || 'atlas-image';
  }
}
