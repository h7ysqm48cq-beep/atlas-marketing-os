import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import OpenAI from 'openai';
import { GenerateImageDto } from './dto/generate-image.dto';
import { BrandOverlayService } from './brand/brand-overlay.service';
import { BrandsService } from '../brands/brands.service';

const execFileAsync = promisify(execFile);

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

  private async generateWithModel(dto: GenerateImageDto, model: string) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured.',
      );
    }

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    const request = async (
      size: GenerateImageDto['size'],
      quality: GenerateImageDto['quality'],
      attempt: number,
    ) => {
      const payload = JSON.stringify({
        model,
        prompt: dto.prompt,
        size,
        quality,
        n: 1,
      });

      const marker = '\n__ATLAS_HTTP_STATUS__:';

      this.logger.log(
        [
          'Generating image via curl transport.',
          `model=${model}`,
          `size=${size}`,
          `quality=${quality}`,
          `attempt=${attempt}`,
        ].join(' | '),
      );

      const tempDirectory = await mkdtemp(join(tmpdir(), 'atlas-image-'));

      const payloadPath = join(tempDirectory, 'payload.json');

      let stdout = '';
      let stderr = '';

      try {
        await writeFile(payloadPath, payload, {
          encoding: 'utf8',
          mode: 0o600,
        });

        this.logger.log(
          [
            'Image request payload prepared.',
            `bytes=${Buffer.byteLength(payload, 'utf8')}`,
            `attempt=${attempt}`,
          ].join(' | '),
        );

        const result = await execFileAsync(
          '/usr/bin/curl',
          [
            '-sS',
            '--http1.1',
            '--max-time',
            '180',
            '--connect-timeout',
            '15',
            'https://api.openai.com/v1/images/generations',
            '-H',
            `Authorization: Bearer ${apiKey}`,
            '-H',
            'Content-Type: application/json',
            '-H',
            'Accept: application/json',
            '--data-binary',
            `@${payloadPath}`,
            '-w',
            `${marker}%{http_code}`,
          ],
          {
            encoding: 'utf8',
            maxBuffer: 40 * 1024 * 1024,
            timeout: 195_000,
          },
        );

        stdout = result.stdout;
        stderr = result.stderr;
      } finally {
        await rm(tempDirectory, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }

      const markerIndex = stdout.lastIndexOf(marker);

      if (markerIndex === -1) {
        throw new Error(
          `curl returned no HTTP status marker${
            stderr ? `: ${stderr.slice(0, 500)}` : ''
          }`,
        );
      }

      const raw = stdout.slice(0, markerIndex);

      const status = Number(stdout.slice(markerIndex + marker.length).trim());

      if (!Number.isInteger(status)) {
        throw new Error(`Invalid HTTP status returned by curl.`);
      }

      if (status >= 200 && status < 300) {
        const result = JSON.parse(raw) as {
          data?: Array<{
            b64_json?: string;
          }>;
        };

        const imageBase64 = result.data?.[0]?.b64_json;

        if (!imageBase64) {
          throw new Error('The image API returned no image data.');
        }

        let finalImageBase64 = imageBase64;

        try {
          const brand = await this.brandsService.getActiveBrand();

          const [width, height] = size.split('x').map(Number);

          const brandedBuffer = await this.brandOverlayService.apply({
            image: Buffer.from(imageBase64, 'base64'),
            brandId: brand.id,
            width,
            height,
          });

          finalImageBase64 = brandedBuffer.toString('base64');

          this.logger.log('Global Brand Kit applied.');
        } catch (error) {
          this.logger.warn(
            [
              'Brand overlay skipped.',
              error instanceof Error ? error.message : 'Unknown error',
            ].join(' '),
          );
        }

        this.logger.log(
          [
            'Image generation succeeded via curl transport.',
            `model=${model}`,
            `size=${size}`,
            `quality=${quality}`,
            `attempt=${attempt}`,
            `bytes=${imageBase64.length}`,
          ].join(' | '),
        );

        return {
          ok: true as const,
          status,
          imageBase64,
          size,
          quality,
        };
      }

      let message = raw.trim() || `HTTP ${status}`;

      let retryable =
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        status === 520;

      let retryAfter = 0;

      try {
        const parsed = JSON.parse(raw) as {
          error?: {
            message?: string;
          };
          detail?: string;
          retryable?: boolean;
          retry_after?: number;
        };

        message = parsed.error?.message || parsed.detail || message;

        if (typeof parsed.retryable === 'boolean') {
          retryable = parsed.retryable;
        }

        if (
          typeof parsed.retry_after === 'number' &&
          Number.isFinite(parsed.retry_after)
        ) {
          retryAfter = parsed.retry_after;
        }
      } catch {
        // Keep raw response.
      }

      this.logger.warn(
        [
          'Image API request failed.',
          `model=${model}`,
          `status=${status}`,
          `size=${size}`,
          `quality=${quality}`,
          `attempt=${attempt}`,
          `retryable=${retryable}`,
          `retryAfter=${retryAfter}`,
          `message=${message.slice(0, 500)}`,
        ].join(' | '),
      );

      return {
        ok: false as const,
        status,
        retryable,
        retryAfter,
        message,
      };
    };

    try {
      /*
       * Attempt 1:
       * exact requested Sports News settings.
       */
      let result = await request(dto.size, dto.quality, 1);

      /*
       * Attempt 2:
       * Cloudflare/OpenAI explicitly asked us to back off.
       */
      if (!result.ok && result.retryable) {
        const waitSeconds = 10;

        this.logger.warn(
          `Retrying image generation after ${waitSeconds}s backoff.`,
        );

        await sleep(waitSeconds * 1000);

        result = await request('1024x1024', 'low', 2);
      }

      if (!result.ok) {
        throw new Error(
          `OpenAI image API returned HTTP ${result.status}: ${result.message}`,
        );
      }

      return {
        imageDataUrl: `data:image/png;base64,${result.imageBase64}`,
        mimeType: 'image/png',
        size: result.size,
        quality: result.quality,
        model,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown image API error';

      this.logger.error(
        `Image generation failed after retry strategy: ${message}`,
      );

      throw new InternalServerErrorException(
        `Image generation failed: ${message}`,
      );
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
