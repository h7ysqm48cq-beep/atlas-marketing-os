import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRuntimeSettingsService } from '../ai-runtime/ai-runtime-settings.service';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { LogoOverlayService, LogoPlacement } from '../image/logo';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { ImagePostProcessorService } from '../image-processing/image-post-processor.service';
import {
  BrandExistingAssetDto,
  ExistingAssetLogoPlacement,
} from './dto/brand-existing-asset.dto';
import { GenerateAssetImageDto } from './dto/generate-asset-image.dto';

import { ImageSettingsService } from '../image-settings/image-settings.service';
import { BrandRendererService } from '../brand-renderer/brand-renderer.service';
import {
  buildAssetThumbnailPath,
  createAssetThumbnail,
} from '../assets/asset-thumbnail.util';
@Injectable()
export class AssetImageService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly brandRenderer: BrandRendererService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
    private readonly storageService: SupabaseStorageService,
    private readonly logoOverlayService: LogoOverlayService,
    private readonly aiRuntime: AiRuntimeSettingsService,
    private readonly imageSettings: ImageSettingsService,
    private readonly imagePostProcessor: ImagePostProcessorService,
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

    const model = dto.model?.trim() || (await this.aiRuntime.getImageModel());
    const size = dto.size || '1024x1536';
    const quality = dto.quality || 'medium';
    const generationStartedAt = Date.now();

    try {
      const imagePolicy = await this.aiRuntime.applyImageGenerationPolicy(
        dto.prompt,
      );
      const response = await this.client.images.generate({
        model,
        prompt: imagePolicy.prompt,
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

      const imageSetting =
        await this.imageSettings.get({
          pageId: dto.pageId,
          channelId: dto.channelId,
        });

      // Independent Corner Logo.
      // Brand Signature logo is controlled separately
      // by footerLogoMode.
      /*
       * Corner Logo
       *
       * Source of truth:
       * ImageGenerationSetting
       * Workspace / Page / Channel inheritance.
       */
      const cornerLogoEnabled =
        imageSetting.cornerLogoEnabled ??
        false;

      const cornerLogoPlacement =
        this.resolveLogoPlacement(
          (
            imageSetting.cornerLogoPlacement ??
            'TOP_RIGHT'
          ) as keyof typeof LogoPlacement,
        );

      const cornerLogoScale =
        imageSetting.cornerLogoScale ??
        1;

      const cornerLogoOpacity =
        imageSetting.cornerLogoOpacity ??
        1;

      /*
       * Prevent Corner Logo from occupying
       * the same bottom zone as Brand Signature.
       *
       * Brand Signature has priority.
       * Conflicting Corner Logo moves to TOP_RIGHT.
       */
      const footerCornerConflict =
        imageSetting.brandFooterEnabled &&
        Boolean(
          imageSetting.footerText?.trim(),
        ) &&
        (
          (
            imageSetting.footerPosition ===
              'bottom-left' &&
            cornerLogoPlacement ===
              'BOTTOM_LEFT'
          ) ||
          (
            imageSetting.footerPosition ===
              'bottom-center' &&
            cornerLogoPlacement ===
              'BOTTOM_CENTER'
          ) ||
          (
            imageSetting.footerPosition ===
              'bottom-right' &&
            cornerLogoPlacement ===
              'BOTTOM_RIGHT'
          )
        );

      const effectiveCornerLogoPlacement =
        footerCornerConflict
          ? this.resolveLogoPlacement(
              'TOP_RIGHT',
            )
          : cornerLogoPlacement;

      const footerLogoMode =
        imageSetting.footerLogoMode ??
        'auto';

      const signatureLogoEnabled =
        imageSetting.brandFooterEnabled &&
        footerLogoMode !== 'hide';

      const processedImageBuffer =
        await this.imagePostProcessor.process(
          imageBuffer,
          {
            textOverlayEnabled:
              imageSetting.textOverlayEnabled,

            brandFooterEnabled:
              false,

            footerText:
              undefined,

            footerPosition:
              undefined,

            footerStyle:
              undefined,

            brandLogo:
              undefined,

            logoEnabled:
              false,
          },
          dto.name,
        );

      /*
       * Independent Corner Logo
       *
       * ALWAYS = ON
       * NEVER  = OFF
       * AUTO   = backward-compatible conditional mode
       */
      

      const finalImageBuffer =
        await this.brandRenderer.render(
          {
            brandId: brand.id,
            pageId: dto.pageId,
            channelId: dto.channelId,

            workspaceSetting:
              imageSetting,

            imageWidth: width,
            imageHeight: height,
            buffer: processedImageBuffer,
          },
        );

      const now = new Date();
      const year = String(now.getUTCFullYear());
      const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      const storagePath = ['brands', brand.id, year, month, filename].join('/');

      const uploaded = await this.storageService.uploadImage({
        buffer: finalImageBuffer,
        path: storagePath,
        contentType: 'image/png',
      });

      const thumbnailPath =
        buildAssetThumbnailPath(
          brand.id,
          now,
          filename,
        );

      let thumbnail;

      try {
        const thumbnailBuffer =
          await createAssetThumbnail(
            finalImageBuffer,
          );

        thumbnail =
          await this.storageService.uploadImage({
            buffer: thumbnailBuffer,
            path: thumbnailPath,
            contentType: 'image/webp',
          });
      } catch (error) {
        await this.storageService
          .remove(uploaded.path)
          .catch(() => undefined);

        throw error;
      }

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
          prompt: imagePolicy.prompt,
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
            cornerLogoEnabled ? 'corner-logo-overlay' : 'corner-logo-skipped',
            `corner-logo-${cornerLogoEnabled ? 'enabled' : 'disabled'}`,
            `logo-placement-${effectiveCornerLogoPlacement.toLowerCase()}`,
            `corner-logo-scale-${cornerLogoScale}`,
            `corner-logo-opacity-${cornerLogoOpacity}`,
          ],
          url,
          thumbnailUrl: thumbnail.publicUrl,
          mimeType: 'image/png',
          width,
          height,
        },
        include: {
          brand: { select: { id: true, name: true } },
          campaign: { select: { id: true, name: true } },
          history: { select: { id: true, topic: true } },
        },
      });

      return {
        asset,
        generation: {
          model,
          size,
          quality,
          cornerLogoPlacement:
            effectiveCornerLogoPlacement,
          cornerLogoScale:
            cornerLogoScale,
          cornerLogoOpacity:
            cornerLogoOpacity,
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

  async brandExistingAsset(dto: BrandExistingAssetDto) {
    const brand = await this.brandsService.getActiveBrand();

    const sourceAsset = await this.prisma.asset.findFirst({
      where: {
        id: dto.assetId,
        brandId: brand.id,
        type: 'IMAGE',
      },
    });

    if (!sourceAsset) {
      throw new NotFoundException(
        'Image asset was not found for the active brand.',
      );
    }

    if (!sourceAsset.url?.startsWith('https://')) {
      throw new BadRequestException(
        'The selected image does not have a usable URL.',
      );
    }

    const sourceResponse = await fetch(sourceAsset.url);

    if (!sourceResponse.ok) {
      throw new BadRequestException(
        `Unable to download the selected image (HTTP ${sourceResponse.status}).`,
      );
    }

    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
    const metadata = await sharp(sourceBuffer).metadata();
    const width = metadata.width ?? sourceAsset.width;
    const height = metadata.height ?? sourceAsset.height;

    if (!width || !height) {
      throw new BadRequestException(
        'Unable to determine the selected image size.',
      );
    }

    const placement = this.resolveExistingLogoPlacement(dto.logoPlacement);
    const scale = dto.logoScale ?? 0.85;
    const opacity = dto.logoOpacity ?? 0.9;
    const platform = dto.platform || sourceAsset.platform || 'Multi-platform';
    const hasCustomPosition =
      Number.isFinite(dto.logoX) && Number.isFinite(dto.logoY);

    const finalBuffer = await this.brandRenderer.render({
      brandId: brand.id,

      brandBrainRules: {
        visualPolicy: {
          visualStyle: brand.visualStyle,
        },
        promptPolicy: {
          negativePrompt:
            sourceAsset.negativePrompt ?? null,
        },
        brandRules: brand.brandRules,
        brandKit: brand.brandKit,
      },

      imageWidth: width,
      imageHeight: height,
      buffer: sourceBuffer,
    }, {
      logoEnabled: true,
      placement,
      scale,
      opacity,
      platform,
      normalizedX:
        hasCustomPosition
          ? dto.logoX
          : undefined,
      normalizedY:
        hasCustomPosition
          ? dto.logoY
          : undefined,
    });

    const outputName = dto.name?.trim() || `${sourceAsset.name} · Branded`;
    const shortName = this.slugify(outputName).slice(0, 40);
    const uniqueId = randomUUID().replace(/-/g, '').slice(0, 8);
    const filename = `${Date.now()}-${shortName}-${uniqueId}.png`;
    const now = new Date();
    const storagePath = [
      'brands',
      brand.id,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      filename,
    ].join('/');

    const uploaded = await this.storageService.uploadImage({
      buffer: finalBuffer,
      path: storagePath,
      contentType: 'image/png',
    });

    const thumbnailPath =
      buildAssetThumbnailPath(
        brand.id,
        now,
        filename,
      );

    let thumbnail;

    try {
      const thumbnailBuffer =
        await createAssetThumbnail(
          finalBuffer,
        );

      thumbnail =
        await this.storageService.uploadImage({
          buffer: thumbnailBuffer,
          path: thumbnailPath,
          contentType: 'image/webp',
        });
    } catch (error) {
      await this.storageService
        .remove(uploaded.path)
        .catch(() => undefined);

      throw error;
    }

    return this.prisma.asset.create({
      data: {
        brandId: brand.id,
        campaignId: sourceAsset.campaignId,
        historyId: sourceAsset.historyId,
        name: outputName,
        type: 'IMAGE',
        provider: 'atlas-logo-engine',
        platform,
        prompt: sourceAsset.prompt,
        revisedPrompt: sourceAsset.revisedPrompt,
        generationModel: sourceAsset.generationModel,
        generationSize: `${width}x${height}`,
        generationQuality: sourceAsset.generationQuality,
        storageProvider: uploaded.provider,
        storagePath: uploaded.path,
        fileSize: uploaded.size,
        remark: `Branded from asset ${sourceAsset.id}`,
        aiEnabled: false,
        tags: [
          ...sourceAsset.tags,
          'image-edited',
          'logo-overlay',
          `source-asset-${sourceAsset.id}`,
          hasCustomPosition
            ? 'logo-placement-custom'
            : `logo-placement-${placement.toLowerCase()}`,
          `logo-scale-${scale}`,
          `logo-opacity-${opacity}`,
          ...(hasCustomPosition
            ? [
                `logo-x-${dto.logoX?.toFixed(4)}`,
                `logo-y-${dto.logoY?.toFixed(4)}`,
              ]
            : []),
        ],
        url: uploaded.publicUrl,
        thumbnailUrl: thumbnail.publicUrl,
        mimeType: 'image/png',
        width,
        height,
      },
      include: {
        brand: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        history: { select: { id: true, topic: true } },
      },
    });
  }

  private resolveLogoPlacement(
    placement?: keyof typeof LogoPlacement,
  ): LogoPlacement {
    return placement ? LogoPlacement[placement] : LogoPlacement.AUTO;
  }

  private resolveExistingLogoPlacement(
    placement?: ExistingAssetLogoPlacement,
  ): LogoPlacement {
    return placement ? LogoPlacement[placement] : LogoPlacement.AUTO;
  }



  private async validateRelations(
    brandId: string,
    campaignId?: string,
    historyId?: string,
  ) {
    if (campaignId) {
      const campaign = await this.prisma.campaign.findFirst({
        where: { id: campaignId, brandId },
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
        where: { id: historyId, brandId },
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
