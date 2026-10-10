import type { AIContext } from '../context/context.types';

export interface PlatformImagePrompt {
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
}

export interface StructuredMarketingOutput {
  title: string;
  hook: string;

  facebook: {
    caption: string;
    discussionQuestion: string;
  };

  telegram: {
    message: string;
    callToAction: string;
  };

  instagram?: {
    caption: string;
    hashtags: string[];
  };

  reels: {
    title: string;
    caption: string;
    scenes: Array<{
      order: number;
      visual: string;
      onScreenText: string;
      voiceover: string;
    }>;
  };

  imagePrompt: string;
  imagePrompts?: Record<
    string,
    PlatformImagePrompt
  >;
  hashtags: string[];
}

export interface BuiltPrompt {
  system: string;
  user: string;
  context?: AIContext;
  outputFormat: 'text' | 'json';
  metadata: {
    version: string;
    createdAt: Date;
  };
}
