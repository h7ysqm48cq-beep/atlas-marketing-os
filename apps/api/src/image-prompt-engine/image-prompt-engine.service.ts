import { Injectable } from '@nestjs/common';
import type {
  BuildImagePromptInput,
  ImageAspectRatio,
  ImagePromptResult,
} from './image-prompt-engine.types';

@Injectable()
export class ImagePromptEngineService {
  status() {
    return {
      engine: 'image-prompt',
      status: 'ready',
    };
  }

  build(
    input: BuildImagePromptInput,
  ): ImagePromptResult {
    const aspectRatio =
      input.aspectRatio ??
      this.resolveAspectRatio(
        input.platform,
        input.purpose,
      );

    const onImageText =
      input.onImageText?.length
        ? [
            'Include the following exact on-image text:',
            ...input.onImageText.map(
              (line) => `- ${line}`,
            ),
          ].join('\n')
        : 'Do not include additional text unless required.';

    const brandPlacement =
      input.brandPlacement ??
      'Place the brand subtly at the bottom center, small but readable.';

    const extraInstructions =
      input.additionalInstructions?.length
        ? input.additionalInstructions
            .map(
              (instruction) =>
                `- ${instruction}`,
            )
            .join('\n')
        : '- Keep the composition clean and focused.';

    const prompt = [
      `Create a premium marketing visual for: ${input.subject}.`,
      '',
      `Purpose: ${input.purpose ?? 'social media content'}`,
      `Platform: ${input.platform ?? 'general social media'}`,
      `Aspect ratio: ${aspectRatio}`,
      `Language: ${input.language ?? 'Simplified Chinese'}`,
      '',
      'VISUAL DIRECTION',
      '- Cinematic, premium and emotionally engaging.',
      '- Clean composition with one clear focal point.',
      '- Malaysian cultural context when relevant.',
      '- Natural lighting and realistic details.',
      '- Avoid an overly promotional appearance.',
      '',
      'TEXT',
      onImageText,
      '',
      'BRAND PLACEMENT',
      brandPlacement,
      '',
      'ADDITIONAL INSTRUCTIONS',
      extraInstructions,
    ].join('\n');

    const negativePrompt = [
      'low resolution',
      'blurry image',
      'distorted anatomy',
      'extra fingers',
      'duplicate subjects',
      'cluttered composition',
      'oversized logo',
      'hard-selling advertisement',
      'casino chips',
      'coins',
      'jackpot symbols',
      'guaranteed-win claims',
      'watermark',
      'random text',
      'misspelled text',
    ].join(', ');

    return {
      prompt,
      negativePrompt,
      aspectRatio,
      metadata: {
        version: '1.0',
        createdAt: new Date(),
      },
    };
  }

  private resolveAspectRatio(
    platform?: string,
    purpose?: string,
  ): ImageAspectRatio {
    const value = [
      platform,
      purpose,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (
      value.includes('reels') ||
      value.includes('story') ||
      value.includes('tiktok')
    ) {
      return '9:16';
    }

    if (
      value.includes('banner') ||
      value.includes('website hero')
    ) {
      return '1920:500';
    }

    if (
      value.includes('youtube') ||
      value.includes('landscape')
    ) {
      return '16:9';
    }

    if (
      value.includes('instagram post') ||
      value.includes('facebook post')
    ) {
      return '4:5';
    }

    return '1:1';
  }
}
