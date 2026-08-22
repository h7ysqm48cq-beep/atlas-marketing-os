import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

import { LogoOverlayService, LogoPlacement } from '../image/logo';
import { BrandSettingResolverService } from './resolver/brand-setting-resolver.service';
import { FooterRendererService } from './footer/footer-renderer.service';
import { CollisionGuardService } from './collision/collision-guard.service';
import { BrandBrainRulesService } from './rules/brand-brain-rules.service';



export type BrandRenderOptions = {
  logoEnabled?: boolean;

  logoBuffer?: Buffer;

  primaryLogoAssetId?: string | null;

  footerEnabled?: boolean;

  footerText?: string | null;

  footerPosition?: string | null;

  footerStyle?: string | null;

  placement?: LogoPlacement;

  scale?: number;

  opacity?: number;

  platform?: string;

  normalizedX?: number;

  normalizedY?: number;
};


export type BrandRenderResult = {
  buffer: Buffer;

  appliedFooter: boolean;

  appliedLogo: boolean;

  settingsSource: {
    workspace: boolean;
    page: boolean;
    channel: boolean;
  };
};

export type BrandRenderContext = {
  brandId: string;

  pageId?: string;

  channelId?: string;

  workspaceSetting?: Record<string, any>;

  pageSetting?: Record<string, any> | null;

  channelSetting?: Record<string, any> | null;

  brandBrainRules?: Record<string, any> | null;

  imageWidth: number;

  imageHeight: number;

  buffer: Buffer;
};


@Injectable()
export class BrandRendererService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly logoOverlayService: LogoOverlayService,
    private readonly settingResolver: BrandSettingResolverService,
    private readonly footerRenderer: FooterRendererService,
    private readonly collisionGuard: CollisionGuardService,
    private readonly brandBrainRules: BrandBrainRulesService,
  ) {}


  async render(
    context: BrandRenderContext,
    options?: BrandRenderOptions,
  ): Promise<Buffer> {

    const settings =
      this.settingResolver.resolve(
        context.workspaceSetting ?? {},
        context.pageSetting,
        context.channelSetting,
      );


    const rules =
      this.brandBrainRules.resolve(
        context.brandBrainRules,
      );


    let output = context.buffer;

    output =
      await this.footerRenderer.render({
        image: output,
        enabled:
          rules.imagePolicy?.footerEnabled &&
          settings.brandFooterEnabled,
        text:
          settings.footerText,
      });


    if (
      rules.imagePolicy?.logoEnabled &&
      options?.logoEnabled !== false
    ) {
      const logoBuffer =
        options?.logoBuffer ??
        await this.loadPrimaryLogoBuffer({
          brandId: context.brandId,
          primaryLogoAssetId:
            options?.primaryLogoAssetId ??
            settings.primaryLogoAssetId,
        });

      if (logoBuffer) {
        output =
          await this.logoOverlayService.overlay({
            image: output,
            logo: logoBuffer,
            width: context.imageWidth,
            height: context.imageHeight,
            platform: options?.platform,
            placement: options?.placement,
            scale: options?.scale ?? 1,
            opacity: options?.opacity ?? 1,
            normalizedX: options?.normalizedX,
            normalizedY: options?.normalizedY,
          });
      }
    }


    return output;
  }


  async loadPrimaryLogoBuffer(input: {
    brandId: string;
    primaryLogoAssetId?: string | null;
  }): Promise<Buffer | null> {

    const logoAssetId =
      input.primaryLogoAssetId?.trim();

    if (!logoAssetId) {
      return null;
    }

    const logoAsset =
      await this.prisma.asset.findFirst({
        where: {
          id: logoAssetId,
          brandId: input.brandId,
          type: 'IMAGE',
        },
        select: {
          url: true,
        },
      });

    if (
      !logoAsset?.url ||
      !logoAsset.url.startsWith('https://')
    ) {
      return null;
    }

    try {
      const response = await fetch(logoAsset.url);

      if (!response.ok) {
        throw new Error(
          `Logo download returned HTTP ${response.status}.`,
        );
      }

      return Buffer.from(
        await response.arrayBuffer(),
      );
    } catch (error) {
      console.warn(
        [
          '[BrandRendererService]',
          'Primary logo load skipped.',
          error instanceof Error
            ? error.message
            : 'Unknown logo loading error.',
        ].join(' '),
      );

      return null;
    }
  }

  async applyPrimaryLogo(input: {
    brandId: string;
    primaryLogoAssetId?: string | null;
    imageBuffer: Buffer;
    width: number;
    height: number;
    platform?: string;
    placement: LogoPlacement;
    scale: number;
    opacity: number;
    normalizedX?: number;
    normalizedY?: number;
  }): Promise<Buffer> {
    const logoBuffer =
      await this.loadPrimaryLogoBuffer({
        brandId: input.brandId,
        primaryLogoAssetId:
          input.primaryLogoAssetId,
      });

    if (!logoBuffer) return input.imageBuffer;

    return this.logoOverlayService.overlay({
      image: input.imageBuffer,
      logo: logoBuffer,
      width: input.width,
      height: input.height,
      platform: input.platform,
      placement: input.placement,
      scale: input.scale,
      opacity: input.opacity,
      normalizedX: input.normalizedX,
      normalizedY: input.normalizedY,
    });
  }
}
