import { Injectable } from '@nestjs/common';
import { ImageInfo, LogoPlacement } from './logo.types';

@Injectable()
export class LogoLayoutService {
  getPlacement(info: ImageInfo): LogoPlacement {
    const platform = this.normalizePlatform(info.platform);
    const orientation = this.getOrientation(info.width, info.height);

    if (platform === 'instagram-story' || platform === 'whatsapp-status') {
      return LogoPlacement.BOTTOM_CENTER;
    }

    if (platform === 'telegram') {
      return orientation === 'landscape'
        ? LogoPlacement.BOTTOM_RIGHT
        : LogoPlacement.BOTTOM_CENTER;
    }

    if (platform === 'facebook') {
      return orientation === 'portrait'
        ? LogoPlacement.BOTTOM_CENTER
        : LogoPlacement.BOTTOM_RIGHT;
    }

    if (orientation === 'square') {
      return LogoPlacement.BOTTOM_CENTER;
    }

    if (orientation === 'portrait') {
      return LogoPlacement.BOTTOM_LEFT;
    }

    return LogoPlacement.BOTTOM_RIGHT;
  }

  private getOrientation(
    width: number,
    height: number,
  ): 'portrait' | 'landscape' | 'square' {
    const ratio = width / height;

    if (ratio > 1.08) {
      return 'landscape';
    }

    if (ratio < 0.92) {
      return 'portrait';
    }

    return 'square';
  }

  private normalizePlatform(platform?: string): string {
    return (platform ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
  }
}
