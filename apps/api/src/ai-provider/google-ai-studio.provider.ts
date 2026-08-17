import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  AiProvider,
  AiProviderOptions,
  AiProviderPrompt,
  AiProviderResult,
} from './ai-provider.types';

@Injectable()
export class GoogleAiStudioProvider
  implements AiProvider
{
  readonly name = 'google' as const;

  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
  ) {
    const apiKey =
      this.configService.get<string>(
        'GEMINI_API_KEY',
      );

    this.client = apiKey
      ? new OpenAI({
          apiKey,
          baseURL:
            'https://generativelanguage.googleapis.com/v1beta/openai/',
        })
      : null;
  }

  async generate(
    prompt: AiProviderPrompt,
    options: AiProviderOptions = {},
  ): Promise<AiProviderResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'GEMINI_API_KEY is not configured.',
      );
    }

    const startedAt = Date.now();

    const model =
      options.model ??
      this.configService.get<string>(
        'GEMINI_MODEL',
      ) ??
      'gemini-3.6-flash';

    const response =
      await this.client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: prompt.system,
          },
          {
            role: 'user',
            content: prompt.user,
          },
        ],
        temperature: options.temperature,
        max_tokens: options.maxOutputTokens,
        response_format:
          options.responseFormat === 'json'
            ? {
                type: 'json_schema',
                json_schema: {
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
                        required: [
                          'caption',
                          'discussionQuestion',
                        ],
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
                        required: [
                          'message',
                          'callToAction',
                        ],
                        properties: {
                          message: {
                            type: 'string',
                          },
                          callToAction: {
                            type: 'string',
                          },
                        },
                      },
                      reels: {
                        type: 'object',
                        additionalProperties: false,
                        required: [
                          'title',
                          'caption',
                          'scenes',
                        ],
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

    const inputTokens =
      response.usage?.prompt_tokens ?? 0;

    const outputTokens =
      response.usage?.completion_tokens ?? 0;

    return {
      provider: this.name,
      model,
      text:
        response.choices[0]?.message
          .content ?? '',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          response.usage?.total_tokens ??
          inputTokens + outputTokens,
      },
      durationMs:
        Date.now() - startedAt,
    };
  }
}
