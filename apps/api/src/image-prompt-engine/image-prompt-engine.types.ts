/** Provider-independent ratio text, validated by the calling boundary. */
export type ImageAspectRatio = string;

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
