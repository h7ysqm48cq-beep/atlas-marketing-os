import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { LogoLayoutService } from './logo-layout.service';
import { LogoPlacement } from './logo.types';
import { SafeAreaService } from './safe-area.service';

@Injectable()
export class LogoOverlayService {
  constructor(
    private readonly layout: LogoLayoutService,
    private readonly safeArea: SafeAreaService,
  ) {}

  async overlay(options: {
    image: Buffer;
    logo: Buffer;
    width: number;
    height: number;
    platform?: string;
    placement?: LogoPlacement;
    scale?: number;
    opacity?: number;
  }): Promise<Buffer> {
    const scale = this.clamp(options.scale ?? 1, 0.5, 1.5);
    const opacity = this.clamp(options.opacity ?? 1, 0.2, 1);

    const defaultLogoWidth = this.safeArea.getLogoWidth(
      options.width,
      options.platform,
    );
    const targetLogoWidth = Math.max(
      48,
      Math.round(defaultLogoWidth * scale),
    );
    const padding = this.safeArea.getPadding(
      options.width,
      options.platform,
    );
    const bottomMargin = this.safeArea.getBottomMargin(
      options.height,
      options.platform,
    );

    let logoPipeline = sharp(options.logo)
      .resize({
        width: targetLogoWidth,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .ensureAlpha();

    if (opacity < 1) {
      logoPipeline = logoPipeline.linear(
        [1, 1, 1, opacity],
        [0, 0, 0, 0],
      );
    }

    const resizedLogo = await logoPipeline.png().toBuffer();
    const metadata = await sharp(resizedLogo).metadata();
    const logoWidth = metadata.width ?? targetLogoWidth;
    const logoHeight = metadata.height ?? Math.round(targetLogoWidth * 0.4);

    const placement =
      options.placement && options.placement !== LogoPlacement.AUTO
        ? options.placement
        : this.layout.getPlacement({
            width: options.width,
            height: options.height,
            platform: options.platform,
          });

    const coordinates = this.resolveCoordinates({
      placement,
      canvasWidth: options.width,
      canvasHeight: options.height,
      logoWidth,
      logoHeight,
      padding,
      bottomMargin,
    });

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

  private resolveCoordinates(input: {
    placement: LogoPlacement;
    canvasWidth: number;
    canvasHeight: number;
    logoWidth: number;
    logoHeight: number;
    padding: number;
    bottomMargin: number;
  }): { left: number; top: number } {
    const centeredLeft = Math.max(
      0,
      Math.round((input.canvasWidth - input.logoWidth) / 2),
    );
    const centeredTop = Math.max(
      0,
      Math.round((input.canvasHeight - input.logoHeight) / 2),
    );
    const right = Math.max(
      0,
      input.canvasWidth - input.logoWidth - input.padding,
    );
    const bottom = Math.max(
      0,
      input.canvasHeight - input.logoHeight - input.bottomMargin,
    );

    switch (input.placement) {
      case LogoPlacement.TOP_LEFT:
        return { left: input.padding, top: input.padding };
      case LogoPlacement.TOP_CENTER:
        return { left: centeredLeft, top: input.padding };
      case LogoPlacement.TOP_RIGHT:
        return { left: right, top: input.padding };
      case LogoPlacement.CENTER_LEFT:
        return { left: input.padding, top: centeredTop };
      case LogoPlacement.CENTER:
        return { left: centeredLeft, top: centeredTop };
      case LogoPlacement.CENTER_RIGHT:
        return { left: right, top: centeredTop };
      case LogoPlacement.BOTTOM_LEFT:
        return { left: input.padding, top: bottom };
      case LogoPlacement.BOTTOM_RIGHT:
        return { left: right, top: bottom };
      case LogoPlacement.AUTO:
      case LogoPlacement.BOTTOM_CENTER:
      default:
        return { left: centeredLeft, top: bottom };
    }
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }
}
