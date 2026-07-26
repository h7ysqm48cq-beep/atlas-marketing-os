import { Injectable } from '@nestjs/common';
import { IntentType } from '../types/intent';

@Injectable()
export class AudienceEngine {
  resolve(prompt: string, intent: IntentType): string[] {
    const text = prompt.toLowerCase();

    const audience = new Set<string>([
      'Malaysia Chinese',
      'Age 25-40',
      'Digital entertainment audience',
    ]);

    if (
      text.includes('足球') ||
      text.includes('world cup') ||
      text.includes('世界杯') ||
      text.includes('sports')
    ) {
      audience.add('Football and sports fans');
    }

    if (
      text.includes('港剧') ||
      text.includes('香港电影') ||
      text.includes('怀旧') ||
      text.includes('nostalgia')
    ) {
      audience.add('Hong Kong entertainment and nostalgia fans');
    }

    if (
      text.includes('年轻') ||
      text.includes('gen z') ||
      text.includes('tiktok') ||
      text.includes('reels')
    ) {
      audience.add('Young mobile-first adults');
    }

    if (intent === IntentType.SEO) {
      audience.add('High-intent search users');
    }

    if (intent === IntentType.ANALYTICS) {
      audience.add('Existing followers and campaign audiences');
    }

    return [...audience];
  }
}
