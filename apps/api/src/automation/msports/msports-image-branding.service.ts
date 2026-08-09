import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class MSportsImageBrandingService {
  private readonly logger = new Logger(MSportsImageBrandingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async apply(input: {
    imageUrl: string;
    logoAssetId?: string | null;
    footerText?: string;
    qrLink?: string | null;
  }) {
    const {
      imageUrl,
      logoAssetId,
      footerText = '满贯门 mgmbetmyr.com',
      qrLink = 'https://mgmbetmyr.com',
    } = input;

    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(
        `Unable to download generated image. HTTP ${response.status}`,
      );
    }

    const baseBuffer = Buffer.from(await response.arrayBuffer());

    const metadata = await sharp(baseBuffer).metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Unable to determine generated image dimensions.');
    }

    const width = metadata.width;
    const height = metadata.height;

    const footerHeight = Math.max(88, Math.round(height * 0.085));

    const footerTop = height - footerHeight;

    const composites: sharp.OverlayOptions[] = [];

    const footerBackground = Buffer.from(`
      <svg
        width="${width}"
        height="${footerHeight}"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          width="${width}"
          height="${footerHeight}"
          fill="rgba(8,12,20,0.95)"
        />
        <rect
          width="${width}"
          height="1"
          fill="rgba(255,255,255,0.14)"
        />
      </svg>
    `);

    composites.push({
      input: footerBackground,
      left: 0,
      top: footerTop,
    });

    let logoWidth = 0;
    let logoHeight = 0;

    if (logoAssetId) {
      const asset = await this.prisma.asset.findUnique({
        where: { id: logoAssetId },
        select: { url: true },
      });

      if (asset?.url) {
        try {
          const logoResponse = await fetch(asset.url);

          if (logoResponse.ok) {
            const logoBuffer = Buffer.from(await logoResponse.arrayBuffer());

            const preparedLogo = await sharp(logoBuffer)
              .ensureAlpha()
              .resize({
                height: Math.max(32, Math.round(footerHeight * 0.44)),
                fit: 'inside',
                withoutEnlargement: true,
              })
              .png()
              .toBuffer();

            const logoMeta = await sharp(preparedLogo).metadata();

            logoWidth = logoMeta.width || 0;
            logoHeight = logoMeta.height || 0;

            composites.push({
              input: preparedLogo,
              left: 24,
              top:
                footerTop +
                Math.max(0, Math.round((footerHeight - logoHeight) / 2)),
            });
          }
        } catch (error) {
          this.logger.warn(
            `M-Sports footer logo skipped: ${
              error instanceof Error ? error.message : 'Unknown logo error'
            }`,
          );
        }
      }
    }

    const safeFooterText = footerText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const textX = 24 + (logoWidth ? logoWidth + 18 : 0);

    const textSvg = Buffer.from(`
      <svg
        width="${width}"
        height="${footerHeight}"
        xmlns="http://www.w3.org/2000/svg"
      >
        <text
          x="${textX}"
          y="${Math.round(footerHeight / 2)}"
          dominant-baseline="middle"
          font-size="${Math.max(22, Math.round(footerHeight * 0.26))}"
          font-family="Arial, sans-serif"
          fill="#ffffff"
        >
          ${safeFooterText}
        </text>
      </svg>
    `);

    composites.push({
      input: textSvg,
      left: 0,
      top: footerTop,
    });

    let qrSize = 0;

    if (qrLink) {
      const parsed = new URL(qrLink);

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('QR link must use http:// or https://');
      }

      qrSize = Math.max(46, Math.round(footerHeight * 0.62));

      const qr = await QRCode.toBuffer(qrLink, {
        type: 'png',
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 512,
      });

      const preparedQr = await sharp(qr)
        .resize({
          width: qrSize,
          height: qrSize,
          fit: 'contain',
          kernel: sharp.kernel.nearest,
        })
        .png()
        .toBuffer();

      composites.push({
        input: preparedQr,
        left: width - qrSize - 24,
        top: footerTop + Math.max(0, Math.round((footerHeight - qrSize) / 2)),
      });
    }

    const output = await sharp(baseBuffer)
      .composite(composites)
      .png()
      .toBuffer();

    return {
      imageDataUrl: `data:image/png;base64,${output.toString('base64')}`,
      footerApplied: true,
      qrApplied: Boolean(qrSize),
      logoApplied: Boolean(logoWidth),
    };
  }
}
