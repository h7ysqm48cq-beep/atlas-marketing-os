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
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
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

    const finalBuffer = composites.length
      ? await sharp(sourceBuffer).composite(composites).png().toBuffer()
      : await sharp(sourceBuffer).png().toBuffer();

    const outputName = dto.name?.trim() || `${sourceAsset.name} · Edited`;
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

    return this.prisma.asset.create({
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
    });
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

    const editedBuffer = Buffer.from(imageBase64, 'base64');

    const finalMetadata = await sharp(editedBuffer).metadata();

    const outputName = dto.name?.trim() || `${sourceAsset.name} · AI Edited`;

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

    return this.prisma.asset.create({
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
    });
  }

  async eraseExistingAsset(dto: EraseExistingAssetDto) {
    if (!this.client) {
      throw new BadRequestException('OPENAI_API_KEY is not configured.');
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

    const maskBuffer = await sharp(rawMask)
      .resize(width, height, {
        fit: 'fill',
      })
      .png()
      .toBuffer();

    const imageFile = await toFile(originalBuffer, 'source.png', {
      type: 'image/png',
    });

    const maskFile = await toFile(maskBuffer, 'mask.png', {
      type: 'image/png',
    });

    const model = await this.aiRuntime.getImageModel();

    const prompt =
      dto.prompt?.trim() ||
      [
        'Remove only the objects covered by the transparent mask.',
        'Reconstruct the missing area naturally using the surrounding image.',
        'Preserve the original composition, people, lighting, colors, typography, and all unmasked content.',
        'Do not add any new logo, watermark, text, QR code, branding, or decorative element.',
      ].join(' ');

    const response = await this.client.images.edit({
      model,
      image: imageFile,
      mask: maskFile,
      prompt,
      size: 'auto',
      quality: 'high',
      output_format: 'png',
    });

    const imageBase64 = response.data?.[0]?.b64_json;

    if (!imageBase64) {
      throw new BadRequestException('Image edit completed without image data.');
    }

    const editedBuffer = Buffer.from(imageBase64, 'base64');

    const outputName = dto.name?.trim() || `${sourceAsset.name} · Cleaned`;

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

    return this.prisma.asset.create({
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
    });
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
        aiEnabled: true,
      },
      select: { url: true },
    });

    if (!logoAsset?.url?.startsWith('https://')) return null;

    const response = await fetch(logoAsset.url);
    if (!response.ok) return null;

    const logoBuffer = Buffer.from(await response.arrayBuffer());
    const scale = Math.max(0.4, Math.min(layer.scale ?? 0.85, 2));
    const targetWidth = Math.max(48, Math.round(width * 0.16 * scale));
    const resizedLogo = await sharp(logoBuffer)
      .resize({ width: targetWidth, withoutEnlargement: true })
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

  private async createQrOverlay(
    layer: ImageEditorLayerDto,
    width: number,
    height: number,
  ): Promise<OverlayOptions | null> {
    const value = layer.qrValue?.trim();
    if (!value) return null;

    const scale = Math.max(0.4, Math.min(layer.scale ?? 0.85, 2));
    const targetSize = Math.max(96, Math.round(width * 0.18 * scale));
    const qrUrl = `https://quickchart.io/qr?size=${targetSize}&margin=1&text=${encodeURIComponent(value)}`;
    const response = await fetch(qrUrl);

    if (!response.ok) {
      throw new BadRequestException(
        `Unable to generate QR code (HTTP ${response.status}).`,
      );
    }

    const rawQr = Buffer.from(await response.arrayBuffer());
    const qrBuffer = await sharp(rawQr)
      .resize({ width: targetSize, height: targetSize, fit: 'contain' })
      .png()
      .toBuffer();
    const left = Math.round(
      Math.max(
        0,
        Math.min(width - targetSize, layer.x * width - targetSize / 2),
      ),
    );
    const top = Math.round(
      Math.max(
        0,
        Math.min(height - targetSize, layer.y * height - targetSize / 2),
      ),
    );

    if (layer.opacity >= 0.999) {
      return { input: qrBuffer, left, top };
    }

    const fadedQr = Buffer.from(`
      <svg width="${targetSize}" height="${targetSize}" xmlns="http://www.w3.org/2000/svg">
        <image width="${targetSize}" height="${targetSize}" opacity="${Math.max(
          0,
          Math.min(layer.opacity, 1),
        )}" href="data:image/png;base64,${qrBuffer.toString('base64')}" />
      </svg>
    `);

    return { input: fadedQr, left, top };
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
