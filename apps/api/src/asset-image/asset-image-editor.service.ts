import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { AiRuntimeSettingsService } from '../ai-runtime/ai-runtime-settings.service';
import OpenAI, { toFile } from 'openai';
import sharp, { OverlayOptions } from 'sharp';
import QRCode from 'qrcode';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { ImagePostProcessorService } from '../image-processing/image-post-processor.service';
import { ImageSettingsService } from '../image-settings/image-settings.service';
import {
  CompositeExistingAssetDto,
  ImageEditorLayerDto,
} from './dto/composite-existing-asset.dto';
import { EraseExistingAssetDto } from './dto/erase-existing-asset.dto';
import { AiEditExistingAssetDto } from './dto/ai-edit-existing-asset.dto';

@Injectable()
export class AssetImageEditorService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
    private readonly storageService: SupabaseStorageService,
    private readonly configService: ConfigService,
    private readonly aiRuntime: AiRuntimeSettingsService,
    private readonly imagePostProcessor: ImagePostProcessorService,
    private readonly imageSettings: ImageSettingsService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    this.client = apiKey
      ? new OpenAI({
          apiKey,
          timeout: 180_000,
          maxRetries: 2,
        })
      : null;
  }

  private async persistUploadedAsset<T>(
    uploaded: Awaited<
      ReturnType<SupabaseStorageService['uploadImage']>
    >,
    create: () => Promise<T>,
  ): Promise<T> {
    try {
      return await create();
    } catch (error) {
      await this.storageService.remove(uploaded.path).catch(() => undefined);
      throw error;
    }
  }


  private async loadBrandSignatureLogo(
    brandId: string,
    primaryLogoAssetId?: string | null,
  ): Promise<Buffer | null> {
    const logoAssetId =
      primaryLogoAssetId?.trim();

    if (!logoAssetId) {
      return null;
    }

    const logoAsset =
      await this.prisma.asset.findFirst({
        where: {
          id: logoAssetId,
          brandId,
          type: 'IMAGE',
        },
        select: {
          url: true,
        },
      });

    if (
      !logoAsset?.url ||
      !logoAsset.url.startsWith('https://')
    ) {
      return null;
    }

    try {
      const response =
        await fetch(
          logoAsset.url,
        );

      if (!response.ok) {
        throw new Error(
          `Logo download returned HTTP ${response.status}.`,
        );
      }

      return Buffer.from(
        await response.arrayBuffer(),
      );
    } catch (error) {
      console.warn(
        [
          '[AssetImageEditorService]',
          'Brand signature logo skipped.',
          error instanceof Error
            ? error.message
            : 'Unknown logo processing error.',
        ].join(' '),
      );

      return null;
    }
  }

  private async applyImageGenerationSettings(
    input: {
      buffer: Buffer;
      brandId: string;
      primaryLogoAssetId?: string | null;
      name?: string;
      pageId?: string;
      channelId?: string;
    },
  ) {
    const setting =
      await this.imageSettings.get({
        pageId: input.pageId,
        channelId: input.channelId,
      });

    const footerLogoMode =
      setting.footerLogoMode ??
      'auto';

    const logoBuffer =
      setting.brandFooterEnabled &&
      footerLogoMode !== 'hide'
        ? await this.loadBrandSignatureLogo(
            input.brandId,
            input.primaryLogoAssetId,
          )
        : null;

    return this.imagePostProcessor.process(
      input.buffer,
      {
        textOverlayEnabled:
          setting.textOverlayEnabled,

        brandFooterEnabled:
          setting.brandFooterEnabled,

        footerText:
          setting.footerText,

        footerPosition:
          setting.footerPosition,

        footerStyle:
          setting.footerStyle,

        brandLogo:
          logoBuffer ??
          undefined,

        logoEnabled:
          Boolean(
            logoBuffer,
          ),

        logoScale: 1,
        logoOpacity: 1,
      },
      input.name,
    );
  }

  async latestImage() {
    const brand = await this.brandsService.getActiveBrand();
    return this.prisma.asset.findFirst({
      where: { brandId: brand.id, type: 'IMAGE' },
      orderBy: { createdAt: 'desc' },
      include: {
        campaign: { select: { id: true, name: true } },
        history: { select: { id: true, topic: true } },
      },
    });
  }

  async compositeExistingAsset(dto: CompositeExistingAssetDto) {
    const brand = await this.brandsService.getActiveBrand();
    const sourceAsset = await this.prisma.asset.findFirst({
      where: { id: dto.assetId, brandId: brand.id, type: 'IMAGE' },
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

    const visibleLayers = [...dto.layers]
      .filter((layer) => layer.visible && layer.type !== 'IMAGE')
      .sort((left, right) => left.order - right.order);

    const composites: OverlayOptions[] = [];

    for (const layer of visibleLayers) {
      if (layer.type === 'TEXT' && layer.text?.trim()) {
        composites.push(this.createTextOverlay(layer, width, height));
      }

      if (layer.type === 'LOGO') {
        const logoOverlay = await this.createLogoOverlay(
          brand.id,
          brand.primaryLogoAssetId,
          layer,
          width,
          height,
        );
        if (logoOverlay) composites.push(logoOverlay);
      }

      if (layer.type === 'QR' && layer.qrValue?.trim()) {
        const qrOverlay = await this.createQrOverlay(layer, width, height);
        if (qrOverlay) composites.push(qrOverlay);
      }
    }

    const compositeBuffer = composites.length
      ? await sharp(sourceBuffer).composite(composites).png().toBuffer()
      : await sharp(sourceBuffer).png().toBuffer();

    const outputName = dto.name?.trim() || `${sourceAsset.name} · Edited`;

    /*
     * Layer Editor saves exactly the explicit editor layers.
     *
     * Do not run automatic Brand Footer / logo post-processing here,
     * otherwise an explicitly positioned Logo layer can be duplicated
     * by global image-generation settings.
     */
    const finalBuffer =
      await sharp(compositeBuffer)
        .png()
        .toBuffer();
    const filename = `${Date.now()}-${this.slugify(outputName).slice(0, 40)}-${randomUUID()
      .replace(/-/g, '')
      .slice(0, 8)}.png`;
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

    return this.persistUploadedAsset(uploaded, () =>
      this.prisma.asset.create({
      data: {
        brandId: brand.id,
        campaignId: sourceAsset.campaignId,
        historyId: sourceAsset.historyId,
        name: outputName,
        type: 'IMAGE',
        provider: 'atlas-image-editor-v2',
        platform: sourceAsset.platform || 'Multi-platform',
        prompt: sourceAsset.prompt,
        revisedPrompt: sourceAsset.revisedPrompt,
        generationModel: sourceAsset.generationModel,
        generationSize: `${width}x${height}`,
        generationQuality: sourceAsset.generationQuality,
        storageProvider: uploaded.provider,
        storagePath: uploaded.path,
        fileSize: uploaded.size,
        remark: `Edited from asset ${sourceAsset.id}`,
        aiEnabled: false,
        tags: [
          ...sourceAsset.tags,
          'image-edited',
          'image-editor-v2',
          `source-asset-${sourceAsset.id}`,
          `layer-count-${visibleLayers.length}`,
          ...(visibleLayers.some((layer) => layer.type === 'TEXT')
            ? ['text-overlay']
            : []),
          ...(visibleLayers.some((layer) => layer.type === 'LOGO')
            ? ['logo-overlay']
            : []),
          ...(visibleLayers.some((layer) => layer.type === 'QR')
            ? ['qr-overlay']
            : []),
        ],
        url: uploaded.publicUrl,
        thumbnailUrl: uploaded.publicUrl,
        mimeType: 'image/png',
        width,
        height,
      },
      include: {
        brand: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        history: { select: { id: true, topic: true } },
      },
      }),
    );
  }

  async aiEditExistingAsset(dto: AiEditExistingAssetDto) {
    if (!this.client) {
      throw new BadRequestException('OPENAI_API_KEY is not configured.');
    }

    const instruction = dto.prompt.trim();

    if (!instruction) {
      throw new BadRequestException('An AI edit instruction is required.');
    }

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

    const originalBuffer = Buffer.from(await sourceResponse.arrayBuffer());

    const originalMetadata = await sharp(originalBuffer).metadata();

    const originalWidth = originalMetadata.width ?? sourceAsset.width;

    const originalHeight = originalMetadata.height ?? sourceAsset.height;

    if (!originalWidth || !originalHeight) {
      throw new BadRequestException(
        'Unable to determine the selected image size.',
      );
    }

    /*
     * Normalise source to PNG before sending to
     * the image editing endpoint.
     */
    const sourcePng = await sharp(originalBuffer).png().toBuffer();

    const imageFile = await toFile(sourcePng, 'source.png', {
      type: 'image/png',
    });

    const preserveComposition = dto.preserveComposition ?? true;

    const preservePeople = dto.preservePeople ?? true;

    const preserveBranding = dto.preserveBranding ?? true;

    const constraints: string[] = [];

    if (preserveComposition) {
      constraints.push(
        [
          'Preserve the original framing,',
          'camera angle, composition,',
          'major object positions,',
          'and overall layout unless',
          'the requested edit requires otherwise.',
        ].join(' '),
      );
    }

    if (preservePeople) {
      constraints.push(
        [
          'Preserve the identity, facial features,',
          'body proportions, pose, age appearance,',
          'and recognisable characteristics',
          'of existing people unless explicitly',
          'asked to modify them.',
        ].join(' '),
      );
    }

    if (preserveBranding) {
      constraints.push(
        [
          'Preserve existing legitimate brand marks,',
          'logos, typography and brand placement',
          'unless the edit instruction explicitly',
          'asks to change or remove them.',
        ].join(' '),
      );
    }

    const prompt = [
      'Edit the supplied image.',
      '',
      `Requested edit: ${instruction}`,
      '',
      ...constraints,
      '',
      [
        'Keep all unrelated areas as close as possible',
        'to the original image.',
      ].join(' '),
      [
        'Do not invent extra text, logos,',
        'watermarks, QR codes or decorative marks',
        'unless specifically requested.',
      ].join(' '),
    ]
      .filter(Boolean)
      .join('\n');

    const model = await this.aiRuntime.getImageModel();

    const generationStartedAt = Date.now();

    const response = await this.client.images.edit({
      model,
      image: imageFile,
      prompt,
      size: 'auto',
      quality: 'high',
      output_format: 'png',
    });

    const imageData = response.data?.[0];

    const imageBase64 = imageData?.b64_json;

    if (!imageBase64) {
      throw new BadRequestException(
        'AI image edit completed without image data.',
      );
    }

    const rawEditedBuffer = Buffer.from(imageBase64, 'base64');

    const outputName = dto.name?.trim() || `${sourceAsset.name} · AI Edited`;

    const editedBuffer =
      await this.applyImageGenerationSettings({
        buffer: rawEditedBuffer,
        brandId: brand.id,
        primaryLogoAssetId:
          brand.primaryLogoAssetId,
        name: outputName,
      });

    const finalMetadata = await sharp(editedBuffer).metadata();

    

    const filename =
      `${Date.now()}-` +
      `${this.slugify(outputName).slice(0, 40)}-` +
      `${randomUUID().replace(/-/g, '').slice(0, 8)}.png`;

    const now = new Date();

    const storagePath = [
      'brands',
      brand.id,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      filename,
    ].join('/');

    const uploaded = await this.storageService.uploadImage({
      buffer: editedBuffer,
      path: storagePath,
      contentType: 'image/png',
    });

    const width = finalMetadata.width ?? originalWidth;

    const height = finalMetadata.height ?? originalHeight;

    return this.persistUploadedAsset(uploaded, () =>
      this.prisma.asset.create({
      data: {
        brandId: brand.id,
        campaignId: sourceAsset.campaignId,
        historyId: sourceAsset.historyId,

        name: outputName,
        type: 'IMAGE',

        provider: 'atlas-image-editor-ai',

        platform: sourceAsset.platform || 'Multi-platform',

        prompt: sourceAsset.prompt,

        revisedPrompt: prompt,

        generationModel: model,

        generationSize: `${width}x${height}`,

        generationQuality: 'high',

        generationDurationMs: Date.now() - generationStartedAt,

        storageProvider: uploaded.provider,

        storagePath: uploaded.path,

        fileSize: uploaded.size,

        remark: `AI edit from asset ${sourceAsset.id}`,

        aiEnabled: false,

        tags: [
          ...sourceAsset.tags,
          'image-edited',
          'ai-image-edit',
          'image-editor-ai',
          `source-asset-${sourceAsset.id}`,
          preserveComposition ? 'preserve-composition' : 'composition-flexible',
          preservePeople ? 'preserve-people' : 'people-flexible',
          preserveBranding ? 'preserve-branding' : 'branding-flexible',
        ],

        url: uploaded.publicUrl,

        thumbnailUrl: uploaded.publicUrl,

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
      }),
    );
  }

  async eraseExistingAsset(dto: EraseExistingAssetDto) {
    const eraseMode =
      dto.mode ?? 'ai';

    if (
      eraseMode === 'ai' &&
      !this.client
    ) {
      throw new BadRequestException(
        'OPENAI_API_KEY is not configured.',
      );
    }

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

    const maskMatch = dto.maskDataUrl.match(/^data:image\/png;base64,(.+)$/s);

    if (!maskMatch?.[1]) {
      throw new BadRequestException('maskDataUrl must be a PNG data URL.');
    }

    let originalBuffer: Buffer | null = null;
    let sourceFailure: string | null = null;

    /*
     * Preferred source:
     * Assets already migrated to Supabase should be loaded by storagePath.
     * This avoids depending on stale public /storage/assets URLs.
     */
    if (sourceAsset.storageProvider === 'supabase' && sourceAsset.storagePath) {
      try {
        originalBuffer = await this.storageService.download(
          sourceAsset.storagePath,
        );
      } catch (error) {
        sourceFailure = error instanceof Error ? error.message : String(error);
      }
    }

    /*
     * Fallback:
     * Keep support for existing external HTTPS assets.
     */
    if (!originalBuffer && sourceAsset.url?.startsWith('https://')) {
      try {
        const sourceResponse = await fetch(sourceAsset.url);

        if (sourceResponse.ok) {
          originalBuffer = Buffer.from(await sourceResponse.arrayBuffer());
        } else {
          sourceFailure = `HTTP ${sourceResponse.status} while downloading ${sourceAsset.url}`;
        }
      } catch (error) {
        sourceFailure = error instanceof Error ? error.message : String(error);
      }
    }

    if (!originalBuffer) {
      throw new BadRequestException(
        [
          'Unable to load the selected image.',
          sourceAsset.storagePath
            ? `storagePath=${sourceAsset.storagePath}`
            : 'storagePath unavailable',
          sourceFailure || 'No usable source was available.',
        ].join(' '),
      );
    }

    const metadata = await sharp(originalBuffer).metadata();

    const width = metadata.width ?? sourceAsset.width;

    const height = metadata.height ?? sourceAsset.height;

    if (!width || !height) {
      throw new BadRequestException(
        'Unable to determine the selected image size.',
      );
    }

    /*
     * The browser mask is sent as:
     * - opaque white = keep
     * - transparent = area to remove / repaint
     *
     * Normalize it to the exact source dimensions.
     */
    const rawMask = Buffer.from(maskMatch[1], 'base64');

    const normalizedMask = await sharp(rawMask)
      .resize(width, height, {
        fit: 'fill',
      })
      .ensureAlpha()
      .raw()
      .toBuffer();

    /*
     * Smart Remove crop
     *
     * The browser sends a full-size binary alpha mask:
     *
     *   alpha 255 = preserve
     *   alpha   0 = regenerate
     *
     * Find the actual selected bounds first. The AI only receives a
     * contextual crop around that selection instead of the entire image.
     */
    let selectionLeft = width;
    let selectionTop = height;
    let selectionRight = -1;
    let selectionBottom = -1;
    let selectedAreaPixels = 0;

    for (
      let pixelIndex = 0;
      pixelIndex < width * height;
      pixelIndex += 1
    ) {
      const alpha =
        normalizedMask[pixelIndex * 4 + 3];

      /*
       * Use the solid core of the browser selection for bounding-box
       * detection. Feathering is applied separately below.
       */
      if (alpha >= 128) {
        continue;
      }

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);

      selectionLeft =
        Math.min(selectionLeft, x);

      selectionTop =
        Math.min(selectionTop, y);

      selectionRight =
        Math.max(selectionRight, x);

      selectionBottom =
        Math.max(selectionBottom, y);
      selectedAreaPixels += 1;
    }

    if (
      selectionRight < selectionLeft ||
      selectionBottom < selectionTop
    ) {
      throw new BadRequestException(
        'Brush over the area you want to remove first.',
      );
    }

    const selectionWidth =
      selectionRight - selectionLeft + 1;

    const selectionHeight =
      selectionBottom - selectionTop + 1;

    const selectionLongestSide =
      Math.max(
        selectionWidth,
        selectionHeight,
      );

    /*
     * Give the model enough surrounding visual context to rebuild
     * backgrounds naturally, while keeping a small logo cleanup local.
     */
    const contextPadding = Math.min(
      192,
      Math.max(
        48,
        Math.round(selectionLongestSide * 0.45),
        Math.round(Math.min(width, height) * 0.035),
      ),
    );

    let cropLeft = Math.max(
      0,
      selectionLeft - contextPadding,
    );

    let cropTop = Math.max(
      0,
      selectionTop - contextPadding,
    );

    let cropRight = Math.min(
      width,
      selectionRight + 1 + contextPadding,
    );

    let cropBottom = Math.min(
      height,
      selectionBottom + 1 + contextPadding,
    );

    /*
     * Very small selections still need meaningful visual context.
     * Expand toward at least 320px where the source image allows it.
     */
    const minimumCropWidth =
      Math.min(width, 256);

    const minimumCropHeight =
      Math.min(height, 256);

    if (
      cropRight - cropLeft <
      minimumCropWidth
    ) {
      const missing =
        minimumCropWidth -
        (cropRight - cropLeft);

      const before =
        Math.min(
          cropLeft,
          Math.floor(missing / 2),
        );

      cropLeft -= before;

      cropRight = Math.min(
        width,
        cropRight + missing - before,
      );

      if (
        cropRight - cropLeft <
        minimumCropWidth
      ) {
        cropLeft = Math.max(
          0,
          cropRight - minimumCropWidth,
        );
      }
    }

    if (
      cropBottom - cropTop <
      minimumCropHeight
    ) {
      const missing =
        minimumCropHeight -
        (cropBottom - cropTop);

      const before =
        Math.min(
          cropTop,
          Math.floor(missing / 2),
        );

      cropTop -= before;

      cropBottom = Math.min(
        height,
        cropBottom + missing - before,
      );

      if (
        cropBottom - cropTop <
        minimumCropHeight
      ) {
        cropTop = Math.max(
          0,
          cropBottom - minimumCropHeight,
        );
      }
    }

    const cropWidth =
      cropRight - cropLeft;

    const cropHeight =
      cropBottom - cropTop;

    /*
     * Expand the removal mask only slightly. This catches antialiased
     * edges and shadows without swallowing nearby content.
     */
    const edgeExpansion = Math.max(
      1,
      Math.min(
        6,
        Math.round(
          Math.min(width, height) * 0.0025,
        ),
      ),
    );

    /*
     * selectionAlpha follows the OpenAI mask contract:
     *
     * opaque      = preserve
     * transparent = regenerate
     */
    const selectionAlpha =
      await sharp(normalizedMask, {
        raw: {
          width,
          height,
          channels: 4,
        },
      })
        .extractChannel(3)
        .negate()
        .threshold(8)
        .dilate(edgeExpansion)
        .blur(
          Math.max(
            0.65,
            edgeExpansion / 3,
          ),
        )
        .negate()
        .toBuffer();

    const fullMaskBuffer =
      await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: {
            r: 255,
            g: 255,
            b: 255,
          },
        },
      })
        .joinChannel(selectionAlpha, {
          raw: {
            width,
            height,
            channels: 1,
          },
        })
        .png()
        .toBuffer();

    const sourceCropBuffer =
      await sharp(originalBuffer)
        .extract({
          left: cropLeft,
          top: cropTop,
          width: cropWidth,
          height: cropHeight,
        })
        .png()
        .toBuffer();

    const maskCropBuffer =
      await sharp(fullMaskBuffer)
        .extract({
          left: cropLeft,
          top: cropTop,
          width: cropWidth,
          height: cropHeight,
        })
        .png()
        .toBuffer();

    /*
     * QUICK REMOVE
     *
     * Local, deterministic cleanup for small logos,
     * watermarks and text. No AI request.
     *
     * Build a blurred reconstruction candidate from the
     * surrounding crop, then allow only the selected mask
     * pixels to be composited back onto the untouched source.
     */
    if (eraseMode === 'quick') {
      if (selectedAreaPixels > width * height * 0.12) {
        throw new BadRequestException(
          [
            'Quick Remove is intended for small selections.',
            'Use AI Remove for larger or complex objects.',
          ].join(' '),
        );
      }

      /*
       * Build a real mask-aware local fill.
       *
       * The old implementation blurred the source crop itself,
       * which meant pixels from the logo/text were still used
       * during reconstruction. That could make Quick Remove
       * look like it had done nothing.
       *
       * Here selected pixels are excluded completely. We start
       * at the selection boundary and progressively fill inward
       * using only already-valid surrounding pixels.
       */
      /*
       * QUICK REMOVE V2
       *
       * Important:
       * Do not sample directly beside the user's original mask.
       * Logo/text edges frequently contain antialiasing, glow and
       * shadow pixels outside the exact brush selection.
       *
       * Expand the selected region first, then reconstruct every
       * selected pixel using ONLY preserved pixels further outside.
       */
      const sourceRaw =
        await sharp(sourceCropBuffer)
          .ensureAlpha()
          .raw()
          .toBuffer({
            resolveWithObject: true,
          });

      const maskRaw =
        await sharp(maskCropBuffer)
          .ensureAlpha()
          .raw()
          .toBuffer({
            resolveWithObject: true,
          });

      const quickWidth =
        sourceRaw.info.width;

      const quickHeight =
        sourceRaw.info.height;

      const pixelCount =
        quickWidth * quickHeight;

      const repairedPixels =
        Buffer.from(sourceRaw.data);

      /*
       * Build the original binary selection.
       *
       * 1 = remove/reconstruct
       * 0 = preserved
       */
      const selectedMap =
        new Uint8Array(pixelCount);

      let selectedPixelCount = 0;

      for (
        let pixel = 0;
        pixel < pixelCount;
        pixel += 1
      ) {
        const alpha =
          maskRaw.data[
            pixel * 4 + 3
          ];

        if (alpha < 128) {
          selectedMap[pixel] = 1;
          selectedPixelCount += 1;
        }
      }

      if (!selectedPixelCount) {
        throw new BadRequestException(
          'Quick Remove did not find a selected area.',
        );
      }

      /*
       * Expand selection enough to remove antialiased logo edges,
       * outlines, glow and small shadows.
       *
       * Keep this local so Quick Remove remains appropriate for
       * small objects.
       */
      const quickExpansion =
        Math.max(
          5,
          Math.min(
            16,
            Math.round(
              selectionLongestSide * 0.08,
            ),
          ),
        );

      const expandedMap =
        new Uint8Array(
          selectedMap,
        );

      for (
        let y = 0;
        y < quickHeight;
        y += 1
      ) {
        for (
          let x = 0;
          x < quickWidth;
          x += 1
        ) {
          const pixel =
            y * quickWidth + x;

          if (
            selectedMap[pixel] !== 1
          ) {
            continue;
          }

          for (
            let dy = -quickExpansion;
            dy <= quickExpansion;
            dy += 1
          ) {
            const ny = y + dy;

            if (
              ny < 0 ||
              ny >= quickHeight
            ) {
              continue;
            }

            for (
              let dx = -quickExpansion;
              dx <= quickExpansion;
              dx += 1
            ) {
              if (
                dx * dx + dy * dy >
                quickExpansion *
                  quickExpansion
              ) {
                continue;
              }

              const nx = x + dx;

              if (
                nx < 0 ||
                nx >= quickWidth
              ) {
                continue;
              }

              expandedMap[
                ny * quickWidth + nx
              ] = 1;
            }
          }
        }
      }

      /*
       * Directional background reconstruction.
       *
       * Unlike the previous progressive-fill implementation,
       * reconstructed pixels are NEVER reused as source samples.
       * Every colour sample must come from a genuine preserved
       * pixel outside the expanded selection.
       */
      const directions = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const;

      const maxSearchDistance =
        Math.min(
          96,
          Math.max(
            24,
            Math.round(
              selectionLongestSide *
                0.75,
            ),
          ),
        );

      for (
        let y = 0;
        y < quickHeight;
        y += 1
      ) {
        for (
          let x = 0;
          x < quickWidth;
          x += 1
        ) {
          const pixel =
            y * quickWidth + x;

          if (
            expandedMap[pixel] !== 1
          ) {
            continue;
          }

          let red = 0;
          let green = 0;
          let blue = 0;
          let alpha = 0;
          let totalWeight = 0;

          for (
            const [dx, dy]
            of directions
          ) {
            for (
              let distance = 1;
              distance <=
                maxSearchDistance;
              distance += 1
            ) {
              const nx =
                x + dx * distance;

              const ny =
                y + dy * distance;

              if (
                nx < 0 ||
                ny < 0 ||
                nx >= quickWidth ||
                ny >= quickHeight
              ) {
                break;
              }

              const neighbour =
                ny * quickWidth + nx;

              /*
               * Skip every pixel belonging to the expanded
               * remove region. This is what prevents logo
               * colour contamination.
               */
              if (
                expandedMap[
                  neighbour
                ] === 1
              ) {
                continue;
              }

              const sourceIndex =
                neighbour * 4;

              /*
               * Nearby genuine background pixels matter more,
               * but all eight directions contribute.
               */
              const weight =
                1 /
                Math.max(
                  1,
                  distance,
                );

              red +=
                sourceRaw.data[
                  sourceIndex
                ] * weight;

              green +=
                sourceRaw.data[
                  sourceIndex + 1
                ] * weight;

              blue +=
                sourceRaw.data[
                  sourceIndex + 2
                ] * weight;

              alpha +=
                sourceRaw.data[
                  sourceIndex + 3
                ] * weight;

              totalWeight +=
                weight;

              break;
            }
          }

          /*
           * Fallback:
           *
           * A selected pixel can occasionally have no preserved
           * background on the eight straight search rays even
           * though valid background exists nearby.
           *
           * Do not fail the entire Quick Remove operation.
           * Search outward in square rings and use the nearest
           * genuine preserved pixels instead.
           */
          if (
            totalWeight <= 0
          ) {
            const fallbackRadius =
              Math.min(
                Math.max(
                  quickWidth,
                  quickHeight,
                ),
                Math.max(
                  maxSearchDistance,
                  128,
                ),
              );

            for (
              let radius = 1;
              radius <= fallbackRadius;
              radius += 1
            ) {
              let foundAtRadius = false;

              for (
                let dy = -radius;
                dy <= radius;
                dy += 1
              ) {
                for (
                  let dx = -radius;
                  dx <= radius;
                  dx += 1
                ) {
                  /*
                   * Only inspect the current outer ring.
                   */
                  if (
                    Math.abs(dx) !== radius &&
                    Math.abs(dy) !== radius
                  ) {
                    continue;
                  }

                  const nx = x + dx;
                  const ny = y + dy;

                  if (
                    nx < 0 ||
                    ny < 0 ||
                    nx >= quickWidth ||
                    ny >= quickHeight
                  ) {
                    continue;
                  }

                  const neighbour =
                    ny * quickWidth + nx;

                  if (
                    expandedMap[neighbour] === 1 &&
                    selectedMap[neighbour] === 1
                  ) {
                    continue;
                  }

                  const sourceIndex =
                    neighbour * 4;

                  const distance =
                    Math.sqrt(
                      dx * dx +
                      dy * dy,
                    );

                  const weight =
                    1 /
                    Math.max(
                      1,
                      distance,
                    );

                  red +=
                    sourceRaw.data[
                      sourceIndex
                    ] * weight;

                  green +=
                    sourceRaw.data[
                      sourceIndex + 1
                    ] * weight;

                  blue +=
                    sourceRaw.data[
                      sourceIndex + 2
                    ] * weight;

                  alpha +=
                    sourceRaw.data[
                      sourceIndex + 3
                    ] * weight;

                  totalWeight +=
                    weight;

                  foundAtRadius = true;
                }
              }

              /*
               * A few nearest pixels are enough.
               * Do not keep searching distant background.
               */
              if (
                foundAtRadius &&
                totalWeight > 0
              ) {
                break;
              }
            }
          }

          if (
            totalWeight <= 0
          ) {
            throw new BadRequestException(
              [
                'Quick Remove could not find any usable background pixels.',
                'Use AI Remove for this area.',
              ].join(' '),
            );
          }

          const outputIndex =
            pixel * 4;

          repairedPixels[
            outputIndex
          ] =
            Math.round(
              red / totalWeight,
            );

          repairedPixels[
            outputIndex + 1
          ] =
            Math.round(
              green /
                totalWeight,
            );

          repairedPixels[
            outputIndex + 2
          ] =
            Math.round(
              blue /
                totalWeight,
            );

          repairedPixels[
            outputIndex + 3
          ] =
            Math.round(
              alpha /
                totalWeight,
            );
        }
      }

      const quickRepairCrop =
        await sharp(
          repairedPixels,
          {
            raw: {
              width: quickWidth,
              height: quickHeight,
              channels: 4,
            },
          },
        )
          .blur(0.45)
          .removeAlpha()
          .png()
          .toBuffer();

      /*
       * selectionAlpha:
       *   opaque      = preserve
       *   transparent = selected
       *
       * Flip it so only selected pixels from quickRepairCrop
       * are allowed back into the original.
       */
      /*
       * Composite exactly the expanded Quick Remove region.
       *
       * expandedMap:
       *   1 = use reconstructed pixel
       *   0 = preserve original
       */
      const quickEditAlpha =
        Buffer.alloc(
          pixelCount,
        );

      for (
        let pixel = 0;
        pixel < pixelCount;
        pixel += 1
      ) {
        quickEditAlpha[pixel] =
          expandedMap[pixel] === 1
            ? 255
            : 0;
      }

      const quickRepairWithAlpha =
        await sharp(quickRepairCrop)
          .removeAlpha()
          .joinChannel(
            quickEditAlpha,
            {
              raw: {
                width: cropWidth,
                height: cropHeight,
                channels: 1,
              },
            },
          )
          .png()
          .toBuffer();

      const quickCompositedBuffer =
        await sharp(originalBuffer)
          .png()
          .composite([
            {
              input: quickRepairWithAlpha,
              left: cropLeft,
              top: cropTop,
            },
          ])
          .png()
          .toBuffer();

      const outputName =
        dto.name?.trim() ||
        `${sourceAsset.name} · Quick Cleaned`;

      const editedBuffer =
        await sharp(quickCompositedBuffer)
          .png()
          .toBuffer();

      const filename =
        `${Date.now()}-${this.slugify(outputName).slice(0, 40)}-` +
        `${randomUUID().replace(/-/g, '').slice(0, 8)}.png`;

      const now = new Date();

      const storagePath = [
        'brands',
        brand.id,
        String(now.getUTCFullYear()),
        String(now.getUTCMonth() + 1).padStart(2, '0'),
        filename,
      ].join('/');

      const uploaded =
        await this.storageService.uploadImage({
          buffer: editedBuffer,
          path: storagePath,
          contentType: 'image/png',
        });

      const finalMetadata =
        await sharp(
          editedBuffer,
        ).metadata();

      return this.persistUploadedAsset(uploaded, () =>
        this.prisma.asset.create({
        data: {
          brandId: brand.id,
          campaignId:
            sourceAsset.campaignId,
          historyId:
            sourceAsset.historyId,
          name: outputName,
          type: 'IMAGE',
          provider:
            'atlas-image-editor-quick-remove',
          platform:
            sourceAsset.platform ||
            'Multi-platform',
          prompt:
            sourceAsset.prompt,
          revisedPrompt:
            'Local Quick Remove',
          generationModel:
            'atlas-local-quick-remove-v1',
          generationSize:
            `${finalMetadata.width ?? width}x${finalMetadata.height ?? height}`,
          generationQuality:
            'quick',
          storageProvider:
            uploaded.provider,
          storagePath:
            uploaded.path,
          fileSize:
            uploaded.size,
          remark:
            `Quick cleanup from asset ${sourceAsset.id}`,
          aiEnabled: false,
          tags: [
            ...sourceAsset.tags,
            'image-edited',
            'quick-remove',
            `source-asset-${sourceAsset.id}`,
          ],
          url:
            uploaded.publicUrl,
          thumbnailUrl:
            uploaded.publicUrl,
          mimeType:
            'image/png',
          width:
            finalMetadata.width ??
            width,
          height:
            finalMetadata.height ??
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
        }),
      );
    }

    if (!this.client) {
      throw new BadRequestException(
        'OPENAI_API_KEY is not configured.',
      );
    }

    const imageFile =
      await toFile(
        sourceCropBuffer,
        'source-crop.png',
        {
          type: 'image/png',
        },
      );

    const maskFile =
      await toFile(
        maskCropBuffer,
        'mask-crop.png',
        {
          type: 'image/png',
        },
      );

    const model =
      await this.aiRuntime.getImageModel();

    const prompt = [
      dto.prompt?.trim(),

      [
        'This image is a local crop from a larger original.',
        'Remove only the objects covered by the transparent mask.',
      ].join(' '),

      [
        'Remove the complete logo, watermark, text, object,',
        'and any antialiased edge, outline, glow, or shadow',
        'inside the mask.',
      ].join(' '),

      [
        'Reconstruct the missing area naturally from the',
        'immediately surrounding texture, lighting and structure.',
      ].join(' '),

      [
        'Preserve all visible unmasked pixels and maintain',
        'continuity with the crop boundaries.',
      ].join(' '),
      [
        'Return a complete opaque reconstruction of the masked',
        'area. Do not return transparent, empty, black, blank,',
        'or placeholder pixels in the repaired region.',
      ].join(' '),

      [
        'Do not add any new logo, watermark, text, QR code,',
        'branding or decorative element.',
      ].join(' '),
    ]
      .filter(Boolean)
      .join(' ');

    const response = await this.client!.images.edit({
      model,
      image: imageFile,
      mask: maskFile,
      prompt,
      size: 'auto',
      quality: 'medium',
      output_format: 'png',
    });

    const imageBase64 = response.data?.[0]?.b64_json;

    if (!imageBase64) {
      throw new BadRequestException(
        'Image edit completed without image data.',
      );
    }

    const rawEditedCropBuffer =
      Buffer.from(
        imageBase64,
        'base64',
      );

    /*
     * Providers may return a different output size even with size=auto.
     * Normalize the edited crop back to the exact source crop dimensions.
     */
    const normalizedAiCropBuffer =
      await sharp(rawEditedCropBuffer)
        .resize(
          cropWidth,
          cropHeight,
          {
            fit: 'fill',
          },
        )
        .ensureAlpha()
        .png()
        .toBuffer();

    /*
     * Safety fallback:
     *
     * Some image-edit providers can return transparent or
     * partially transparent pixels inside the edited result.
     *
     * Never strip that alpha directly because transparent RGB
     * data can become black when alpha is removed.
     *
     * Composite the AI result over the untouched source crop
     * first. Transparent / missing AI pixels therefore fall
     * back to the original image instead of becoming black.
     */
    const editedCropBuffer =
      await sharp(sourceCropBuffer)
        .ensureAlpha()
        .composite([
          {
            input: normalizedAiCropBuffer,
            left: 0,
            top: 0,
            blend: 'over',
          },
        ])
        .removeAlpha()
        .png()
        .toBuffer();

    /*
     * AI image models can make tiny changes to pixels outside a supplied
     * mask. Do not trust those pixels.
     *
     * Create a feathered alpha channel where ONLY the selected region is
     * opaque, then composite only that area back onto the untouched source.
     */
    const editAlphaCrop =
      await sharp(selectionAlpha, {
        raw: {
          width,
          height,
          channels: 1,
        },
      })
        .extract({
          left: cropLeft,
          top: cropTop,
          width: cropWidth,
          height: cropHeight,
        })
        .negate()
        .toBuffer();

    const editedCropWithAlpha =
      await sharp(editedCropBuffer)
        .removeAlpha()
        .joinChannel(
          editAlphaCrop,
          {
            raw: {
              width: cropWidth,
              height: cropHeight,
              channels: 1,
            },
          },
        )
        .png()
        .toBuffer();

    const compositedBuffer =
      await sharp(originalBuffer)
        .png()
        .composite([
          {
            input: editedCropWithAlpha,
            left: cropLeft,
            top: cropTop,
          },
        ])
        .png()
        .toBuffer();

    const outputName =
      dto.name?.trim() ||
      `${sourceAsset.name} · Cleaned`;

    /*
     * Eraser is a cleanup tool only.
     *
     * Do not automatically re-apply Brand Footer, logo, text overlays,
     * or other generation post-processing after removing an object.
     * Branding is controlled separately by the editor layer tools.
     */
    const editedBuffer =
      await sharp(compositedBuffer)
        .png()
        .toBuffer();

    const filename =
      `${Date.now()}-${this.slugify(outputName).slice(0, 40)}-` +
      `${randomUUID().replace(/-/g, '').slice(0, 8)}.png`;

    const now = new Date();

    const storagePath = [
      'brands',
      brand.id,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      filename,
    ].join('/');

    const uploaded = await this.storageService.uploadImage({
      buffer: editedBuffer,
      path: storagePath,
      contentType: 'image/png',
    });

    const finalMetadata = await sharp(editedBuffer).metadata();

    return this.persistUploadedAsset(uploaded, () =>
      this.prisma.asset.create({
      data: {
        brandId: brand.id,
        campaignId: sourceAsset.campaignId,
        historyId: sourceAsset.historyId,
        name: outputName,
        type: 'IMAGE',
        provider: 'atlas-image-editor-inpaint',
        platform: sourceAsset.platform || 'Multi-platform',
        prompt: sourceAsset.prompt,
        revisedPrompt: prompt,
        generationModel: model,
        generationSize: `${finalMetadata.width ?? width}x${finalMetadata.height ?? height}`,
        generationQuality: 'high',
        storageProvider: uploaded.provider,
        storagePath: uploaded.path,
        fileSize: uploaded.size,
        remark: `AI cleanup from asset ${sourceAsset.id}`,
        aiEnabled: false,
        tags: [
          ...sourceAsset.tags,
          'image-edited',
          'ai-inpaint',
          'eraser-cleanup',
          `source-asset-${sourceAsset.id}`,
        ],
        url: uploaded.publicUrl,
        thumbnailUrl: uploaded.publicUrl,
        mimeType: 'image/png',
        width: finalMetadata.width ?? width,
        height: finalMetadata.height ?? height,
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
      }),
    );
  }

  private createTextOverlay(
    layer: ImageEditorLayerDto,
    width: number,
    height: number,
  ): OverlayOptions {
    const text = this.escapeXml(layer.text?.trim() || '');
    const fontSize = Math.max(8, Math.min(layer.fontSize ?? 48, 240));
    const color = /^#[0-9a-f]{6}$/i.test(layer.color || '')
      ? layer.color
      : '#ffffff';
    const x = Math.round(layer.x * width);
    const y = Math.round(layer.y * height);
    const opacity = Math.max(0, Math.min(layer.opacity, 1));
    const padding = Math.max(16, Math.round(fontSize * 0.4));
    const svgWidth = Math.max(1, width - x);
    const svgHeight = Math.max(fontSize * 2, height - y);

    const svg = Buffer.from(`
      <svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
        <style>
          .copy {
            font-family: Arial, Helvetica, sans-serif;
            font-size: ${fontSize}px;
            font-weight: 700;
            fill: ${color};
            opacity: ${opacity};
            paint-order: stroke;
            stroke: rgba(0,0,0,0.35);
            stroke-width: ${Math.max(1, Math.round(fontSize * 0.035))}px;
            stroke-linejoin: round;
          }
        </style>
        <text x="${padding}" y="${fontSize + padding}" class="copy">${text}</text>
      </svg>
    `);

    return { input: svg, left: x, top: y };
  }

  private async createLogoOverlay(
    brandId: string,
    primaryLogoAssetId: string | null | undefined,
    layer: ImageEditorLayerDto,
    width: number,
    height: number,
  ): Promise<OverlayOptions | null> {
    if (!primaryLogoAssetId) return null;

    const logoAsset = await this.prisma.asset.findFirst({
      where: {
        id: primaryLogoAssetId,
        brandId,
        type: 'IMAGE',
      },
      select: { url: true },
    });

    if (!logoAsset?.url?.startsWith('https://')) return null;

    const response = await fetch(logoAsset.url);
    if (!response.ok) return null;

    const logoBuffer = Buffer.from(await response.arrayBuffer());
    const scale = Math.max(0.4, Math.min(layer.scale ?? 0.85, 2));
    const targetWidth = Math.max(48, Math.round(width * 0.16 * scale));
    const targetHeight = Math.max(48, Math.round(height * 0.16 * scale));
    const resizedLogo = await sharp(logoBuffer)
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    const logoMeta = await sharp(resizedLogo).metadata();
    const logoWidth = logoMeta.width ?? targetWidth;
    const logoHeight = logoMeta.height ?? targetWidth;
    const left = Math.round(
      Math.max(0, Math.min(width - logoWidth, layer.x * width - logoWidth / 2)),
    );
    const top = Math.round(
      Math.max(
        0,
        Math.min(height - logoHeight, layer.y * height - logoHeight / 2),
      ),
    );

    if (layer.opacity >= 0.999) {
      return { input: resizedLogo, left, top };
    }

    const fadedLogo = Buffer.from(`
      <svg width="${logoWidth}" height="${logoHeight}" xmlns="http://www.w3.org/2000/svg">
        <image width="${logoWidth}" height="${logoHeight}" opacity="${Math.max(
          0,
          Math.min(layer.opacity, 1),
        )}" href="data:image/png;base64,${resizedLogo.toString('base64')}" />
      </svg>
    `);

    return { input: fadedLogo, left, top };
  }

  async qrPreview(
    value?: string,
  ) {
    const normalized =
      value?.trim();

    if (!normalized) {
      throw new BadRequestException(
        'QR content is required.',
      );
    }

    if (normalized.length > 4096) {
      throw new BadRequestException(
        'QR content is too long.',
      );
    }

    const dataUrl =
      await QRCode.toDataURL(
        normalized,
        {
          width: 512,
          margin: 1,
          errorCorrectionLevel: 'M',
        },
      );

    return {
      dataUrl,
    };
  }

  private async createQrOverlay(
    layer: ImageEditorLayerDto,
    width: number,
    height: number,
  ): Promise<OverlayOptions | null> {
    const value = layer.qrValue?.trim();

    if (!value) {
      return null;
    }

    const scale = Math.max(
      0.4,
      Math.min(layer.scale ?? 0.85, 2),
    );

    const targetSize = Math.max(
      96,
      Math.round(width * 0.18 * scale),
    );

    /*
     * Generate QR locally instead of calling QuickChart.
     *
     * Benefits:
     * - no external network dependency
     * - faster and more predictable
     * - QR payload never needs to leave Atlas
     * - multiple QR layers can be generated independently
     */
    const rawQr = await QRCode.toBuffer(
      value,
      {
        type: 'png',
        width: targetSize,
        margin: 1,
        errorCorrectionLevel: 'M',
      },
    );

    const qrBuffer =
      await sharp(rawQr)
        .resize({
          width: targetSize,
          height: targetSize,
          fit: 'contain',
        })
        .png()
        .toBuffer();

    const left = Math.round(
      Math.max(
        0,
        Math.min(
          width - targetSize,
          layer.x * width -
            targetSize / 2,
        ),
      ),
    );

    const top = Math.round(
      Math.max(
        0,
        Math.min(
          height - targetSize,
          layer.y * height -
            targetSize / 2,
        ),
      ),
    );

    if (layer.opacity >= 0.999) {
      return {
        input: qrBuffer,
        left,
        top,
      };
    }

    const fadedQr = Buffer.from(`
      <svg
        width="${targetSize}"
        height="${targetSize}"
        xmlns="http://www.w3.org/2000/svg"
      >
        <image
          width="${targetSize}"
          height="${targetSize}"
          opacity="${Math.max(
            0,
            Math.min(
              layer.opacity,
              1,
            ),
          )}"
          href="data:image/png;base64,${qrBuffer.toString('base64')}"
        />
      </svg>
    `);

    return {
      input: fadedQr,
      left,
      top,
    };
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private slugify(value: string) {
    return (
      value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'edited-image'
    );
  }
}
