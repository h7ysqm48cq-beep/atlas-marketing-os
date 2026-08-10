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
     * M-Sports Editorial Layout v2
     *
     * AI generates only the sports visual background.
     * All factual text, edition labels, story hierarchy,
     * branding and metadata remain deterministic here.
     */
    const visibleHighlights = highlights
      .map((item) => ({
        zh: item?.zh?.trim() || '',
        en: item?.en?.trim() || '',
      }))
      .filter((item) => Boolean(item.zh || item.en))
      .slice(0, 3);

    const escapeXml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const accent = edition === 'EVENING' ? '#d7a449' : '#f0c14b';

    const secondaryAccent = edition === 'EVENING' ? '#b9232f' : '#1476d4';

    const editionZh =
      edition === 'EVENING' ? '满贯门体育晚报' : '满贯门体育早报';

    const editionEn =
      edition === 'EVENING' ? 'EVENING REPORT' : 'MORNING REPORT';

    const sectionLabel =
      edition === 'EVENING'
        ? '今日焦点  /  TOP STORIES'
        : '今日焦点  /  TOP STORIES';

    /*
     * Editorial masthead:
     * smaller than v1 so the sports visual remains the hero.
     */
    const mastheadHeight = Math.max(150, Math.round(height * 0.12));

    const mastheadSvg = Buffer.from(`
      <svg
        width="${width}"
        height="${mastheadHeight}"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="mastheadFade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="rgba(4,10,20,0.76)" />
            <stop offset="68%" stop-color="rgba(4,10,20,0.22)" />
            <stop offset="100%" stop-color="rgba(4,10,20,0)" />
          </linearGradient>
        </defs>

        <rect
          x="0"
          y="0"
          width="${width}"
          height="${mastheadHeight}"
          fill="url(#mastheadFade)"
        />

        <text
          x="${Math.round(width * 0.055)}"
          y="${Math.round(mastheadHeight * 0.4)}"
          font-size="${Math.max(42, Math.round(width * 0.061))}"
          font-family="Arial Black, Arial, Helvetica, sans-serif"
          font-weight="900"
          font-style="italic"
          fill="#ffffff"
          stroke="rgba(0,0,0,0.30)"
          stroke-width="1.4"
          paint-order="stroke"
        >
          M-SPORTS
        </text>

        <text
          x="${Math.round(width * 0.057)}"
          y="${Math.round(mastheadHeight * 0.68)}"
          font-size="${Math.max(23, Math.round(width * 0.029))}"
          font-family="Noto Sans CJK SC, Noto Sans SC, WenQuanYi Zen Hei, sans-serif"
          font-weight="700"
          fill="${accent}"
        >
          ${escapeXml(editionZh)}
        </text>

        <text
          x="${Math.round(width * 0.057)}"
          y="${Math.round(mastheadHeight * 0.9)}"
          font-size="${Math.max(16, Math.round(width * 0.019))}"
          font-family="Arial, Helvetica, sans-serif"
          font-weight="700"
          letter-spacing="4"
          fill="rgba(255,255,255,0.84)"
        >
          ${editionEn}
        </text>
      </svg>
    `);

    composites.push({
      input: mastheadSvg,
      left: 0,
      top: Math.max(18, Math.round(height * 0.018)),
    });

    /*
     * Editorial story block:
     * Story 01 is the hero headline.
     * Stories 02-03 are secondary.
     *
     * This deliberately avoids the large black v1 card.
     */
    if (visibleHighlights.length > 0) {
      const panelWidth = Math.round(width * 0.89);
      const panelLeft = Math.round(width * 0.055);
      const panelHeight = Math.max(300, Math.round(height * 0.235));

      const panelTop = Math.max(
        Math.round(height * 0.61),
        footerTop - panelHeight - Math.round(height * 0.024),
      );

      const hero = visibleHighlights[0];

      const secondary = visibleHighlights.slice(1, 3);

      const heroZhSize = Math.max(33, Math.round(width * 0.039));

      const heroEnSize = Math.max(18, Math.round(width * 0.019));

      const secondaryZhSize = Math.max(20, Math.round(width * 0.023));

      const secondaryEnSize = Math.max(14, Math.round(width * 0.0155));

      const secondarySvg = secondary
        .map((story, index) => {
          const y =
            Math.round(panelHeight * 0.7) +
            index * Math.round(panelHeight * 0.19);

          return `
            <text
              x="${Math.round(panelWidth * 0.03)}"
              y="${y}"
              font-size="${Math.max(18, Math.round(width * 0.021))}"
              font-family="Arial, Helvetica, sans-serif"
              font-weight="800"
              fill="${accent}"
            >
              ${String(index + 2).padStart(2, '0')}
            </text>

            <text
              x="${Math.round(panelWidth * 0.12)}"
              y="${y}"
              font-size="${secondaryZhSize}"
              font-family="Noto Sans CJK SC, Noto Sans SC, WenQuanYi Zen Hei, sans-serif"
              font-weight="700"
              fill="#ffffff"
            >
              ${escapeXml(story.zh)}
            </text>

            <text
              x="${Math.round(panelWidth * 0.12)}"
              y="${y + Math.round(secondaryEnSize * 1.55)}"
              font-size="${secondaryEnSize}"
              font-family="Arial, Helvetica, sans-serif"
              font-weight="500"
              fill="rgba(255,255,255,0.72)"
            >
              ${escapeXml(story.en)}
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
          <defs>
            <linearGradient
              id="editorialPanel"
              x1="0"
              y1="0"
              x2="1"
              y2="1"
            >
              <stop
                offset="0%"
                stop-color="rgba(4,10,18,0.80)"
              />
              <stop
                offset="64%"
                stop-color="rgba(4,10,18,0.60)"
              />
              <stop
                offset="100%"
                stop-color="rgba(4,10,18,0.22)"
              />
            </linearGradient>
          </defs>

          <rect
            x="0"
            y="0"
            width="${panelWidth}"
            height="${panelHeight}"
            rx="10"
            ry="10"
            fill="url(#editorialPanel)"
          />

          <rect
            x="0"
            y="0"
            width="7"
            height="${panelHeight}"
            rx="3"
            fill="${accent}"
          />

          <rect
            x="${Math.round(panelWidth * 0.03)}"
            y="${Math.round(panelHeight * 0.08)}"
            width="${Math.round(panelWidth * 0.31)}"
            height="${Math.max(34, Math.round(panelHeight * 0.12))}"
            rx="6"
            fill="${secondaryAccent}"
          />

          <text
            x="${Math.round(panelWidth * 0.048)}"
            y="${Math.round(panelHeight * 0.165)}"
            font-size="${Math.max(15, Math.round(width * 0.017))}"
            font-family="Arial, Helvetica, sans-serif"
            font-weight="800"
            fill="#ffffff"
            letter-spacing="1.8"
          >
            ${escapeXml(sectionLabel)}
          </text>

          <text
            x="${Math.round(panelWidth * 0.03)}"
            y="${Math.round(panelHeight * 0.37)}"
            font-size="${Math.max(22, Math.round(width * 0.026))}"
            font-family="Arial, Helvetica, sans-serif"
            font-weight="900"
            fill="${accent}"
          >
            01
          </text>

          <text
            x="${Math.round(panelWidth * 0.12)}"
            y="${Math.round(panelHeight * 0.355)}"
            font-size="${heroZhSize}"
            font-family="Noto Sans CJK SC, Noto Sans SC, WenQuanYi Zen Hei, sans-serif"
            font-weight="800"
            fill="#ffffff"
          >
            ${escapeXml(hero.zh)}
          </text>

          <text
            x="${Math.round(panelWidth * 0.12)}"
            y="${Math.round(panelHeight * 0.485)}"
            font-size="${heroEnSize}"
            font-family="Arial, Helvetica, sans-serif"
            font-weight="600"
            fill="rgba(255,255,255,0.76)"
          >
            ${escapeXml(hero.en)}
          </text>

          <line
            x1="${Math.round(panelWidth * 0.03)}"
            y1="${Math.round(panelHeight * 0.605)}"
            x2="${Math.round(panelWidth * 0.97)}"
            y2="${Math.round(panelHeight * 0.605)}"
            stroke="rgba(255,255,255,0.16)"
            stroke-width="1"
          />

          ${secondarySvg}
        </svg>
      `);

      composites.push({
        input: highlightSvg,
        left: panelLeft,
        top: panelTop,
      });

      this.logger.log(
        `M-Sports Editorial Layout v2.1 applied: ${visibleHighlights.length} story item(s).`,
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
