import { Injectable } from '@nestjs/common';
import { OpenAiProvider } from './openai.provider';
import { GoogleAiStudioProvider } from './google-ai-studio.provider';
import type {
  AiProviderOptions,
  AiProviderPrompt,
  AiProviderResult,
} from './ai-provider.types';

@Injectable()
export class AiProviderService {
  constructor(
    private readonly openAiProvider: OpenAiProvider,
    private readonly googleAiStudioProvider: GoogleAiStudioProvider,
  ) {}

  generate(
    prompt: AiProviderPrompt,
    options: AiProviderOptions = {},
  ): Promise<AiProviderResult> {
    if (options.provider === 'google') {
      return this.googleAiStudioProvider.generate(
        prompt,
        options,
      );
    }

    return this.openAiProvider.generate(
      prompt,
      options,
    );
  }
}
