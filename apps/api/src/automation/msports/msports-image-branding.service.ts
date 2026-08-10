import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { PrismaService } from '../../database/prisma.service';
import { LogoOverlayService, LogoPlacement } from '../../image/logo';
import { SupabaseStorageService } from '../../storage/supabase-storage.service';

@Injectable()
export class MSportsImageBrandingService {
  private readonly logger = new Logger(MSportsImageBrandingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly logoOverlay: LogoOverlayService,
    private readonly storageService: SupabaseStorageService,
  ) {}

  async apply(input: {
    imageUrl: string;
    logoAssetId?: string | null;
    footerText?: string;
    qrLink?: string | null;
    edition?: 'MORNING' | 'EVENING';
    highlights?: Array<{
      zh: string;
      en: string;
    }>;
  }) {
    const {
      imageUrl,
      logoAssetId,
      footerText = '满贯门 mgmbetmyr.com',
      qrLink = 'https://mgmbetmyr.com',
      edition = 'MORNING',
      highlights = [],
    } = input;

    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(
        `Unable to download generated image. HTTP ${response.status}`,
      );
    }

    const baseBuffer = Buffer.from(await response.arrayBuffer());

    const baseMetadata = await sharp(baseBuffer).metadata();

    if (!baseMetadata.width || !baseMetadata.height) {
      throw new Error('Unable to determine generated image dimensions.');
    }

    const width = baseMetadata.width;
    const height = baseMetadata.height;

    let workingBuffer: Buffer = baseBuffer;

