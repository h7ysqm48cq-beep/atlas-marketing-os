export type ImageAspectRatio =
  | '1:1'
  | '4:5'
  | '9:16'
  | '16:9'
  | '1920:500';

export interface BuildImagePromptInput {
  subject: string;
  purpose?: string;
  platform?: string;
  aspectRatio?: ImageAspectRatio;
  language?: string;
  onImageText?: string[];
  brandPlacement?: string;
  additionalInstructions?: string[];
}

export interface ImagePromptResult {
  prompt: string;
  negativePrompt: string;
  aspectRatio: ImageAspectRatio;
  metadata: {
    version: string;
    createdAt: Date;
  };
}
