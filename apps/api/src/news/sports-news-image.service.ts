import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { PrismaService } from '../database/prisma.service';
import { ImageService } from '../image/image.service';

export type SportsNewsImageSettings = {
  imageEnabled: boolean;
  imagePrompt?: string | null;
  morningImagePrompt?: string | null;
  eveningImagePrompt?: string | null;
  imageAspectRatio: string;
  imageTextMode: string;
  imageVisualStyle?: string | null;

  logoEnabled: boolean;
  logoAssetId?: string | null;
  logoPosition: string;
  logoSize: string;
  logoOpacity: number;
  logoMargin: number;

  brandFooterEnabled: boolean;
  brandFooterText: string;

  footerLogoEnabled: boolean;
  footerLogoAssetId?: string | null;

  footerQrEnabled: boolean;
  footerQrAssetId?: string | null;
  footerQrLink?: string | null;

  footerPlacement: string;
};

type BrandingResult = {
  imageDataUrl: string;
  watermarkApplied: boolean;
  footerApplied: boolean;
};

@Injectable()
export class SportsNewsImageService {
  private readonly logger = new Logger(SportsNewsImageService.name);

  constructor(
    private readonly images: ImageService,
    private readonly prisma: PrismaService,
  ) {}

  async generate(
    kind: 'morning' | 'evening',
    content: string,
    settings: SportsNewsImageSettings,
  ) {
    if (!settings.imageEnabled) {
      return null;
    }

    const editionPrompt =
      kind === 'morning'
        ? settings.morningImagePrompt
        : settings.eveningImagePrompt;

    const size = this.size(settings.imageAspectRatio);

    const prompt = [
      `Create a premium editorial sports-news poster for the ${kind} edition.`,
      `Brand identity: M-Sports / 满贯门体育新闻.`,
      `Never write "Atlas Sports", "Atlas Sports News" or "Atlas" anywhere in the image.`,
      `Use the compact verified context below only as factual guidance.`,
      `Do not reproduce the report itself.`,
      `Do not render URLs, source references, markdown, citations or long paragraphs.`,
      `Do not invent scores, names, teams, logos, trophies, quotes or events not present in the verified context.`,
      `Do not generate, imitate, redraw or fabricate the MGM logo or any brand logo.`,
      `Do not generate any footer branding. Real logo, footer text and QR branding will be composited after image generation.`,
      settings.logoEnabled
        ? `Keep the ${settings.logoPosition} branding area visually clean and uncluttered.`
        : '',
      settings.brandFooterEnabled
        ? `Keep the lower edge visually clean for a professionally composited brand footer.`
        : '',
      `Visual style: ${
        settings.imageVisualStyle?.trim() ||
        'modern cinematic sports editorial, energetic, clean, premium and Malaysia social-media friendly'
      }.`,
      `Text density: ${settings.imageTextMode}.`,
      `Keep image text concise. Prioritize one strong sports-news headline and only a few verified key points.`,
      settings.imagePrompt?.trim() || '',
      editionPrompt?.trim() || '',
      `VERIFIED VISUAL CONTEXT:\n${this.compactVisualContext(content)}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const result = await this.images.generate({
      prompt,
      size,
      quality: 'medium',
    });

    try {
      if (result.ok !== true) {
        throw new Error(
          result.message || 'Image generation failed.',
        );
      }

      const branding = await this.applyBranding(result.imageDataUrl, settings);

      return {
        ...result,
        imageDataUrl: branding.imageDataUrl,
        prompt,
        watermarkApplied: branding.watermarkApplied,
        footerApplied: branding.footerApplied,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown sports branding error';

      this.logger.warn(`M-Sports image branding skipped: ${message}`);

      return {
        ...result,
        prompt,
        watermarkApplied: false,
        footerApplied: false,
        watermarkError: message,
      };
    }
  }

  private compactVisualContext(content: string): string {
    const cleaned = content
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/www\.\S+/gi, '')
      .replace(/[#*_`>|\[\](){}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) {
      return 'General verified sports-news editorial context.';
    }

    /*
     * Image generation does not need the full published report.
     * Keep only a compact factual context to reduce transport/model
     * complexity and prevent long report text from appearing in artwork.
     */
    return cleaned.slice(0, 700);
  }

  private async applyBranding(
    imageDataUrl: string,
    settings: SportsNewsImageSettings,
  ): Promise<BrandingResult> {
    const baseBuffer = this.dataUrlToBuffer(imageDataUrl);

    const metadata = await sharp(baseBuffer).metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Unable to determine generated image dimensions.');
    }

