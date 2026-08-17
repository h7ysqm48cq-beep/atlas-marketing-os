import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRuntimeSettingsService } from '../ai-runtime/ai-runtime-settings.service';
import OpenAI from 'openai';
import { GenerateImageDto } from './dto/generate-image.dto';

@Injectable()
export class ImageService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiRuntime: AiRuntimeSettingsService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async generate(dto: GenerateImageDto) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured in apps/api/.env',
      );
    }

    const model = await this.aiRuntime.getImageModel();

    try {
      const imagePolicy = await this.aiRuntime.applyImageGenerationPolicy(
        dto.prompt,
      );
      const result = await this.client.images.generate({
        model,
        prompt: imagePolicy.prompt,
        size: dto.size,
        quality: dto.quality,
        n: 1,
      });

      const imageBase64 = result.data?.[0]?.b64_json;

      if (!imageBase64) {
        throw new Error('The image API returned no image data.');
      }

      return {
        imageDataUrl: `data:image/png;base64,${imageBase64}`,
        mimeType: 'image/png',
        size: dto.size,
        quality: dto.quality,
        model,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown image API error';

      throw new InternalServerErrorException(
        `Image generation failed: ${message}`,
      );
    }
  }
}