    /*
     * M-Sports watermark:
     * reuse the existing global LogoOverlayService.
     *
     * Keep the watermark away from the bottom footer,
     * footer logo and QR area.
     */
    if (logoAssetId) {
      try {
        const logoAsset = await this.prisma.asset.findUnique({
          where: {
            id: logoAssetId,
          },
          select: {
            url: true,
          },
        });

        if (logoAsset?.url) {
          const logoResponse = await fetch(logoAsset.url);

          if (logoResponse.ok) {
            const logoBuffer = Buffer.from(await logoResponse.arrayBuffer());

            const overlaid = await this.logoOverlay.overlay({
              image: workingBuffer,
              logo: logoBuffer,
              width,
              height,
              platform: 'Telegram',
              placement: LogoPlacement.TOP_RIGHT,
              scale: 0.72,
              opacity: 0.72,
            });

            /*
             * Normalize the returned Buffer so Node's generic
             * Buffer<ArrayBufferLike> typing does not leak into
             * the rest of the Sharp pipeline.
             */
            workingBuffer = Buffer.from(overlaid);

            this.logger.log(
              'M-Sports watermark applied using global LogoOverlayService.',
            );
          } else {
            this.logger.warn(
              `M-Sports watermark logo download returned HTTP ${logoResponse.status}.`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `M-Sports watermark skipped: ${
            error instanceof Error ? error.message : 'Unknown watermark error'
          }`,
        );
      }
    }

    const footerHeight = Math.max(88, Math.round(height * 0.085));

    const footerTop = height - footerHeight;

    const composites: sharp.OverlayOptions[] = [];

    /*
     * Deterministic M-Sports masthead.
     *
     * Typography is rendered here rather than by the image model
     * so spelling and brand presentation remain stable.
     */
    const mastheadHeight = Math.max(150, Math.round(height * 0.13));
    const mastheadTop = Math.max(22, Math.round(height * 0.025));

    const mastheadTitleSize = Math.max(64, Math.round(width * 0.095));

    const mastheadSubtitleSize = Math.max(30, Math.round(width * 0.042));

    const mastheadSubtitle =
      edition === 'EVENING' ? '满贯门体育晚报' : '满贯门体育早报';

    const mastheadSvg = Buffer.from(`
      <svg
        width="${width}"
        height="${mastheadHeight}"
        xmlns="http://www.w3.org/2000/svg"
      >
        <text
          x="${Math.round(width * 0.075)}"
          y="${Math.round(mastheadHeight * 0.52)}"
          font-size="${mastheadTitleSize}"
          font-family="Arial Black, Arial, Helvetica, sans-serif"
          font-weight="900"
          font-style="italic"
          fill="#ffffff"
          stroke="rgba(0,0,0,0.32)"
          stroke-width="2"
          paint-order="stroke"
        >
          M-Sports
        </text>

        <text
          x="${Math.round(width * 0.078)}"
          y="${Math.round(mastheadHeight * 0.87)}"
          font-size="${mastheadSubtitleSize}"
          font-family="Noto Sans CJK SC, Noto Sans SC, WenQuanYi Zen Hei, sans-serif"
          font-weight="700"
          fill="#ffffff"
          stroke="rgba(0,0,0,0.30)"
          stroke-width="1.5"
          paint-order="stroke"
        >
          ${mastheadSubtitle}
        </text>
      </svg>
    `);

    composites.push({
      input: mastheadSvg,
      left: 0,
      top: mastheadTop,
    });

    /*
     * Deterministic M-Sports highlights.
     *
     * News text is NOT generated by the image model here.
     * It comes from freshness-validated stories produced by
     * SportsNewsAutomationService.
     */
    const visibleHighlights = highlights
      .map((item) => ({
        zh: item?.zh?.trim() || '',
        en: item?.en?.trim() || '',
      }))
      .filter((item) => Boolean(item.zh || item.en))
      .slice(0, 3);

    if (visibleHighlights.length > 0) {
      const escapeXml = (value: string) =>
        value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

      const panelWidth = Math.round(width * 0.88);
      const panelLeft = Math.round((width - panelWidth) / 2);
      const panelHeight = Math.max(315, Math.round(height * 0.265));

      const panelBottomGap = Math.max(56, Math.round(height * 0.04));

      const panelTop = Math.max(
        Math.round(height * 0.52),
        footerTop - panelHeight - panelBottomGap,
      );

      const titleSize = Math.max(26, Math.round(width * 0.031));

      const editionLabel =
        edition === 'EVENING'
          ? '今日晚报重点  /  EVENING HIGHLIGHTS'
          : '今日早报重点  /  MORNING HIGHLIGHTS';

      const itemStartY = Math.round(panelHeight * 0.39);
      const itemGap = Math.round(panelHeight * 0.195);

      const zhSize = Math.max(25, Math.round(width * 0.029));
      const enSize = Math.max(16, Math.round(width * 0.019));

      const itemSvg = visibleHighlights
        .map((highlight, index) => {
          const safeZh = escapeXml(highlight.zh);
          const safeEn = escapeXml(highlight.en);
          const number = String(index + 1).padStart(2, '0');
          const y = itemStartY + index * itemGap;

          return `
            <text
              x="42"
              y="${y}"
              font-size="${zhSize}"
              font-family="Noto Sans CJK SC, Noto Sans SC, WenQuanYi Zen Hei, sans-serif"
              font-weight="700"
              fill="#ffffff"
            >
              <tspan
                fill="#d6b36a"
                font-weight="700"
              >${number}</tspan>

              <tspan dx="18">${safeZh}</tspan>
            </text>

            <text
              x="92"
              y="${y + Math.round(enSize * 1.55)}"
              font-size="${enSize}"
              font-family="Arial, Helvetica, sans-serif"
              font-weight="500"
              fill="rgba(255,255,255,0.76)"
            >
              ${safeEn}
            </text>
          `;
        })
        .join('');

      const highlightSvg = Buffer.from(`
        <svg
          width="${panelWidth}"
          height="${panelHeight}"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="0"
            y="0"
            width="${panelWidth}"
            height="${panelHeight}"
            rx="24"
            ry="24"
            fill="rgba(5,10,18,0.82)"
          />

          <rect
            x="0"
            y="0"
            width="6"
            height="${panelHeight}"
            rx="3"
            fill="#d6b36a"
          />

          <text
            x="42"
            y="${Math.round(panelHeight * 0.22)}"
            font-size="${titleSize}"
            font-family="Noto Sans CJK SC, Noto Sans SC, WenQuanYi Zen Hei, sans-serif"
            font-weight="700"
            fill="#ffffff"
          >
            ${escapeXml(editionLabel)}
          </text>

          ${itemSvg}
        </svg>
      `);

      composites.push({
        input: highlightSvg,
        left: panelLeft,
        top: panelTop,
      });

      this.logger.log(
        `M-Sports deterministic highlight overlay applied: ${visibleHighlights.length} item(s).`,
      );
    }

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
          font-family="Noto Sans CJK SC, Noto Sans SC, WenQuanYi Zen Hei, sans-serif"
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

    const output = await sharp(workingBuffer)
      .composite(composites)
      .png()
      .toBuffer();

    const uploaded = await this.storageService.uploadImage({
      buffer: output,
      path: [
        'automation',
        'msports',
        new Date().toISOString().slice(0, 10),
        `sports-news-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 10)}.png`,
      ].join('/'),
      contentType: 'image/png',
    });

    this.logger.log(
      `M-Sports branded image uploaded to Supabase: ${uploaded.path}`,
    );

    return {
      imageDataUrl: uploaded.publicUrl,
      imageUrl: uploaded.publicUrl,
      storageProvider: uploaded.provider,
      storagePath: uploaded.path,
      footerApplied: true,
      qrApplied: Boolean(qrSize),
      logoApplied: Boolean(logoWidth),
    };
  }
}
