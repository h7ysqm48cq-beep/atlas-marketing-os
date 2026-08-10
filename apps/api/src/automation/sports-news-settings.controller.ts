import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { SportsNewsImageService } from '../news/sports-news-image.service';
import { SportsNewsRunHistoryService } from '../news/sports-news-run-history.service';
import { SportsNewsRunnerService } from './sports-news-runner.service';
import { SportsNewsSettingsService } from './sports-news-settings.service';
import type { UpdateSportsNewsSettingsInput } from './sports-news-settings.service';

@Controller('sports-news')
export class SportsNewsSettingsController {
  constructor(
    private readonly settings: SportsNewsSettingsService,
    private readonly runner: SportsNewsRunnerService,
    private readonly runHistory: SportsNewsRunHistoryService,
    private readonly imageGenerator: SportsNewsImageService,
  ) {}
  @Get('settings') getSettings() {
    return this.settings.get();
  }
  @Patch('settings') updateSettings(
    @Body() body: UpdateSportsNewsSettingsInput,
  ) {
    return this.settings.update(body);
  }
  @Get('channels') channels() {
    return this.settings.channels();
  }
  @Get('runs') runs(@Query('limit') limit?: string) {
    const parsed = Number(limit ?? 10);
    return this.runHistory.recent(Number.isFinite(parsed) ? parsed : 10);
  }
  @Post('image/preview')
  async previewImage(
    @Body()
    body: {
      kind?: 'morning' | 'evening';
      content?: string;
    },
  ) {
    const settings = await this.settings.get();

    const kind = body.kind === 'evening' ? 'evening' : 'morning';

    const content =
      body.content?.trim() ||
      [
        'M-Sports / 满贯门体育新闻',
        '',
        'Sports News Watermark Preview',
        '',
        'This is a visual preview only.',
        'Do not treat this preview as live sports news.',
      ].join('\n');

    const image = await this.imageGenerator.generate(kind, content, {
      imageEnabled: true,
      imagePrompt: settings.imagePrompt,
      morningImagePrompt: settings.morningImagePrompt,
      eveningImagePrompt: settings.eveningImagePrompt,
      imageAspectRatio: settings.imageAspectRatio,
      imageTextMode: settings.imageTextMode,
      imageVisualStyle: settings.imageVisualStyle,
      logoEnabled: settings.logoEnabled,
      logoAssetId: settings.logoAssetId,
      logoPosition: settings.logoPosition,
      logoSize: settings.logoSize,
      logoOpacity: settings.logoOpacity,
      logoMargin: settings.logoMargin,
      brandFooterEnabled: settings.brandFooterEnabled,
      brandFooterText: settings.brandFooterText,

      footerLogoEnabled: settings.footerLogoEnabled,
      footerLogoAssetId: settings.footerLogoAssetId,

      footerQrEnabled: settings.footerQrEnabled,
      footerQrAssetId: settings.footerQrAssetId,
      footerQrLink: settings.footerQrLink,

      footerPlacement: settings.footerPlacement,
    });

    if (!image) {
      return {
        imageGenerated: false,
        watermarkApplied: false,
        footerApplied: false,
      };
    }

    return {
      imageGenerated: true,
      watermarkApplied: image.watermarkApplied ?? false,
      watermarkError: 'watermarkError' in image ? image.watermarkError : null,
      footerApplied: image.footerApplied ?? false,
      footerEnabled: settings.brandFooterEnabled,
      footerText: settings.brandFooterText,
      footerLogoEnabled: settings.footerLogoEnabled,
      footerLogoAssetId:
        settings.footerLogoAssetId || settings.logoAssetId || null,
      footerQrEnabled: settings.footerQrEnabled,
      footerQrAssetId: settings.footerQrAssetId,
      footerQrLink: settings.footerQrLink,
      footerPlacement: settings.footerPlacement,
      logoAssetId: settings.logoAssetId,
      logoPosition: settings.logoPosition,
      logoSize: settings.logoSize,
      logoOpacity: settings.logoOpacity,
      logoMargin: settings.logoMargin,
      imageDataUrl: image.imageDataUrl,
      mimeType: image.mimeType,
      size: image.size,
      model: image.model,
    };
  }

  @Post('run/morning') runMorning() {
    return this.runner.run('morning', 'manual');
  }
  @Post('run/evening') runEvening() {
    return this.runner.run('evening', 'manual');
  }
}
