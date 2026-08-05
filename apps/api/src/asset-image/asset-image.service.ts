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
import { LogoOverlayService, LogoPlacement } from '../image/logo';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { GenerateAssetImageDto } from './dto/generate-asset-image.dto';

@Injectable()
export class AssetImageService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
    private readonly storageService: SupabaseStorageService,
    private readonly logoOverlayService: LogoOverlayService,
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
    await this.validateRelations(brand.id, dto.campaignId, dto.historyId);

    const model =
      this.configService.get<string>('OPENAI_IMAGE_MODEL') || 'gpt-image-2';
    const size = dto.size || '1024x1536';
    const quality = dto.quality || 'medium';
    const generationStartedAt = Date.now();

    try {
      const response = await this.client.images.generate({
        model,
        prompt: dto.prompt,
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
      const [width, height] = size.split('x').map(Number);

      const logoMode = dto.logoMode ?? 'AUTO';
      const logoPlacement = this.resolveLogoPlacement(dto.logoPlacement);
      const shouldOverlayLogo = this.shouldOverlayLogo({
        mode: logoMode,
        platform: dto.platform,
        name: dto.name,
        prompt: dto.prompt,
      });

      const finalImageBuffer = shouldOverlayLogo
        ? await this.applyPrimaryLogo({
            brandId: brand.id,
            primaryLogoAssetId: brand.primaryLogoAssetId,
            imageBuffer,
            width,
            height,
            platform: dto.platform,
            placement: logoPlacement,
          })
        : imageBuffer;

      const now = new Date();
      const year = String(now.getUTCFullYear());
      const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      const storagePath = ['brands', brand.id, year, month, filename].join('/');

      const uploaded = await this.storageService.uploadImage({
        buffer: finalImageBuffer,
        path: storagePath,
        contentType: 'image/png',
      });

      const url = uploaded.publicUrl;

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
          remark: null,
          aiEnabled: false,
          tags: [
            'ai-generated',
            dto.platform?.toLowerCase() ?? 'multi-platform',
            shouldOverlayLogo ? 'logo-overlay' : 'logo-skipped',
            `logo-mode-${logoMode.toLowerCase()}`,
            `logo-placement-${logoPlacement.toLowerCase()}`,
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
          logoPlacement,
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

  private resolveLogoPlacement(
    placement?: GenerateAssetImageDto['logoPlacement'],
  ): LogoPlacement {
    if (!placement) {
      return LogoPlacement.AUTO;
    }

    return LogoPlacement[placement];
  }

  private shouldOverlayLogo(input: {
    mode: 'AUTO' | 'ALWAYS' | 'NEVER';
    platform?: string;
    name: string;
    prompt: string;
  }): boolean {
    if (input.mode === 'ALWAYS') {
      return true;
    }

    if (input.mode === 'NEVER') {
      return false;
    }

    const searchableText = [input.platform, input.name, input.prompt]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const skipKeywords = [
      'background only',
      'plain background',
      'background asset',
      'reference image',
      'style reference',
      'visual reference',
      'moodboard',
      'mood board',
      'texture',
      'raw portrait',
      'portrait reference',
      'editing source',
      'source image',
      'transparent asset',
      'transparent background',
      'product cutout',
      'cutout',
      'mask image',
      'image mask',
      'logo design',
      'design a logo',
      'create a logo',
      'unbranded',
      'without branding',
      'without logo',
      'no logo',
    ];

    return !skipKeywords.some((keyword) => searchableText.includes(keyword));
  }

  private async applyPrimaryLogo(input: {
    brandId: string;
    primaryLogoAssetId?: string | null;
    imageBuffer: Buffer;
    width: number;
    height: number;
    platform?: string;
    placement: LogoPlacement;
  }): Promise<Buffer> {
    const logoAssetId = input.primaryLogoAssetId?.trim();

    if (!logoAssetId) {
      return input.imageBuffer;
    }

    const logoAsset = await this.prisma.asset.findFirst({
      where: {
        id: logoAssetId,
        brandId: input.brandId,
        type: 'IMAGE',
        aiEnabled: true,
      },
      select: {
        id: true,
        name: true,
        url: true,
        mimeType: true,
      },
    });

    if (!logoAsset?.url || !logoAsset.url.startsWith('https://')) {
      return input.imageBuffer;
    }

    try {
      const logoResponse = await fetch(logoAsset.url);

      if (!logoResponse.ok) {
        throw new Error(
          `Logo download returned HTTP ${logoResponse.status}.`,
        );
      }

      const logoBuffer = Buffer.from(await logoResponse.arrayBuffer());

      return await this.logoOverlayService.overlay({
        image: input.imageBuffer,
        logo: logoBuffer,
        width: input.width,
        height: input.height,
        platform: input.platform,
        placement: input.placement,
      });
    } catch (error) {
      console.warn(
        [
          '[AssetImageService]',
          'Primary logo overlay skipped.',
          error instanceof Error
            ? error.message
            : 'Unknown logo processing error.',
        ].join(' '),
      );

      return input.imageBuffer;
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
