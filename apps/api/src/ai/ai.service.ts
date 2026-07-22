import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { BrandsService } from '../brands/brands.service';
import { HistoryService } from '../history/history.service';
import { GenerateContentDto } from './dto/generate-content.dto';
import { PromptBuilderService } from './prompt-builder.service';

type GeneratedContent = {
  facebook: string;
  telegram: string;
  reels: string;
  image: string;
  analysis: {
    summary: string;
    viralScore: number;
    discussionScore: number;
    shareabilityScore: number;
    brandFitScore: number;
    bestPostingTime: string;
  };
};

type GeneratedOutputs = GeneratedContent & {
  brandUsed: {
    id: string;
    name: string;
    workspaceName: string;
  };
  historyId: string;
};

@Injectable()
export class AiService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly brandsService: BrandsService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly historyService: HistoryService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async generate(dto: GenerateContentDto): Promise<GeneratedOutputs> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured in apps/api/.env',
      );
    }

    const brand = await this.brandsService.getActiveBrand();
    const prompt = this.promptBuilder.build(dto, brand);
    const model =
      this.configService.get<string>('OPENAI_MODEL') || 'gpt-4.1-mini';

    try {
      const response = await this.client.responses.create({
        model,
        input: prompt,
        text: {
          format: {
            type: 'json_schema',
            name: 'atlas_content_package',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                facebook: { type: 'string' },
                telegram: { type: 'string' },
                reels: { type: 'string' },
                image: { type: 'string' },
                analysis: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    summary: { type: 'string' },
                    viralScore: {
                      type: 'integer',
                      minimum: 0,
                      maximum: 100,
                    },
                    discussionScore: {
                      type: 'integer',
                      minimum: 0,
                      maximum: 100,
                    },
                    shareabilityScore: {
                      type: 'integer',
                      minimum: 0,
                      maximum: 100,
                    },
                    brandFitScore: {
                      type: 'integer',
                      minimum: 0,
                      maximum: 100,
                    },
                    bestPostingTime: { type: 'string' },
                  },
                  required: [
                    'summary',
                    'viralScore',
                    'discussionScore',
                    'shareabilityScore',
                    'brandFitScore',
                    'bestPostingTime',
                  ],
                },
              },
              required: [
                'facebook',
                'telegram',
                'reels',
                'image',
                'analysis',
              ],
            },
          },
        },
      });

      const generated = JSON.parse(
        response.output_text,
      ) as GeneratedContent;

      const history = await this.historyService.save({
        brandId: brand.id,
        topic: dto.topic,
        platforms: dto.platforms,
        style: dto.style,
        language: dto.language,
        facebook: generated.facebook,
        telegram: generated.telegram,
        reels: generated.reels,
        imagePrompt: generated.image,
        analysis: generated.analysis,
      });

      return {
        ...generated,
        brandUsed: {
          id: brand.id,
          name: brand.name,
          workspaceName: brand.workspace.name,
        },
        historyId: history.id,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown OpenAI error';

      throw new InternalServerErrorException(
        `Content generation failed: ${message}`,
      );
    }
  }

  async previewPrompt(dto: GenerateContentDto) {
    const brand = await this.brandsService.getActiveBrand();
    return this.promptBuilder.preview(dto, brand);
  }
}
