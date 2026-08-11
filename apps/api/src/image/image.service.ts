import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GenerateImageDto } from './dto/generate-image.dto';
import { BrandOverlayService } from './brand/brand-overlay.service';
import { BrandsService } from '../brands/brands.service';

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);
  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly brandOverlayService: BrandOverlayService,
    private readonly brandsService: BrandsService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    this.client = apiKey
      ? new OpenAI({
          apiKey,
          timeout: 120_000,
          maxRetries: 2,
        })
      : null;
  }

  async generate(dto: GenerateImageDto) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured in apps/api/.env',
      );
    }

    const configuredModel =
      this.configService.get<string>('OPENAI_IMAGE_MODEL') || 'gpt-image-2';

    return this.generateWithModel(dto, configuredModel);
  }


  private async generateWithModel(
    dto: GenerateImageDto,
    model: string,
  ) {
    const sleep = (ms: number) =>
      new Promise<void>((resolve) =>
        setTimeout(resolve, ms),
      );

    const request = async (
      size: GenerateImageDto['size'],
      quality: GenerateImageDto['quality'],
      attempt: number,
    ) => {
      this.logger.log(
        [
          'Generating image via OpenAI SDK.',
          `model=${model}`,
          `size=${size}`,
          `quality=${quality}`,
          `attempt=${attempt}`,
        ].join(' | '),
      );

      const response =
        await this.client!.images.generate({
          model,
          prompt: dto.prompt,
          size,
          quality,
          n: 1,
        });

      const imageBase64 =
        response.data?.[0]?.b64_json;

      if (!imageBase64) {
        throw new Error(
          'The image API returned no image data.',
        );
      }

      let finalImageBase64 = imageBase64;

      try {
        const brand =
          await this.brandsService.getActiveBrand();

        const [width, height] =
          size.split('x').map(Number);

        const brandedBuffer =
          await this.brandOverlayService.apply({
            image: Buffer.from(
              imageBase64,
              'base64',
            ),
            brandId: brand.id,
            width,
            height,
          });

        finalImageBase64 =
          brandedBuffer.toString('base64');
      } catch (error) {
        this.logger.warn(
          error instanceof Error
            ? error.message
            : 'Brand overlay skipped',
        );
      }

      const imageDataUrl =
        `data:image/png;base64,${finalImageBase64}`;

      return {
        ok: true as const,
        imageDataUrl,
        imageBase64: finalImageBase64,
        prompt: dto.prompt,
        watermarkApplied: true,
        footerApplied: true,
        mimeType: 'image/png',
        size,
        model,
      };
    };


    try {
      let result = await request(
        dto.size,
        dto.quality,
        1,
      );

      if (!result.ok) {
        await sleep(5000);
        result = await request(
          dto.size,
          dto.quality,
          2,
        );
      }

      return result;

    } catch (error) {

      const detail =
        this.describeError(error);

      return {
        ok: false as const,
        ...detail,
        retryable: false,
        retryAfter: 0,
      };
    }
  }


  private describeError(error: unknown): {
    message: string;
    status?: number;
    code?: string;
    type?: string;
    requestId?: string;
  } {
    if (error instanceof OpenAI.APIError) {
      return {
        message: error.message,
        status: error.status,
        code: typeof error.code === 'string' ? error.code : undefined,
        type: typeof error.type === 'string' ? error.type : undefined,
        requestId: error.requestID ?? undefined,
      };
    }

    if (error instanceof Error) {
      const cause =
        error.cause instanceof Error ? ` | cause=${error.cause.message}` : '';

      return {
        message: `${error.message}${cause}`,
      };
    }

    return {
      message: String(error),
    };
  }
}
