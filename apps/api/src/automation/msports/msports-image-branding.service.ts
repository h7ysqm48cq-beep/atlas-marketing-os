import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { PrismaService } from '../../database/prisma.service';
import { LogoOverlayService, LogoPlacement } from '../../image/logo';
import { SupabaseStorageService } from '../../storage/supabase-storage.service';


function getMalaysiaDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

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

    footerLogoAssetId?: string | null;
    footerQrAssetId?: string | null;
    footerQrLink?: string | null;
    footerQrEnabled?: boolean;
    footerPlacement?: string;

    footerText?: string;
    footerTextEnabled?: boolean;
    qrLink?: string | null;
    edition?: 'MORNING' | 'EVENING';
    highlights?: Array<{
      zh: string;
      en: string;
    }>;

    branding?: {
      mastheadBrandText?: string;

      morningEditionZh?: string;
      eveningEditionZh?: string;

      morningEditionEn?: string;
      eveningEditionEn?: string;

      sectionLabel?: string;

      morningAccentColor?: string;
      eveningAccentColor?: string;

      morningSecondaryColor?: string;
      eveningSecondaryColor?: string;

      mastheadPrimaryColor?: string;
      mastheadEnglishColor?: string;

      headlinePrimaryColor?: string;
      headlineSecondaryColor?: string;

      panelBaseColor?: string;

      watermarkEnabled?: boolean;
      watermarkScale?: number;
      watermarkOpacity?: number;
      watermarkPosition?: string;

      qrSizePercent?: number;
      qrMarginPercent?: number;

      footerBackgroundColor?: string;
      footerSeparatorColor?: string;
    };

    layout?: {
      enabled?: boolean;

      storyPanelEnabled?: boolean;

      mastheadEnabled?: boolean;
      headlineTextEnabled?: boolean;

      mastheadScale?: number;
      mastheadTopPercent?: number;

      panelWidthPercent?: number;
      panelHeightPercent?: number;
      panelTopPercent?: number;

      panelOpacityStart?: number;
      panelOpacityMiddle?: number;
      panelOpacityEnd?: number;
      panelRadius?: number;

      heroHeadlineScale?: number;
      secondaryHeadlineScale?: number;

      story02PositionPercent?: number;
      story03PositionPercent?: number;

      footerHeightPercent?: number;
    };
  }) {
    const {
      imageUrl,
      logoAssetId,
      footerLogoAssetId,
      footerQrAssetId,
      footerQrLink,
      footerQrEnabled = false,
      footerPlacement = 'bottom',
      footerText,
      footerTextEnabled = true,
      qrLink = null,
      edition = 'MORNING',
      highlights = [],
      branding = {},
      layout = {},
    } = input;

    const mastheadBrandText = branding.mastheadBrandText ?? '';

    const morningEditionZh = branding.morningEditionZh ?? '';

    const eveningEditionZh = branding.eveningEditionZh ?? '';

    const morningEditionEn = branding.morningEditionEn ?? '';

    const eveningEditionEn = branding.eveningEditionEn ?? '';

    const configuredSectionLabel = branding.sectionLabel ?? '';

    const morningAccentColor = branding.morningAccentColor ?? '';

    const eveningAccentColor = branding.eveningAccentColor ?? '';

    const morningSecondaryColor = branding.morningSecondaryColor ?? '';

    const eveningSecondaryColor = branding.eveningSecondaryColor ?? '';

    const mastheadPrimaryColor = branding.mastheadPrimaryColor ?? '';

    const mastheadEnglishColor = branding.mastheadEnglishColor ?? '';

    const headlinePrimaryColor = branding.headlinePrimaryColor ?? '';

    const headlineSecondaryColor = branding.headlineSecondaryColor ?? '';

    const panelBaseColor = branding.panelBaseColor ?? '';

    const watermarkEnabled = branding.watermarkEnabled ?? false;

    const watermarkScale = branding.watermarkScale ?? 1;

    const watermarkOpacity = branding.watermarkOpacity ?? 1;

    const watermarkPosition = branding.watermarkPosition ?? 'top-right';

    const qrSizePercent = branding.qrSizePercent ?? 0;

    const qrMarginPercent = branding.qrMarginPercent ?? 0;

    const footerBackgroundColor =
      branding.footerBackgroundColor ?? 'transparent';

    const footerSeparatorColor = branding.footerSeparatorColor ?? 'transparent';

    const layoutEnabled = layout.enabled ?? true;

    const storyPanelEnabled =
      layout.storyPanelEnabled ?? false;

    const mastheadEnabled =
      layout.mastheadEnabled ?? true;

    const headlineTextEnabled =
      layout.headlineTextEnabled ?? true;

    const mastheadScale = layout.mastheadScale ?? 1;

    const mastheadTopPercent = layout.mastheadTopPercent ?? 0.018;

    const panelWidthPercent = layout.panelWidthPercent ?? 0.89;

    const panelHeightPercent = layout.panelHeightPercent ?? 0.235;

    const panelTopPercent = layout.panelTopPercent ?? 0.61;

    const panelOpacityStart = layout.panelOpacityStart ?? 0.8;

    const panelOpacityMiddle = layout.panelOpacityMiddle ?? 0.6;

    const panelOpacityEnd = layout.panelOpacityEnd ?? 0.22;

    const panelRadius = layout.panelRadius ?? 10;

    const heroHeadlineScale = layout.heroHeadlineScale ?? 1;

    const secondaryHeadlineScale = layout.secondaryHeadlineScale ?? 1;

    const story02PositionPercent = layout.story02PositionPercent ?? 0.7;

    const story03PositionPercent = layout.story03PositionPercent ?? 0.89;

    const footerHeightPercent = layout.footerHeightPercent ?? 0.085;

    const resolveLogoPlacement = (value: string): LogoPlacement => {
      switch (value.toLowerCase()) {
        case 'top-left':
          return LogoPlacement.TOP_LEFT;

        case 'top-center':
          return LogoPlacement.TOP_CENTER;

        case 'center':
          return LogoPlacement.CENTER;

        case 'bottom-left':
          return LogoPlacement.BOTTOM_LEFT;

        case 'bottom-center':
          return LogoPlacement.BOTTOM_CENTER;

        case 'bottom-right':
          return LogoPlacement.BOTTOM_RIGHT;

        case 'top-right':
        default:
          return LogoPlacement.TOP_RIGHT;
      }
    };

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
    if (logoAssetId && watermarkEnabled) {
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
              placement: resolveLogoPlacement(watermarkPosition),
              scale: watermarkScale,
              opacity: watermarkOpacity,
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

    const footerHeight = Math.max(48, Math.round(height * footerHeightPercent));

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

    const accent =
      edition === 'EVENING' ? eveningAccentColor : morningAccentColor;

    const secondaryAccent =
      edition === 'EVENING' ? eveningSecondaryColor : morningSecondaryColor;

    const editionZh =
      edition === 'EVENING' ? eveningEditionZh : morningEditionZh;

    const editionEn =
      edition === 'EVENING' ? eveningEditionEn : morningEditionEn;

    const sectionLabel = configuredSectionLabel;

    /*
     * Editorial masthead:
     * smaller than v1 so the sports visual remains the hero.
     */
    const mastheadHeight = Math.max(
      100,
      Math.round(height * 0.12 * mastheadScale),
    );

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
          fill="${mastheadPrimaryColor}"
          stroke="rgba(0,0,0,0.30)"
          stroke-width="1.4"
          paint-order="stroke"
        >
          ${escapeXml(mastheadBrandText)}
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
          fill="${mastheadEnglishColor}"
        >
          ${editionEn}
        </text>
      </svg>
    `);

    if (layoutEnabled && mastheadEnabled) {
      composites.push({
        input: mastheadSvg,
        left: 0,
        top: Math.max(0, Math.round(height * mastheadTopPercent)),
      });
    }

    /*
     * Editorial story block:
     * Story 01 is the hero headline.
     * Stories 02-03 are secondary.
     *
     * This deliberately avoids the large black v1 card.
     */
    if (
      layoutEnabled &&
      storyPanelEnabled &&
      visibleHighlights.length > 0
    ) {
      const panelWidth = Math.round(width * panelWidthPercent);

      const panelLeft = Math.round((width - panelWidth) / 2);

      const panelHeight = Math.max(
        180,
        Math.round(height * panelHeightPercent),
      );

      const panelTop = Math.max(
        0,
        Math.min(footerTop - panelHeight, Math.round(height * panelTopPercent)),
      );

      const hero = visibleHighlights[0];

      const secondary = visibleHighlights.slice(1, 3);

      const heroZhSize = Math.max(
        18,
        Math.round(width * 0.039 * heroHeadlineScale),
      );

      const heroEnSize = Math.max(
        12,
        Math.round(width * 0.019 * heroHeadlineScale),
      );

      const secondaryZhSize = Math.max(
        14,
        Math.round(width * 0.023 * secondaryHeadlineScale),
      );

      const secondaryEnSize = Math.max(
        10,
        Math.round(width * 0.0155 * secondaryHeadlineScale),
      );

      const secondarySvg = !headlineTextEnabled
        ? ''
        : secondary
            .map((story, index) => {
              const yPercent =
                index === 0 ? story02PositionPercent : story03PositionPercent;

              const y = Math.round(panelHeight * yPercent);

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
                  fill="${headlinePrimaryColor}"
                >
                  ${escapeXml(story.zh)}
                </text>

                <text
                  x="${Math.round(panelWidth * 0.12)}"
                  y="${y + Math.round(secondaryEnSize * 1.55)}"
                  font-size="${secondaryEnSize}"
                  font-family="Arial, Helvetica, sans-serif"
                  font-weight="500"
                  fill="${headlineSecondaryColor}"
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
                stop-color="rgba(${panelBaseColor},${panelOpacityStart})"
              />
              <stop
                offset="64%"
                stop-color="rgba(${panelBaseColor},${panelOpacityMiddle})"
              />
              <stop
                offset="100%"
                stop-color="rgba(${panelBaseColor},${panelOpacityEnd})"
              />
            </linearGradient>
          </defs>

          <rect
            x="0"
            y="0"
            width="${panelWidth}"
            height="${panelHeight}"
            rx="${panelRadius}"
            ry="${panelRadius}"
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
            fill="${headlinePrimaryColor}"
            letter-spacing="1.8"
          >
            ${escapeXml(sectionLabel)}
          </text>

          ${
            headlineTextEnabled
              ? `
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

          ${
            headlineTextEnabled
              ? `
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
            fill="${headlineSecondaryColor}"
          >
            ${escapeXml(hero.en)}
          </text>
          `
              : ""
          }
          `
              : ''
          }

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
          fill="${footerBackgroundColor}"
        />
        <rect
          width="${width}"
          height="1"
          fill="${footerSeparatorColor}"
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

    const selectedLogoAssetId =
      footerLogoAssetId ?? logoAssetId;

    if (selectedLogoAssetId) {
      const asset = await this.prisma.asset.findUnique({
        where: { id: selectedLogoAssetId },
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

    const safeFooterText =
      footerTextEnabled && footerText
        ? footerText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
        : '';

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

    if (footerTextEnabled) {
      composites.push({
        input: textSvg,
        left: 0,
        top: footerTop,
      });
    }

    let qrSize = 0;

    const selectedQrLink =
      footerQrLink ?? qrLink;

    if (
      footerQrEnabled &&
      footerQrAssetId
    ) {
      const qrAsset = await this.prisma.asset.findUnique({
        where: { id: footerQrAssetId },
        select: { url: true },
      });

      if (qrAsset?.url) {
        try {
          const qrResponse = await fetch(qrAsset.url);

          if (qrResponse.ok) {
            const qrBuffer = Buffer.from(
              await qrResponse.arrayBuffer(),
            );

            qrSize = Math.max(
              24,
              Math.round(width * qrSizePercent),
            );

            const preparedQr = await sharp(qrBuffer)
              .resize({
                width: qrSize,
                height: qrSize,
                fit: 'contain',
              })
              .png()
              .toBuffer();

            composites.push({
              input: preparedQr,
              left:
                width -
                qrSize -
                Math.round(width * qrMarginPercent),
              top:
                footerTop +
                Math.round(
                  (footerHeight - qrSize) / 2,
                ),
            });
          }
        } catch (error) {
          this.logger.warn(
            `Footer QR asset skipped: ${
              error instanceof Error
                ? error.message
                : 'Unknown QR error'
            }`,
          );
        }
      }
    } else if (selectedQrLink) {
      const parsed = new URL(selectedQrLink);

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('QR link must use http:// or https://');
      }

      qrSize = Math.max(24, Math.round(width * qrSizePercent));

      const qr = await QRCode.toBuffer(selectedQrLink, {
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
        left: width - qrSize - Math.round(width * qrMarginPercent),

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
        getMalaysiaDateKey(),
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
