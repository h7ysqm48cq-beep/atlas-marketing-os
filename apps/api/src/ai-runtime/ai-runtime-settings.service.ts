import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type AiRuntimeSettings = {
  textModel: string;
  imageModel: string;
  embeddingModel: string;
  sportsNewsModel: string;
};

const DEFAULT_SETTINGS: AiRuntimeSettings = {
  textModel: 'gpt-5.6-luna',
  imageModel: 'gpt-image-2',
  embeddingModel: 'text-embedding-3-large',
  sportsNewsModel: 'gpt-5.6-luna',
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
        embeddingModel: existing.embeddingModel,
        sportsNewsModel:
          existing.sportsNewsModel,
      };
    }

    const created =
      await this.prisma.aiRuntimeSetting.create({
        data: DEFAULT_SETTINGS,
      });

    return {
      textModel: created.textModel,
      imageModel: created.imageModel,
      embeddingModel: created.embeddingModel,
      sportsNewsModel:
        created.sportsNewsModel,
    };
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
        textModel: created.textModel,
        imageModel: created.imageModel,
        embeddingModel:
          created.embeddingModel,
        sportsNewsModel:
          created.sportsNewsModel,
      };
    }

    const updated =
      await this.prisma.aiRuntimeSetting.update({
        where: {
          id: current.id,
        },
        data,
      });

    return {
      textModel: updated.textModel,
      imageModel: updated.imageModel,
      embeddingModel:
        updated.embeddingModel,
      sportsNewsModel:
        updated.sportsNewsModel,
    };
  }

  async getTextModel() {
    return (await this.get()).textModel;
  }

  async getImageModel() {
    return (await this.get()).imageModel;
  }

  async getEmbeddingModel() {
    return (await this.get()).embeddingModel;
  }

  async getSportsNewsModel() {
    return (await this.get())
      .sportsNewsModel;
  }
}
