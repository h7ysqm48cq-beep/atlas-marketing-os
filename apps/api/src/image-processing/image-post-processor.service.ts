import { Injectable } from '@nestjs/common';
import sharp, { OverlayOptions } from 'sharp';
import QRCode from 'qrcode';

type FooterPosition = 'bottom-left' | 'bottom-center' | 'bottom-right';

type FooterStyle = 'minimal' | 'premium' | 'watermark';

@Injectable()
export class ImagePostProcessorService {
  async process(
    buffer: Buffer,
    settings: {
      textOverlayEnabled?: boolean;
      qrEnabled?: boolean;
      qrLinks?: string;

      brandFooterEnabled?: boolean;
      footerText?: string;
      footerPosition?: string;
      footerStyle?: string;

      brandLogo?: Buffer;
      logoEnabled?: boolean;
      logoScale?: number;
      logoOpacity?: number;
    },
    text?: string,
  ): Promise<Buffer> {
    const metadata = await sharp(buffer).metadata();

    const width = metadata.width ?? 1024;

    const height = metadata.height ?? 1536;

    const composites: OverlayOptions[] = [];

    // ---------------------------------------------------
    // Main generated text overlay
    // ---------------------------------------------------

    if (settings.textOverlayEnabled && text?.trim()) {
      composites.push({
        input: Buffer.from(this.createTextOverlaySvg(width, height, text)),
        top: 0,
        left: 0,
      });
    }

    // ---------------------------------------------------
    // Unified Brand Signature
    //
    // [Official Logo] 满贯门 mgmbetmyr.com
    // ---------------------------------------------------

    const footerText = settings.footerText?.trim() ?? '';
    const footerLogo = settings.logoEnabled ? settings.brandLogo : undefined;

    if (settings.brandFooterEnabled && (footerText || footerLogo)) {
      const signature = await this.createBrandSignature(
        width,
        height,
        footerText,
        this.normalizePosition(settings.footerPosition),
        this.normalizeStyle(settings.footerStyle),
        footerLogo,
        settings.logoScale ?? 1,
        settings.logoOpacity ?? 1,
      );

      composites.push({
        input: signature,
        top: 0,
        left: 0,
      });
    }

    const qrLinks = this.parseQrLinks(settings.qrLinks);
    if (settings.qrEnabled && qrLinks.length) {
      const footerBandHeight = Math.max(70, Math.round(height * 0.072));
      const qrGap = Math.max(6, Math.round(width * 0.01));
      const rightMargin = Math.max(16, Math.round(width * 0.03));
      const configuredSize = Math.round(width * 0.075);
      const availableWidth = Math.round(width * 0.34);
      const qrSize = Math.max(
        24,
        Math.min(
          configuredSize,
          Math.round(footerBandHeight * 0.78),
          Math.floor(
            (availableWidth - qrGap * (qrLinks.length - 1)) / qrLinks.length,
          ),
        ),
      );
      const top =
        height -
        footerBandHeight +
        Math.max(0, Math.round((footerBandHeight - qrSize) / 2));

      for (const [index, link] of qrLinks.entries()) {
        const qr = await QRCode.toBuffer(link, {
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
          left:
            width -
            rightMargin -
            (qrLinks.length - index) * qrSize -
            (qrLinks.length - index - 1) * qrGap,
          top,
        });
      }
    }

    if (!composites.length) {
      return sharp(buffer).png().toBuffer();
    }

    return sharp(buffer).composite(composites).png().toBuffer();
  }

  private parseQrLinks(value?: string) {
    return Array.from(
      new Set(
        (value ?? '')
          .split(/\r?\n/)
          .map((link) => link.trim())
          .filter((link) => {
            try {
              const parsed = new URL(link);
              return (
                parsed.protocol === 'http:' || parsed.protocol === 'https:'
              );
            } catch {
              return false;
            }
          }),
      ),
    ).slice(0, 3);
  }

  // =====================================================
  // UNIFIED BRAND SIGNATURE
  // =====================================================

