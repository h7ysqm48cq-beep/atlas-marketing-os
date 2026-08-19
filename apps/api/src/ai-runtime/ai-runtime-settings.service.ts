import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type AiRuntimeSettings = {
  textModel: string;
  imageModel: string;
  imageGenerationInstructions: string;
  imageNegativeInstructions: string;
  imageModelLogoEnabled: boolean;
  imageAtlasLogoOverlayEnabled: boolean;
  embeddingModel: string;
  sportsNewsModel: string;
  aiStudioModel: string;
  aiStudioInstructions: string;
  aiStudioTimeoutMs: number;
  aiStudioRetryLimit: number;
  copilotModel: string;
  copilotInstructions: string;
  copilotKnowledgeLimit: number;
  copilotConversationRecallLimit: number;
  copilotStudioHistoryLimit: number;
  copilotContextMaxChars: number;
};

const DEFAULT_SETTINGS: AiRuntimeSettings = {
  textModel: 'gpt-5.6-luna',
  imageModel: 'gpt-image-2',
  imageGenerationInstructions: '',
  imageNegativeInstructions: '',
  imageModelLogoEnabled: false,
  imageAtlasLogoOverlayEnabled: true,
  embeddingModel: 'text-embedding-3-large',
  sportsNewsModel: 'gpt-5.6-luna',
  aiStudioModel: 'gpt-5.6-luna',
  aiStudioInstructions: '',
  aiStudioTimeoutMs: 30000,
  aiStudioRetryLimit: 1,
  copilotModel: 'gpt-5.6-luna',
  copilotInstructions: '',
  copilotKnowledgeLimit: 4,
  copilotConversationRecallLimit: 7,
  copilotStudioHistoryLimit: 5,
  copilotContextMaxChars: 7500,
};

@Injectable()
export class AiRuntimeSettingsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async get(): Promise<AiRuntimeSettings> {
    const existing =
      await this.prisma.aiRuntimeSetting.findFirst({
        orderBy: {
          createdAt: 'asc',
        },
      });

    if (existing) {
      return {
        textModel: existing.textModel,
        imageModel: existing.imageModel,
        imageGenerationInstructions: existing.imageGenerationInstructions,
        imageNegativeInstructions: existing.imageNegativeInstructions,
        imageModelLogoEnabled: existing.imageModelLogoEnabled,
        imageAtlasLogoOverlayEnabled: existing.imageAtlasLogoOverlayEnabled,
        embeddingModel: existing.embeddingModel,
        sportsNewsModel:
          existing.sportsNewsModel,
        aiStudioModel: existing.aiStudioModel,
        aiStudioInstructions: existing.aiStudioInstructions,
        aiStudioTimeoutMs: existing.aiStudioTimeoutMs,
        aiStudioRetryLimit: existing.aiStudioRetryLimit,
        copilotModel: existing.copilotModel,
        copilotInstructions: existing.copilotInstructions,
        copilotKnowledgeLimit: existing.copilotKnowledgeLimit,
        copilotConversationRecallLimit: existing.copilotConversationRecallLimit,
        copilotStudioHistoryLimit: existing.copilotStudioHistoryLimit,
        copilotContextMaxChars: existing.copilotContextMaxChars,
      };
    }

    const created =
      await this.prisma.aiRuntimeSetting.create({
        data: DEFAULT_SETTINGS,
      });

