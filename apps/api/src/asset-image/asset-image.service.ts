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
import { UpdateAssetBrandingDto } from './dto/update-asset-branding.dto';

import { ImageSettingsService } from '../image-settings/image-settings.service';
import { BrandRendererService } from '../brand-renderer/brand-renderer.service';
import {
  buildAssetThumbnailPath,
  createAssetThumbnail,
} from '../assets/asset-thumbnail.util';
@Injectable()
export class AssetImageService {
  private readonly client: OpenAI | null;
  private readonly sourcePathTagPrefix = 'atlas-source-path:';

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
    const requestedOutput = this.resolveOutputDimensions(dto);
    const size = dto.size || this.resolveProviderSize(requestedOutput);
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
      const sourceImageBuffer = Buffer.from(base64, 'base64');
      const sourceMetadata = await sharp(sourceImageBuffer).metadata();
      const width = requestedOutput?.width ?? sourceMetadata.width ?? 1024;
      const height = requestedOutput?.height ?? sourceMetadata.height ?? 1536;
      const imageBuffer = requestedOutput
        ? await sharp(sourceImageBuffer)
            .resize({
              width,
              height,
              fit: 'cover',
              position: 'attention',
            })
            .png()
            .toBuffer()
        : sourceImageBuffer;

      const imageSetting = await this.imageSettings.get({
        pageId: dto.pageId,
        channelId: dto.channelId,
      });

      const textOverlayText = (
        dto.textOverlayText !== undefined
          ? dto.textOverlayText
          : (imageSetting.textOverlayText ?? '')
      ).trim();

      const textOverlayEnabled =
        Boolean(textOverlayText) &&
        dto.textOverlayMode !== 'NEVER' &&
        (dto.textOverlayMode === 'ALWAYS' || imageSetting.textOverlayEnabled);

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
        dto.logoMode === 'NEVER'
          ? false
          : dto.logoMode === 'ALWAYS'
            ? true
            : (imageSetting.cornerLogoEnabled ?? false);

      const cornerLogoPlacement = this.resolveLogoPlacement(
        (dto.logoPlacement ??
          imageSetting.cornerLogoPlacement ??
          'TOP_RIGHT') as keyof typeof LogoPlacement,
      );

      const cornerLogoScale =
        dto.logoScale ?? imageSetting.cornerLogoScale ?? 1;

      const cornerLogoOpacity =
        dto.logoOpacity ?? imageSetting.cornerLogoOpacity ?? 1;

      const brandFooterEnabled =
        dto.brandFooterMode === 'NEVER'
          ? false
          : dto.brandFooterMode === 'ALWAYS'
            ? true
            : imageSetting.brandFooterEnabled;

      const footerText = (
        dto.footerText !== undefined
          ? dto.footerText
          : (imageSetting.footerText ?? '')
      ).trim();

      const footerLogoMode =
        dto.footerLogoMode?.toLowerCase() ??
        imageSetting.footerLogoMode ??
        'auto';

      const signatureLogoEnabled =
        brandFooterEnabled && footerLogoMode !== 'hide';

      /*
       * Prevent Corner Logo from occupying
       * the same bottom zone as Brand Signature.
       *
       * Brand Signature has priority.
       * Conflicting Corner Logo moves to TOP_RIGHT.
       */
      const footerCornerConflict =
        brandFooterEnabled &&
        (Boolean(footerText) || signatureLogoEnabled) &&
        ((imageSetting.footerPosition === 'bottom-left' &&
          cornerLogoPlacement === LogoPlacement.BOTTOM_LEFT) ||
          (imageSetting.footerPosition === 'bottom-center' &&
            cornerLogoPlacement === LogoPlacement.BOTTOM_CENTER) ||
          (imageSetting.footerPosition === 'bottom-right' &&
            cornerLogoPlacement === LogoPlacement.BOTTOM_RIGHT));

      const effectiveCornerLogoPlacement = footerCornerConflict
        ? this.resolveLogoPlacement('TOP_RIGHT')
        : cornerLogoPlacement;

