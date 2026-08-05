import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '../generated/prisma/client';
import {
  BackgroundJobStatus,
  BackgroundJobType,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { GenerateAssetImageDto } from './dto/generate-asset-image.dto';
import { AssetImageService } from './asset-image.service';

@Injectable()
export class AssetImageBackgroundJobService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AssetImageBackgroundJobService.name);

  private processing = false;

  private readonly maximumAttempts = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly assetImages: AssetImageService,
  ) {}

  async onApplicationBootstrap() {
    /*
     * Jobs interrupted by an API restart are safely returned
     * to the queue instead of being permanently marked RUNNING.
     */
    const recovered = await this.prisma.backgroundJob.updateMany({
      where: {
        type: BackgroundJobType.ASSET_IMAGE,
        status: BackgroundJobStatus.RUNNING,
      },
      data: {
        status: BackgroundJobStatus.QUEUED,
        startedAt: null,
        error: null,
      },
    });

    if (recovered.count > 0) {
      this.logger.warn(
        `Recovered ${recovered.count} interrupted image job(s).`,
      );
    }

    void this.processQueue();
  }

  async enqueue(payload: GenerateAssetImageDto) {
    const job = await this.prisma.backgroundJob.create({
      data: {
        type: BackgroundJobType.ASSET_IMAGE,
        status: BackgroundJobStatus.QUEUED,
        payload: payload as unknown as Prisma.InputJsonValue,
        attempts: 0,
      },
    });

    /*
     * Start processing immediately without keeping the HTTP
     * request open. The interval also provides a fallback.
     */
    void this.processQueue();

    return this.toPublicJob(job);
  }

  async getJob(id: string) {
    const job = await this.prisma.backgroundJob.findFirstOrThrow({
      where: {
        id,
        type: BackgroundJobType.ASSET_IMAGE,
      },
    });

    return this.toPublicJob(job);
  }

  @Interval(2000)
  async processQueue() {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (true) {
        const job = await this.prisma.backgroundJob.findFirst({
          where: {
            type: BackgroundJobType.ASSET_IMAGE,
            status: BackgroundJobStatus.QUEUED,
          },
          orderBy: {
            createdAt: 'asc',
          },
        });

        if (!job) {
          break;
        }

        const claimed = await this.prisma.backgroundJob.updateMany({
          where: {
            id: job.id,
            type: BackgroundJobType.ASSET_IMAGE,
            status: BackgroundJobStatus.QUEUED,
          },
          data: {
            status: BackgroundJobStatus.RUNNING,
            startedAt: new Date(),
            completedAt: null,
            error: null,
            attempts: {
              increment: 1,
            },
          },
        });

        if (claimed.count !== 1) {
          continue;
        }

        const current = await this.prisma.backgroundJob.findUniqueOrThrow({
          where: {
            id: job.id,
          },
        });

        try {
          const payload = current.payload as unknown as GenerateAssetImageDto;

          const result = await this.assetImages.generateAndSave(payload);

          await this.prisma.backgroundJob.updateMany({
            where: {
              id: current.id,
              status: BackgroundJobStatus.RUNNING,
            },
            data: {
              status: BackgroundJobStatus.SUCCEEDED,
              result: result as unknown as Prisma.InputJsonValue,
              error: null,
              completedAt: new Date(),
            },
          });

          this.logger.log(`Image background job succeeded: ${current.id}`);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown image generation error';

          const shouldRetry = current.attempts < this.maximumAttempts;

          await this.prisma.backgroundJob.updateMany({
            where: {
              id: current.id,
              status: BackgroundJobStatus.RUNNING,
            },
            data: shouldRetry
              ? {
                  status: BackgroundJobStatus.QUEUED,
                  error: message,
                  startedAt: null,
                  completedAt: null,
                }
              : {
                  status: BackgroundJobStatus.FAILED,
                  error: message,
                  completedAt: new Date(),
                },
          });

          if (shouldRetry) {
            this.logger.warn(
              [
                `Image job ${current.id} failed.`,
                `Attempt ${current.attempts}/${this.maximumAttempts}.`,
                'Job returned to queue.',
                message,
              ].join(' '),
            );

            /*
             * Avoid an immediate rapid retry when an external
             * image API temporarily fails.
             */
            await this.sleep(3000);
          } else {
            this.logger.error(
              [
                `Image job ${current.id} failed permanently`,
                `after ${current.attempts} attempts.`,
                message,
              ].join(' '),
            );
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private toPublicJob(job: {
    id: string;
    status: BackgroundJobStatus;
    result: Prisma.JsonValue | null;
    error: string | null;
    attempts: number;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
      attempts: job.attempts,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  private sleep(milliseconds: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}
