import { Body, Controller, Delete, Get, Patch, Query } from '@nestjs/common';

import { ImageSettingsService } from './image-settings.service';

@Controller('image-settings')
export class ImageSettingsController {
  constructor(private readonly service: ImageSettingsService) {}

  @Get('scopes')
  listScopes() {
    return this.service.listScopes();
  }

  @Get()
  get(
    @Query('pageId')
    pageId?: string,

    @Query('channelId')
    channelId?: string,
  ) {
    return this.service.get({
      pageId,
      channelId,
    });
  }

  @Patch()
  update(
    @Body()
    body: {
      pageId?: string;
      channelId?: string;

      textOverlayEnabled?: boolean;
      textOverlayText?: string;
      qrEnabled?: boolean;
      qrLinks?: string;
      brandFooterEnabled?: boolean;
      footerText?: string;
      footerPosition?: string;
      footerStyle?: string;
      footerLogoMode?: string;

      cornerLogoEnabled?: boolean;
      cornerLogoPlacement?: string;
      cornerLogoScale?: number;
      cornerLogoOpacity?: number;
    },
  ) {
    const { pageId, channelId, ...settings } = body;

    return this.service.update(settings, {
      pageId,
      channelId,
    });
  }

  @Delete()
  removeOverride(
    @Query('pageId')
    pageId?: string,

    @Query('channelId')
    channelId?: string,
  ) {
    return this.service.removeOverride({
      pageId,
      channelId,
    });
  }
}