    const width = metadata.width;
    const height = metadata.height;

    const footerEnabled =
      settings.brandFooterEnabled && Boolean(settings.brandFooterText?.trim());

    const footerLogoEnabled =
      footerEnabled && Boolean(settings.footerLogoEnabled);

    const footerQrEnabled = footerEnabled && Boolean(settings.footerQrEnabled);

    const footerHeight = footerEnabled
      ? Math.max(92, Math.round(height * 0.085))
      : 0;

    const composites: sharp.OverlayOptions[] = [];

    let watermarkApplied = false;
    let footerApplied = false;

    /*
     * ==========================================================
     * HELPERS
     * ==========================================================
     */

    const loadAsset = async (
      assetId: string | null | undefined,
      label: string,
    ): Promise<Buffer | null> => {
      if (!assetId) return null;

      const asset = await this.prisma.asset.findUnique({
        where: {
          id: assetId,
        },
        select: {
          id: true,
          url: true,
        },
      });

      if (!asset?.url) {
        throw new Error(
          `${label} asset ${assetId} was not found or has no URL.`,
        );
      }

      const response = await fetch(asset.url, {
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(
          `Unable to download ${label} asset. HTTP ${response.status}.`,
        );
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType && !contentType.startsWith('image/')) {
        throw new Error(`${label} asset is not an image (${contentType}).`);
      }

      return Buffer.from(await response.arrayBuffer());
    };

    const applyOpacity = async (
      input: Buffer,
      opacityPercent: number,
    ): Promise<Buffer> => {
      const opacity = Math.max(0, Math.min(100, opacityPercent)) / 100;

      let image = sharp(input).ensureAlpha();

      if (opacity >= 1) {
        return image.png().toBuffer();
      }

      const { data, info } = await image.raw().toBuffer({
        resolveWithObject: true,
      });

      for (let index = 3; index < data.length; index += info.channels) {
        data[index] = Math.round(data[index] * opacity);
      }

      return sharp(data, {
        raw: {
          width: info.width,
          height: info.height,
          channels: info.channels,
        },
      })
        .png()
        .toBuffer();
    };

    /*
     * ==========================================================
     * FOOTER
     * ==========================================================
     */

    if (footerEnabled) {
      const footerTop = height - footerHeight;

      const horizontalPadding = Math.max(22, Math.round(width * 0.025));

      const gap = Math.max(14, Math.round(width * 0.014));

      /*
       * Footer background.
       */
      const footerBackground = Buffer.from(`
        <svg
          width="${width}"
          height="${footerHeight}"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            width="${width}"
            height="${footerHeight}"
            fill="rgba(8,12,20,0.94)"
          />
          <rect
            x="0"
            y="0"
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

      /*
       * --------------------------------------------------------
       * FOOTER LOGO
       *
       * Dedicated footer asset first.
       * Falls back to watermark logo.
       * --------------------------------------------------------
       */

      const footerLogoAssetId =
        settings.footerLogoAssetId || settings.logoAssetId || null;

      let preparedFooterLogo: Buffer | null = null;
      let footerLogoWidth = 0;
      let footerLogoHeight = 0;

      if (footerLogoEnabled && footerLogoAssetId) {
        const sourceLogo = await loadAsset(footerLogoAssetId, 'Footer logo');

        if (sourceLogo) {
          const maxLogoHeight = Math.max(34, Math.round(footerHeight * 0.459));

          preparedFooterLogo = await sharp(sourceLogo)
            .ensureAlpha()
            .resize({
              height: maxLogoHeight,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .png()
            .toBuffer();

          const logoMeta = await sharp(preparedFooterLogo).metadata();

          footerLogoWidth = logoMeta.width || maxLogoHeight;

          footerLogoHeight = logoMeta.height || maxLogoHeight;
        }
      }

      /*
       * --------------------------------------------------------
       * FOOTER QR
       *
       * Priority:
       *
       * 1. Real QR asset from Asset Library
       * 2. Generate a real QR from footerQrLink
       *
       * Never ask the image model to draw a QR.
       * --------------------------------------------------------
       */

      let preparedQr: Buffer | null = null;
      let qrSize = 0;

      if (footerQrEnabled) {
        let sourceQr: Buffer | null = null;

        if (settings.footerQrAssetId) {
          /*
           * Highest priority:
           * use the exact QR image selected by the user.
           */
          sourceQr = await loadAsset(settings.footerQrAssetId, 'Footer QR');
        } else if (settings.footerQrLink?.trim()) {
          /*
           * No QR asset:
           * generate a real machine-readable QR from URL.
           */
          const qrLink = settings.footerQrLink.trim();

          let parsedUrl: URL;

          try {
            parsedUrl = new URL(qrLink);
          } catch {
            throw new Error('Footer QR Link is not a valid URL.');
          }

          if (
            parsedUrl.protocol !== 'http:' &&
            parsedUrl.protocol !== 'https:'
          ) {
            throw new Error('Footer QR Link must use http:// or https://.');
          }

          sourceQr = await QRCode.toBuffer(qrLink, {
            type: 'png',
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 512,
          });
        }

        if (sourceQr) {
          qrSize = Math.max(44, Math.round(footerHeight * 0.6));

          /*
           * Nearest-neighbour keeps QR edges crisp.
           * Do not blur/interpolate QR modules.
           */
          preparedQr = await sharp(sourceQr)
            .resize({
              width: qrSize,
              height: qrSize,
              fit: 'contain',
              withoutEnlargement: false,
              kernel: sharp.kernel.nearest,
              background: {
                r: 255,
                g: 255,
                b: 255,
                alpha: 1,
              },
            })
            .png()
            .toBuffer();

          const qrMetadata = await sharp(preparedQr).metadata();

          qrSize = Math.max(
            qrMetadata.width || qrSize,
            qrMetadata.height || qrSize,
          );
        }
      }

      /*
       * --------------------------------------------------------
       * AUTO PLACEMENT
       *
       * Default:
       *
       * [LOGO] [TEXT]                        [QR]
       *
       * Other placement modes remain supported.
       * --------------------------------------------------------
       */

      const placement = settings.footerPlacement?.trim() || 'auto';

      const text = settings.brandFooterText.trim();

      const fontSize = Math.max(18, Math.round(width * 0.021));

      let logoLeft = horizontalPadding;

      let qrLeft = width - horizontalPadding - qrSize;

      let textLeft = horizontalPadding;

      let textRightPadding = horizontalPadding;

      if (placement === 'auto' || placement === 'logo-text-qr') {
        if (preparedFooterLogo) {
          textLeft = logoLeft + footerLogoWidth + gap;
        }

        if (preparedQr) {
          textRightPadding = width - qrLeft + gap;
        }
      } else if (placement === 'logo-qr-text') {
        if (preparedFooterLogo) {
          logoLeft = horizontalPadding;
        }

        if (preparedQr) {
          qrLeft = logoLeft + footerLogoWidth + (preparedFooterLogo ? gap : 0);

          textLeft = qrLeft + qrSize + gap;
        } else if (preparedFooterLogo) {
          textLeft = logoLeft + footerLogoWidth + gap;
        }
      } else if (placement === 'text-logo-qr') {
        /*
         * Text stays on the left.
         * Logo and QR move to the right.
         */
        if (preparedQr) {
          qrLeft = width - horizontalPadding - qrSize;
        }

        if (preparedFooterLogo) {
          logoLeft =
            (preparedQr ? qrLeft - gap : width - horizontalPadding) -
            footerLogoWidth;

          textRightPadding = width - logoLeft + gap;
        } else if (preparedQr) {
          textRightPadding = width - qrLeft + gap;
        }
      }

      /*
       * Footer text.
       */

      const safeTextWidth = Math.max(80, width - textLeft - textRightPadding);

      const escapedText = this.escapeXml(text);

      const footerTextSvg = Buffer.from(`
        <svg
          width="${width}"
          height="${footerHeight}"
          xmlns="http://www.w3.org/2000/svg"
        >
          <text
            x="${textLeft}"
            y="${Math.round(footerHeight / 2)}"
            dominant-baseline="middle"
            fill="#ffffff"
            font-size="${fontSize}"
            font-family="Arial, Helvetica, sans-serif"
            font-weight="600"
          >
            ${escapedText}
          </text>
        </svg>
      `);

      /*
       * safeTextWidth is intentionally calculated even though
       * SVG text clipping is not forced yet. It protects the
       * placement calculations and gives us a clean extension
       * point for ellipsis/wrapping later.
       */
      void safeTextWidth;

      composites.push({
        input: footerTextSvg,
        left: 0,
        top: footerTop,
      });

      /*
       * Footer logo.
       */

      if (preparedFooterLogo) {
        const logoTop =
          footerTop +
          Math.max(0, Math.round((footerHeight - footerLogoHeight) / 2));

        composites.push({
          input: preparedFooterLogo,
          left: Math.max(horizontalPadding, Math.round(logoLeft)),
          top: logoTop,
        });
      }

      /*
       * Footer QR.
       */

      if (preparedQr) {
        const qrTop =
          footerTop + Math.max(0, Math.round((footerHeight - qrSize) / 2));

        composites.push({
          input: preparedQr,
          left: Math.max(horizontalPadding, Math.round(qrLeft)),
          top: qrTop,
        });
      }

      footerApplied = true;
    }

    /*
     * ==========================================================
     * INDEPENDENT FLOATING WATERMARK
     *
     * IMPORTANT:
     * Footer does NOT disable watermark anymore.
     * They are completely independent.
     * ==========================================================
     */

    if (settings.logoEnabled && settings.logoAssetId) {
      const sourceLogo = await loadAsset(
        settings.logoAssetId,
        'Watermark logo',
      );

      if (sourceLogo) {
        const targetWidth = this.logoWidth(width, settings.logoSize);

        let preparedLogo = await sharp(sourceLogo)
          .ensureAlpha()
          .resize({
            width: targetWidth,
            withoutEnlargement: true,
            fit: 'inside',
          })
          .png()
          .toBuffer();

        preparedLogo = await applyOpacity(preparedLogo, settings.logoOpacity);

        const logoMetadata = await sharp(preparedLogo).metadata();

        const logoWidth = logoMetadata.width || targetWidth;

        const logoHeight = logoMetadata.height || targetWidth;

        const margin = Math.max(
          0,
          Math.min(
            Math.floor(Math.min(width, height) / 4),
            Math.floor(settings.logoMargin),
          ),
        );

        const usableHeight = footerEnabled ? height - footerHeight : height;

        const coordinates = this.logoCoordinates(
          settings.logoPosition,
          width,
          usableHeight,
          logoWidth,
          logoHeight,
          margin,
        );

        composites.push({
          input: preparedLogo,
          left: coordinates.left,
          top: coordinates.top,
        });

        watermarkApplied = true;
      }
    }

    if (composites.length === 0) {
      return {
        imageDataUrl,
        watermarkApplied: false,
        footerApplied: false,
      };
    }

    const output = await sharp(baseBuffer)
      .composite(composites)
      .png()
      .toBuffer();

    return {
      imageDataUrl: `data:image/png;base64,${output.toString('base64')}`,
      watermarkApplied,
      footerApplied,
    };
  }

  private logoCoordinates(
    position: string,
    imageWidth: number,
    imageHeight: number,
    logoWidth: number,
    logoHeight: number,
    margin: number,
  ): {
    left: number;
    top: number;
  } {
    const left = margin;

    const right = Math.max(margin, imageWidth - logoWidth - margin);

    const top = margin;

    const bottom = Math.max(margin, imageHeight - logoHeight - margin);

    const centerLeft = Math.max(0, Math.round((imageWidth - logoWidth) / 2));

    const centerTop = Math.max(0, Math.round((imageHeight - logoHeight) / 2));

    switch (position) {
      case 'top-left':
        return { left, top };

      case 'top-right':
        return {
          left: right,
          top,
        };

      case 'top-center':
        return {
          left: centerLeft,
          top,
        };

      case 'bottom-left':
        return {
          left,
          top: bottom,
        };

      case 'bottom-center':
        return {
          left: centerLeft,
          top: bottom,
        };

      case 'center':
        return {
          left: centerLeft,
          top: centerTop,
        };

      case 'bottom-right':
      default:
        return {
          left: right,
          top: bottom,
        };
    }
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private dataUrlToBuffer(dataUrl: string): Buffer {
    const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);

    if (!match?.[1]) {
      throw new Error('Generated image is not a valid base64 image data URL.');
    }

    return Buffer.from(match[1], 'base64');
  }

  private logoWidth(imageWidth: number, size: string): number {
    const ratio = size === 'large' ? 0.22 : size === 'medium' ? 0.16 : 0.11;

    return Math.max(64, Math.round(imageWidth * ratio));
  }

  private size(ratio: string): '1024x1024' | '1024x1536' | '1536x1024' {
    if (ratio === '16:9') {
      return '1536x1024';
    }

    if (ratio === '9:16' || ratio === '4:5') {
      return '1024x1536';
    }

    return '1024x1024';
  }
}