  private async createBrandSignature(
    width: number,
    height: number,
    text: string,
    position: FooterPosition,
    style: FooterStyle,
    logo?: Buffer,
    logoScale = 1,
    logoOpacity = 1,
  ): Promise<Buffer> {
    const fontSize = Math.max(18, Math.round(width * 0.026));

    const margin = Math.max(24, Math.round(width * 0.035));

    const footerHeight = Math.max(70, Math.round(height * 0.072));

    const gap = Math.max(10, Math.round(width * 0.012));

    const signatureCenterY = height - Math.round(footerHeight / 2);

    let logoBuffer: Buffer | undefined;

    let logoWidth = 0;
    let logoHeight = 0;

    // ---------------------------------------------------
    // Official uploaded brand logo
    // ---------------------------------------------------

    if (logo) {
      const targetLogoWidth = Math.max(
        42,
        Math.round(width * 0.065 * this.clamp(logoScale, 0.5, 1.5)),
      );

      const opacity =
        style === 'watermark'
          ? this.clamp(logoOpacity * 0.55, 0.1, 1)
          : this.clamp(logoOpacity, 0.2, 1);

      let pipeline = sharp(logo)
        .resize({
          width: targetLogoWidth,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .ensureAlpha();

      if (opacity < 1) {
        pipeline = pipeline.linear([1, 1, 1, opacity], [0, 0, 0, 0]);
      }

      logoBuffer = await pipeline.png().toBuffer();

      const logoMetadata = await sharp(logoBuffer).metadata();

      logoWidth = logoMetadata.width ?? targetLogoWidth;

      logoHeight = logoMetadata.height ?? Math.round(targetLogoWidth * 0.45);
    }

    // ---------------------------------------------------
    // Estimate text width for unified group positioning
    // ---------------------------------------------------

    const normalizedText = text.trim().slice(0, 100);

    const estimatedTextWidth = normalizedText
      ? Math.min(
          Math.round(width * 0.72),
          Math.max(
            fontSize * 4,
            Math.round(normalizedText.length * fontSize * 0.58),
          ),
        )
      : 0;

    const totalWidth = logoBuffer
      ? logoWidth + (normalizedText ? gap : 0) + estimatedTextWidth
      : estimatedTextWidth;

    let groupLeft = Math.round((width - totalWidth) / 2);

    if (position === 'bottom-left') {
      groupLeft = margin;
    }

    if (position === 'bottom-right') {
      groupLeft = Math.max(margin, width - margin - totalWidth);
    }

    const textX =
      groupLeft + (logoBuffer ? logoWidth + (normalizedText ? gap : 0) : 0);

    const textY = signatureCenterY + Math.round(fontSize * 0.34);

    const opacity = style === 'watermark' ? '0.55' : '0.94';

    const safeText = this.escapeXml(normalizedText);

    const background =
      style === 'premium'
        ? `
          <rect
            x="0"
            y="${height - footerHeight}"
            width="${width}"
            height="${footerHeight}"
            fill="rgba(0,0,0,0.58)"
          />
        `
        : '';

    const signatureSvg = Buffer.from(`
        <svg
          width="${width}"
          height="${height}"
          xmlns="http://www.w3.org/2000/svg"
        >
          ${background}

          <text
            x="${textX}"
            y="${textY}"
            text-anchor="start"
            font-size="${fontSize}"
            font-weight="600"
            fill="#ffffff"
            opacity="${opacity}"
            font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif"
            stroke="rgba(0,0,0,0.35)"
            stroke-width="1"
            paint-order="stroke"
          >
            ${safeText}
          </text>
        </svg>
      `);

    const signatureLayers: OverlayOptions[] = [
      {
        input: signatureSvg,
        top: 0,
        left: 0,
      },
    ];

    if (logoBuffer) {
      signatureLayers.push({
        input: logoBuffer,
        left: Math.max(0, Math.round(groupLeft)),
        top: Math.max(0, Math.round(signatureCenterY - logoHeight / 2)),
      });
    }

    // One transparent canvas =
    // one Brand Signature component.
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: {
          r: 0,
          g: 0,
          b: 0,
          alpha: 0,
        },
      },
    })
      .composite(signatureLayers)
      .png()
      .toBuffer();
  }

  private normalizePosition(value?: string): FooterPosition {
    if (value === 'bottom-left') {
      return value;
    }

    if (value === 'bottom-right') {
      return value;
    }

    return 'bottom-center';
  }

  private normalizeStyle(value?: string): FooterStyle {
    if (value === 'premium') {
      return value;
    }

    if (value === 'watermark') {
      return value;
    }

    return 'minimal';
  }

  private createTextOverlaySvg(width: number, height: number, text: string) {
    const fontSize = Math.max(28, Math.round(width * 0.05));

    const safeText = this.escapeXml(text.trim().slice(0, 70));

    const y = Math.round(height * 0.095);

    return `
      <svg
        width="${width}"
        height="${height}"
        xmlns="http://www.w3.org/2000/svg"
      >
        <text
          x="${width / 2}"
          y="${y}"
          text-anchor="middle"
          font-size="${fontSize}"
          font-weight="700"
          fill="#ffffff"
          font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif"
          stroke="rgba(0,0,0,0.55)"
          stroke-width="2"
          paint-order="stroke"
        >
          ${safeText}
        </text>
      </svg>
    `;
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
  }
}