    return this.toSettings(created);
  }

  async update(
    input: Partial<AiRuntimeSettings>,
  ): Promise<AiRuntimeSettings> {
    const current =
      await this.prisma.aiRuntimeSetting.findFirst({
        orderBy: {
          createdAt: 'asc',
        },
      });

    const data = {
      ...(input.textModel !== undefined
        ? {
            textModel:
              input.textModel.trim(),
          }
        : {}),
      ...(input.imageModel !== undefined
        ? {
            imageModel:
              input.imageModel.trim(),
          }
        : {}),
      ...(input.imageGenerationInstructions !== undefined
        ? { imageGenerationInstructions: input.imageGenerationInstructions.trim() }
        : {}),
      ...(input.imageNegativeInstructions !== undefined
        ? { imageNegativeInstructions: input.imageNegativeInstructions.trim() }
        : {}),
      ...(input.imageModelLogoEnabled !== undefined
        ? { imageModelLogoEnabled: Boolean(input.imageModelLogoEnabled) }
        : {}),
      ...(input.imageAtlasLogoOverlayEnabled !== undefined
        ? {
            imageAtlasLogoOverlayEnabled: Boolean(
              input.imageAtlasLogoOverlayEnabled,
            ),
          }
        : {}),
      ...(input.embeddingModel !== undefined
        ? {
            embeddingModel:
              input.embeddingModel.trim(),
          }
        : {}),
      ...(input.sportsNewsModel !==
      undefined
        ? {
            sportsNewsModel:
              input.sportsNewsModel.trim(),
          }
        : {}),
      ...(input.aiStudioModel !== undefined
        ? { aiStudioModel: input.aiStudioModel.trim() }
        : {}),
      ...(input.aiStudioInstructions !== undefined
        ? { aiStudioInstructions: input.aiStudioInstructions.trim() }
        : {}),
      ...(input.aiStudioTimeoutMs !== undefined
        ? { aiStudioTimeoutMs: Math.min(Math.max(input.aiStudioTimeoutMs, 5000), 180000) }
        : {}),
      ...(input.aiStudioRetryLimit !== undefined
        ? { aiStudioRetryLimit: Math.min(Math.max(input.aiStudioRetryLimit, 0), 5) }
        : {}),
      ...(input.copilotModel !== undefined
        ? { copilotModel: input.copilotModel.trim() }
        : {}),
      ...(input.copilotInstructions !== undefined
        ? { copilotInstructions: input.copilotInstructions.trim() }
        : {}),
      ...(input.copilotKnowledgeLimit !== undefined
        ? { copilotKnowledgeLimit: Math.min(Math.max(input.copilotKnowledgeLimit, 1), 20) }
        : {}),
      ...(input.copilotConversationRecallLimit !== undefined
        ? { copilotConversationRecallLimit: Math.min(Math.max(input.copilotConversationRecallLimit, 1), 20) }
        : {}),
      ...(input.copilotStudioHistoryLimit !== undefined
        ? { copilotStudioHistoryLimit: Math.min(Math.max(input.copilotStudioHistoryLimit, 1), 20) }
        : {}),
      ...(input.copilotContextMaxChars !== undefined
        ? { copilotContextMaxChars: Math.min(Math.max(input.copilotContextMaxChars, 1000), 30000) }
        : {}),
    };

    if (!current) {
      const created =
        await this.prisma.aiRuntimeSetting.create({
          data: {
            ...DEFAULT_SETTINGS,
            ...data,
          },
        });

      return {
        ...this.toSettings(created),
      };
    }

    const updated =
      await this.prisma.aiRuntimeSetting.update({
        where: {
          id: current.id,
        },
        data,
      });

    return this.toSettings(updated);
  }

  async getTextModel() {
    return (await this.get()).textModel;
  }

  async getImageModel() {
    return (await this.get()).imageModel;
  }

  async applyImageGenerationPolicy(prompt: string) {
    const settings = await this.get();
    const rules = [
      prompt.trim(),
      settings.imageGenerationInstructions.trim(),
      settings.imageNegativeInstructions.trim()
        ? `Avoid the following: ${settings.imageNegativeInstructions.trim()}`
        : '',
      settings.imageModelLogoEnabled
        ? ''
        : [
            'LOGO GENERATION IS DISABLED.',
            'Do not draw, reproduce, invent, imitate, typeset, or place any logo, brand mark, watermark, website wordmark, or branded signature inside the generated image.',
            'Leave suitable clean space when branding is needed; Atlas will add the official logo after image generation.',
          ].join(' '),
    ].filter(Boolean);

    return {
      prompt: rules.join('\n\n'),
      modelLogoEnabled: settings.imageModelLogoEnabled,
      atlasLogoOverlayEnabled: settings.imageAtlasLogoOverlayEnabled,
    };
  }

  async getEmbeddingModel() {
    return (await this.get()).embeddingModel;
  }

  async getSportsNewsModel() {
    return (await this.get())
      .sportsNewsModel;
  }

  async getAiStudioSettings() {
    const settings = await this.get();
    return {
      model: settings.aiStudioModel,
      instructions: settings.aiStudioInstructions,
      timeoutMs: settings.aiStudioTimeoutMs,
      retryLimit: settings.aiStudioRetryLimit,
    };
  }

  async getCopilotSettings() {
    const settings = await this.get();
    return {
      model: settings.copilotModel,
      instructions: settings.copilotInstructions,
      knowledgeLimit: settings.copilotKnowledgeLimit,
      conversationRecallLimit: settings.copilotConversationRecallLimit,
      studioHistoryLimit: settings.copilotStudioHistoryLimit,
      contextMaxChars: settings.copilotContextMaxChars,
    };
  }

  private toSettings(setting: AiRuntimeSettings): AiRuntimeSettings {
    return Object.fromEntries(
      Object.keys(DEFAULT_SETTINGS).map((key) => [
        key,
        setting[key as keyof AiRuntimeSettings],
      ]),
    ) as AiRuntimeSettings;
  }
}