      const primaryLogoBuffer =
        signatureLogoEnabled || cornerLogoEnabled
          ? await this.brandRenderer.loadPrimaryLogoBuffer({
              brandId: brand.id,
              primaryLogoAssetId: brand.primaryLogoAssetId,
            })
          : null;

      const processedImageBuffer = await this.imagePostProcessor.process(
        imageBuffer,
        {
          textOverlayEnabled: textOverlayEnabled,

          brandFooterEnabled: brandFooterEnabled,

          footerText: footerText,

          footerPosition: imageSetting.footerPosition,

          footerStyle: imageSetting.footerStyle,

          brandLogo: primaryLogoBuffer ?? undefined,

          logoEnabled: signatureLogoEnabled && Boolean(primaryLogoBuffer),
        },
        textOverlayText,
      );

      /*
       * Independent Corner Logo
       *
       * ALWAYS = ON
       * NEVER  = OFF
       * AUTO   = backward-compatible conditional mode
       */

      const finalImageBuffer = await this.brandRenderer.render(
        {
          brandId: brand.id,
          pageId: dto.pageId,
          channelId: dto.channelId,

          workspaceSetting: {
            ...imageSetting,
            brandFooterEnabled: false,
            primaryLogoAssetId: brand.primaryLogoAssetId,
          },

          imageWidth: width,
          imageHeight: height,
          buffer: processedImageBuffer,
        },
        {
          logoEnabled: cornerLogoEnabled && Boolean(primaryLogoBuffer),
          logoBuffer: primaryLogoBuffer ?? undefined,
          placement: effectiveCornerLogoPlacement,
          scale: cornerLogoScale,
          opacity: cornerLogoOpacity,
          platform: dto.platform,
        },
      );

      const now = new Date();
      const year = String(now.getUTCFullYear());
      const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      const storagePath = ['brands', brand.id, year, month, filename].join('/');
      const sourceStoragePath = [
        'brands',
        brand.id,
        year,
        month,
        'sources',
        filename,
      ].join('/');

      const sourceUploaded = await this.storageService.uploadImage({
        buffer: imageBuffer,
        path: sourceStoragePath,
        contentType: 'image/png',
      });

      let uploaded: Awaited<ReturnType<SupabaseStorageService['uploadImage']>>;

      try {
        uploaded = await this.storageService.uploadImage({
          buffer: finalImageBuffer,
          path: storagePath,
          contentType: 'image/png',
        });
      } catch (error) {
        await this.storageService
          .remove(sourceUploaded.path)
          .catch(() => undefined);

        throw error;
      }

      const thumbnailPath = buildAssetThumbnailPath(brand.id, now, filename);

      let thumbnail: Awaited<ReturnType<SupabaseStorageService['uploadImage']>>;

