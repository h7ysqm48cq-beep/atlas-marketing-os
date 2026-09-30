import { Injectable } from '@nestjs/common';

@Injectable()
export class SafeAreaService {
  getPadding(width: number, platform?: string): number {
    const normalized = this.normalizePlatform(platform);
    const ratio =
      normalized === 'instagram-story' || normalized === 'whatsapp-status'
        ? 0.055
        : normalized === 'telegram'
          ? 0.028
          : 0.035;

    return Math.max(24, Math.round(width * ratio));
  }

  getLogoWidth(width: number, platform?: string): number {
    const normalized = this.normalizePlatform(platform);
    const ratio =
      normalized === 'instagram-story' || normalized === 'whatsapp-status'
        ? 0.075
        : normalized === 'telegram'
          ? 0.08
          : normalized === 'facebook'
            ? 0.085
            : 0.08;

    return Math.max(64, Math.min(150, Math.round(width * ratio)));
  }

  getBottomMargin(height: number, platform?: string): number {
    const normalized = this.normalizePlatform(platform);
    const ratio =
      normalized === 'instagram-story' || normalized === 'whatsapp-status'
        ? 0.075
        : normalized === 'telegram'
          ? 0.03
          : 0.035;

    return Math.max(24, Math.round(height * ratio));
  }

  private normalizePlatform(platform?: string): string {
    return (platform ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
  }
}
