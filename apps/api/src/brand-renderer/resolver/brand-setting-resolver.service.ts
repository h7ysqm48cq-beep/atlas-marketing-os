import { Injectable } from '@nestjs/common';

type SettingSource = {
  brandFooterEnabled?: boolean | null;

  footerText?: string | null;

  footerLogoMode?: string | null;

  footerPosition?: string | null;

  footerStyle?: string | null;

  logoEnabled?: boolean | null;

  primaryLogoAssetId?: string | null;
};


@Injectable()
export class BrandSettingResolverService {

  resolve(
    workspace: SettingSource,
    page?: SettingSource | null,
    channel?: SettingSource | null,
  ) {

    return {

      brandFooterEnabled:
        channel?.brandFooterEnabled ??
        page?.brandFooterEnabled ??
        workspace.brandFooterEnabled ??
        false,


      footerText:
        channel?.footerText ??
        page?.footerText ??
        workspace.footerText ??
        null,


      footerPosition:
        channel?.footerPosition ??
        page?.footerPosition ??
        workspace.footerPosition ??
        'BOTTOM',


      footerStyle:
        channel?.footerStyle ??
        page?.footerStyle ??
        workspace.footerStyle ??
        'DEFAULT',


      footerLogoMode:
        channel?.footerLogoMode ??
        page?.footerLogoMode ??
        workspace.footerLogoMode ??
        'auto',


      logoEnabled:
        channel?.logoEnabled ??
        page?.logoEnabled ??
        workspace.logoEnabled ??
        false,


      primaryLogoAssetId:
        channel?.primaryLogoAssetId ??
        page?.primaryLogoAssetId ??
        workspace.primaryLogoAssetId ??
        null,

    };

  }

}
