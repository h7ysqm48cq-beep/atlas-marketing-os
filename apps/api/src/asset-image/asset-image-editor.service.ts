import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp, { OverlayOptions } from 'sharp';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import {
  CompositeExistingAssetDto,
  ImageEditorLayerDto,
} from './dto/composite-existing-asset.dto';

@Injectable()
export class AssetImageEditorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
    private readonly storageService: SupabaseStorageService,
  ) {}

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
      throw new NotFoundException('Image asset was not found for the active brand.');
    }

    if (!sourceAsset.url?.startsWith('https://')) {
      throw new BadRequestException('The selected image does not have a usable URL.');
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
      throw new BadRequestException('Unable to determine the selected image size.');
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
      Math.max(0, Math.min(height - logoHeight, layer.y * height - logoHeight / 2)),
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

  private escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'edited-image';
  }
}
