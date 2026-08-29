import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AiRuntimeSettingsService } from '../ai-runtime/ai-runtime-settings.service';
import type {
  AiProvider,
  AiProviderOptions,
  AiProviderPrompt,
  AiProviderResult,
} from './ai-provider.types';

@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;

  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiRuntime: AiRuntimeSettingsService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async generate(
    prompt: AiProviderPrompt,
    options: AiProviderOptions = {},
  ): Promise<AiProviderResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured.',
      );
    }

    const startedAt = Date.now();

    const model =
      options.model?.trim() || (await this.aiRuntime.getTextModel());

    const response = await this.client.responses.create({
      model,
      input: [
        {
          role: 'system',
          content: prompt.system,
        },
        {
          role: 'user',
          content: prompt.user,
        },
      ],
      max_output_tokens: options.maxOutputTokens,
      text:
        options.responseFormat === 'json'
          ? {
              format: {
                type: 'json_schema',
                name: 'marketing_output',
                strict: true,
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'title',
                    'hook',
                    'facebook',
                    'telegram',
                    'instagram',
                    'reels',
                    'imagePrompt',
                    'hashtags',
                  ],
                  properties: {
                    title: {
                      type: 'string',
                    },
                    hook: {
                      type: 'string',
                    },
                    facebook: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['caption', 'discussionQuestion'],
                      properties: {
                        caption: {
                          type: 'string',
                        },
                        discussionQuestion: {
                          type: 'string',
                        },
                      },
                    },
                    telegram: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['message', 'callToAction'],
                      properties: {
                        message: {
                          type: 'string',
                        },
                        callToAction: {
                          type: 'string',
                        },
                      },
                    },
                    instagram: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['caption', 'hashtags'],
                      properties: {
                        caption: {
                          type: 'string',
                        },
                        hashtags: {
                          type: 'array',
                          items: {
                            type: 'string',
                          },
                        },
                      },
                    },
                    reels: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['title', 'caption', 'scenes'],
                      properties: {
                        title: {
                          type: 'string',
                        },
                        caption: {
                          type: 'string',
                        },
                        scenes: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: false,
                            required: [
                              'order',
                              'visual',
                              'onScreenText',
                              'voiceover',
                            ],
                            properties: {
                              order: {
                                type: 'integer',
                              },
                              visual: {
                                type: 'string',
                              },
                              onScreenText: {
                                type: 'string',
                              },
                              voiceover: {
                                type: 'string',
                              },
                            },
                          },
                        },
                      },
                    },
                    imagePrompt: {
                      type: 'string',
                    },
                    hashtags: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            }
          : undefined,
    });

    const inputTokens = response.usage?.input_tokens ?? 0;

    const outputTokens = response.usage?.output_tokens ?? 0;

    return {
      provider: this.name,
      model,
      text: response.output_text ?? '',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: response.usage?.total_tokens ?? inputTokens + outputTokens,
      },
      durationMs: Date.now() - startedAt,
    };
  }
}
