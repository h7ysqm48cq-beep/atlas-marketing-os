import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class BrandOverlayService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(options: {
    image: Buffer;
    brandId: string;
    width: number;
    height: number;
  }): Promise<Buffer> {
    const brand = await this.prisma.brand.findUnique({
      where: {
        id: options.brandId,
      },
    });

    if (!brand) {
      return options.image;
    }

    const brandKit =
      typeof brand.brandKit === 'object' && brand.brandKit !== null
        ? (brand.brandKit as Record<string, any>)
        : {};

    const watermark = brandKit.watermark ?? {};

    if (!watermark.enabled) {
      return options.image;
    }

    const logoAssetId = watermark.assetId ?? brand.primaryLogoAssetId;

    if (!logoAssetId) {
      return options.image;
    }

    const logoAsset = await this.prisma.asset.findUnique({
      where: {
        id: logoAssetId,
      },
    });

    if (!logoAsset?.url) {
      return options.image;
    }

    const response = await fetch(logoAsset.url);

    if (!response.ok) {
      return options.image;
    }

    const logoBuffer = Buffer.from(await response.arrayBuffer());

    const scale = typeof watermark.scale === 'number' ? watermark.scale : 1;

    const opacity =
      typeof watermark.opacity === 'number' ? watermark.opacity : 0.9;

    const logoWidth = Math.round(options.width * 0.18 * scale);

    const resizedLogo = await sharp(logoBuffer)
      .resize({
        width: logoWidth,
        fit: 'inside',
      })
      .ensureAlpha()
      .linear([1, 1, 1, opacity], [0, 0, 0, 0])
      .png()
      .toBuffer();

    const metadata = await sharp(resizedLogo).metadata();

    const width = metadata.width ?? logoWidth;

    const height = metadata.height ?? 80;

    const margin = 40;

    const position = watermark.position ?? 'bottom-right';

    const coordinates = this.resolvePosition(
      position,
      options.width,
      options.height,
      width,
      height,
      margin,
    );

    return sharp(options.image)
      .composite([
        {
          input: resizedLogo,
          left: coordinates.left,
          top: coordinates.top,
        },
      ])
      .png()
      .toBuffer();
  }

  private resolvePosition(
    position: string,
    canvasWidth: number,
    canvasHeight: number,
    logoWidth: number,
    logoHeight: number,
    margin: number,
  ) {
    switch (position) {
      case 'top-left':
        return {
          left: margin,
          top: margin,
        };

      case 'top-right':
        return {
          left: canvasWidth - logoWidth - margin,
          top: margin,
        };

      case 'bottom-left':
        return {
          left: margin,
          top: canvasHeight - logoHeight - margin,
        };

      case 'center':
        return {
          left: (canvasWidth - logoWidth) / 2,
          top: (canvasHeight - logoHeight) / 2,
        };

      case 'bottom-right':
      default:
        return {
          left: canvasWidth - logoWidth - margin,
          top: canvasHeight - logoHeight - margin,
        };
    }
  }
}
