import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AiProvider,
  AiProviderOptions,
  AiProviderPrompt,
  AiProviderResult,
} from './ai-provider.types';

type MiniMaxChatResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
};

export class MiniMaxHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MiniMaxHttpError';
  }
}

@Injectable()
export class MiniMaxProvider implements AiProvider {
  readonly name = 'minimax' as const;

  constructor(
    private readonly configService: ConfigService,
  ) {}

  async generate(
    prompt: AiProviderPrompt,
    options: AiProviderOptions = {},
  ): Promise<AiProviderResult> {
    const apiKey = this.configService.get<string>('MINIMAX_API_KEY');

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'MINIMAX_API_KEY is not configured.',
      );
    }

    const baseUrl = (
      this.configService.get<string>('MINIMAX_BASE_URL') ??
      'https://api.minimax.io/v1'
    ).replace(/\/$/, '');
    const model =
      options.model?.trim() ||
      this.configService.get<string>('MINIMAX_MODEL')?.trim() ||
      'MiniMax-M3';
    const startedAt = Date.now();

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        ...(options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
        ...(options.maxOutputTokens !== undefined
          ? { max_completion_tokens: options.maxOutputTokens }
          : {}),
      }),
    });

    if (!response.ok) {
      throw new MiniMaxHttpError(
        `MiniMax request failed with HTTP ${response.status}.`,
        response.status,
      );
    }

    const data = (await response.json()) as MiniMaxChatResponse;

    if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
      throw new MiniMaxHttpError(
        `MiniMax request failed with provider status ${data.base_resp.status_code}.`,
        503,
      );
    }

    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;

    return {
      provider: this.name,
      model: data.model?.trim() || model,
      text: data.choices?.[0]?.message?.content ?? '',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          data.usage?.total_tokens ?? inputTokens + outputTokens,
      },
      durationMs: Date.now() - startedAt,
    };
  }
}
