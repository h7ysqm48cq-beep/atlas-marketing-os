import { Injectable } from '@nestjs/common';
import { OpenAiProvider } from './openai.provider';
import type {
  AiProviderOptions,
  AiProviderPrompt,
  AiProviderResult,
} from './ai-provider.types';

@Injectable()
export class AiProviderService {
  constructor(
    private readonly openAiProvider: OpenAiProvider,
  ) {}

  generate(
    prompt: AiProviderPrompt,
    options?: AiProviderOptions,
  ): Promise<AiProviderResult> {
    return this.openAiProvider.generate(
      prompt,
      options,
    );
  }
}