      try {
        const thumbnailBuffer = await createAssetThumbnail(finalImageBuffer);

        thumbnail = await this.storageService.uploadImage({
          buffer: thumbnailBuffer,
          path: thumbnailPath,
          contentType: 'image/webp',
        });
      } catch (error) {
        await Promise.all([
          this.storageService.remove(uploaded.path).catch(() => undefined),
          this.storageService
            .remove(sourceUploaded.path)
            .catch(() => undefined),
        ]);

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
            `text-overlay-${textOverlayEnabled ? 'enabled' : 'disabled'}`,
            cornerLogoEnabled && primaryLogoBuffer
              ? 'corner-logo-overlay'
              : 'corner-logo-skipped',
            `corner-logo-${cornerLogoEnabled ? 'enabled' : 'disabled'}`,
            `brand-footer-${brandFooterEnabled ? 'enabled' : 'disabled'}`,
            signatureLogoEnabled && primaryLogoBuffer
              ? 'footer-logo-overlay'
              : 'footer-logo-skipped',
            `output-${width}x${height}`,
            `logo-placement-${effectiveCornerLogoPlacement.toLowerCase()}`,
            `corner-logo-scale-${cornerLogoScale}`,
            `corner-logo-opacity-${cornerLogoOpacity}`,
            `${this.sourcePathTagPrefix}${sourceUploaded.path}`,
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
          outputWidth: width,
          outputHeight: height,
          aspectRatio: dto.aspectRatio ?? `${width}:${height}`,
          cornerLogoPlacement: effectiveCornerLogoPlacement,
          cornerLogoScale: cornerLogoScale,
          cornerLogoOpacity: cornerLogoOpacity,
          brandFooterEnabled,
          footerLogoEnabled: signatureLogoEnabled && Boolean(primaryLogoBuffer),
          cornerLogoEnabled: cornerLogoEnabled && Boolean(primaryLogoBuffer),
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

  async updateBranding(assetId: string, dto: UpdateAssetBrandingDto) {
    const brand = await this.brandsService.getActiveBrand();
    const sourceAsset = await this.prisma.asset.findFirst({
      where: {
        id: assetId,
        brandId: brand.id,
        type: 'IMAGE',
      },
    });

    if (!sourceAsset) {
      throw new NotFoundException(
        'Image asset was not found for the active brand.',
      );
    }

    const sourcePathTag = sourceAsset.tags.find((tag) =>
      tag.startsWith(this.sourcePathTagPrefix),
    );
    const sourcePath = sourcePathTag?.slice(this.sourcePathTagPrefix.length);

    if (!sourcePath) {
      throw new BadRequestException(
        'This image predates save-time branding controls. Regenerate it once to create a clean source image.',
      );
    }

    const sourceBuffer = await this.storageService.download(sourcePath);
    const metadata = await sharp(sourceBuffer).metadata();
    const width = metadata.width ?? sourceAsset.width;
    const height = metadata.height ?? sourceAsset.height;

    if (!width || !height) {
      throw new BadRequestException(
        'Unable to determine the selected image size.',
      );
    }

    const imageSetting = await this.imageSettings.get({
      pageId: dto.pageId,
      channelId: dto.channelId,
    });
    const textOverlayText = imageSetting.textOverlayText?.trim() ?? '';
    const textOverlayEnabled =
      imageSetting.textOverlayEnabled && Boolean(textOverlayText);
    const brandFooterEnabled = dto.brandFooterEnabled;
    const footerText = imageSetting.footerText?.trim() ?? '';
    const signatureLogoEnabled = brandFooterEnabled && dto.footerLogoEnabled;
    const cornerLogoEnabled = dto.cornerLogoEnabled;
    const cornerLogoPlacement = this.resolveLogoPlacement(
      (imageSetting.cornerLogoPlacement ??
        'TOP_RIGHT') as keyof typeof LogoPlacement,
    );
    const cornerLogoScale = imageSetting.cornerLogoScale ?? 1;
    const cornerLogoOpacity = imageSetting.cornerLogoOpacity ?? 1;
    const footerCornerConflict =
      brandFooterEnabled &&
      (Boolean(footerText) || signatureLogoEnabled) &&
      ((imageSetting.footerPosition === 'bottom-left' &&
        cornerLogoPlacement === LogoPlacement.BOTTOM_LEFT) ||
        (imageSetting.footerPosition === 'bottom-center' &&
          cornerLogoPlacement === LogoPlacement.BOTTOM_CENTER) ||
        (imageSetting.footerPosition === 'bottom-right' &&
          cornerLogoPlacement === LogoPlacement.BOTTOM_RIGHT));
    const effectiveCornerLogoPlacement = footerCornerConflict
      ? LogoPlacement.TOP_RIGHT
      : cornerLogoPlacement;
    const primaryLogoBuffer =
      signatureLogoEnabled || cornerLogoEnabled
        ? await this.brandRenderer.loadPrimaryLogoBuffer({
            brandId: brand.id,
            primaryLogoAssetId: brand.primaryLogoAssetId,
          })
        : null;

    const processedImageBuffer = await this.imagePostProcessor.process(
      sourceBuffer,
      {
        textOverlayEnabled,
        brandFooterEnabled,
        footerText,
        footerPosition: imageSetting.footerPosition,
        footerStyle: imageSetting.footerStyle,
        brandLogo: primaryLogoBuffer ?? undefined,
        logoEnabled: signatureLogoEnabled && Boolean(primaryLogoBuffer),
      },
      textOverlayText,
    );

    const finalImageBuffer = await this.brandRenderer.render(
      {
        brandId: brand.id,
        pageId: dto.pageId,
        channelId: dto.channelId,
        workspaceSetting: {
          ...imageSetting,
          brandFooterEnabled: false,
          primaryLogoAssetId: brand.primaryLogoAssetId,
        },
        imageWidth: width,
        imageHeight: height,
        buffer: processedImageBuffer,
      },
      {
        logoEnabled: cornerLogoEnabled && Boolean(primaryLogoBuffer),
        logoBuffer: primaryLogoBuffer ?? undefined,
        placement: effectiveCornerLogoPlacement,
        scale: cornerLogoScale,
        opacity: cornerLogoOpacity,
        platform: sourceAsset.platform ?? undefined,
      },
    );

    const now = new Date();
    const uniqueId = randomUUID().replace(/-/g, '').slice(0, 8);
    const filename = `${Date.now()}-copilot-branding-${uniqueId}.png`;
    const storagePath = [
      'brands',
      brand.id,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      filename,
    ].join('/');
    const thumbnailPath = buildAssetThumbnailPath(brand.id, now, filename);
    const uploaded = await this.storageService.uploadImage({
      buffer: finalImageBuffer,
      path: storagePath,
      contentType: 'image/png',
    });

    let thumbnail: Awaited<ReturnType<SupabaseStorageService['uploadImage']>>;

    try {
      thumbnail = await this.storageService.uploadImage({
        buffer: await createAssetThumbnail(finalImageBuffer),
        path: thumbnailPath,
        contentType: 'image/webp',
      });
    } catch (error) {
      await this.storageService.remove(uploaded.path).catch(() => undefined);

      throw error;
    }

    const controlledTagPrefixes = [
      'text-overlay-',
      'corner-logo-',
      'brand-footer-',
      'footer-logo-',
      'logo-placement-',
      'corner-logo-scale-',
      'corner-logo-opacity-',
    ];
    const preservedTags = sourceAsset.tags.filter(
      (tag) => !controlledTagPrefixes.some((prefix) => tag.startsWith(prefix)),
    );
    const footerLogoApplied =
      signatureLogoEnabled && Boolean(primaryLogoBuffer);
    const cornerLogoApplied = cornerLogoEnabled && Boolean(primaryLogoBuffer);

    try {
      const asset = await this.prisma.asset.update({
        where: {
          id: sourceAsset.id,
        },
        data: {
          url: uploaded.publicUrl,
          thumbnailUrl: thumbnail.publicUrl,
          storageProvider: uploaded.provider,
          storagePath: uploaded.path,
          fileSize: uploaded.size,
          updatedAt: now,
          tags: [
            ...preservedTags,
            `text-overlay-${textOverlayEnabled ? 'enabled' : 'disabled'}`,
            cornerLogoApplied ? 'corner-logo-overlay' : 'corner-logo-skipped',
            `corner-logo-${cornerLogoEnabled ? 'enabled' : 'disabled'}`,
            `brand-footer-${brandFooterEnabled ? 'enabled' : 'disabled'}`,
            footerLogoApplied ? 'footer-logo-overlay' : 'footer-logo-skipped',
            `logo-placement-${effectiveCornerLogoPlacement.toLowerCase()}`,
            `corner-logo-scale-${cornerLogoScale}`,
            `corner-logo-opacity-${cornerLogoOpacity}`,
          ],
        },
        include: {
          brand: { select: { id: true, name: true } },
          campaign: { select: { id: true, name: true } },
          history: { select: { id: true, topic: true } },
        },
      });

      return {
        asset,
        branding: {
          brandFooterEnabled,
          footerLogoEnabled: footerLogoApplied,
          cornerLogoEnabled: cornerLogoApplied,
        },
      };
    } catch (error) {
      await Promise.all([
        this.storageService.remove(uploaded.path).catch(() => undefined),
        this.storageService.remove(thumbnail.path).catch(() => undefined),
      ]);

      throw error;
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

    const finalBuffer = await this.brandRenderer.render(
      {
        brandId: brand.id,

        brandBrainRules: {
          visualPolicy: {
            visualStyle: brand.visualStyle,
          },
          promptPolicy: {
            negativePrompt: sourceAsset.negativePrompt ?? null,
          },
          brandRules: brand.brandRules,
          brandKit: brand.brandKit,
        },

        imageWidth: width,
        imageHeight: height,
        buffer: sourceBuffer,
      },
      {
        logoEnabled: true,
        primaryLogoAssetId: brand.primaryLogoAssetId,
        placement,
        scale,
        opacity,
        platform,
        normalizedX: hasCustomPosition ? dto.logoX : undefined,
        normalizedY: hasCustomPosition ? dto.logoY : undefined,
      },
    );

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

    const thumbnailPath = buildAssetThumbnailPath(brand.id, now, filename);

    let thumbnail: Awaited<ReturnType<SupabaseStorageService['uploadImage']>>;

    try {
      const thumbnailBuffer = await createAssetThumbnail(finalBuffer);

      thumbnail = await this.storageService.uploadImage({
        buffer: thumbnailBuffer,
        path: thumbnailPath,
        contentType: 'image/webp',
      });
    } catch (error) {
      await this.storageService.remove(uploaded.path).catch(() => undefined);

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

  private resolveProviderSize(
    output: {
      width: number;
      height: number;
    } | null,
  ): '1024x1024' | '1024x1536' | '1536x1024' {
    if (!output) {
      return '1024x1536';
    }

    const ratio = output.width / output.height;

    if (ratio >= 0.9 && ratio <= 1.1) {
      return '1024x1024';
    }

    return ratio > 1 ? '1536x1024' : '1024x1536';
  }

  private resolveOutputDimensions(dto: GenerateAssetImageDto): {
    width: number;
    height: number;
  } | null {
    if (dto.outputWidth !== undefined || dto.outputHeight !== undefined) {
      if (dto.aspectRatio) {
        throw new BadRequestException(
          'Use either outputWidth/outputHeight or aspectRatio, not both.',
        );
      }

      if (dto.outputWidth === undefined || dto.outputHeight === undefined) {
        throw new BadRequestException(
          'outputWidth and outputHeight must be provided together.',
        );
      }

      return {
        width: dto.outputWidth,
        height: dto.outputHeight,
      };
    }

    if (!dto.aspectRatio) {
      return null;
    }

    const [ratioWidth, ratioHeight] = dto.aspectRatio.split(':').map(Number);

    if (
      !Number.isFinite(ratioWidth) ||
      !Number.isFinite(ratioHeight) ||
      ratioWidth <= 0 ||
      ratioHeight <= 0
    ) {
      throw new BadRequestException(
        'aspectRatio must contain two positive numbers.',
      );
    }

    const longEdge = 1536;
    const ratio = ratioWidth / ratioHeight;

    if (ratio > 6 || ratio < 1 / 6) {
      throw new BadRequestException(
        'aspectRatio must be between 1:6 and 6:1 so the requested ratio can be preserved.',
      );
    }

    if (ratio >= 1) {
      return {
        width: longEdge,
        height: this.toEvenDimension(longEdge / ratio),
      };
    }

    return {
      width: this.toEvenDimension(longEdge * ratio),
      height: longEdge,
    };
  }

  private toEvenDimension(value: number) {
    const bounded = Math.min(4096, Math.max(256, Math.round(value)));

    return bounded % 2 === 0 ? bounded : bounded + 1;
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
