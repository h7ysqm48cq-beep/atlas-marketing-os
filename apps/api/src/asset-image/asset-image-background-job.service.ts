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

  private readonly staleRunningJobAgeMs = 30 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly assetImages: AssetImageService,
  ) {}

  async onApplicationBootstrap() {
    /*
     * Recover only jobs whose lease is old enough to be considered stale.
     * A blanket RUNNING reset can duplicate work during rolling deploys,
     * while another instance is still generating the image.
     */
    const staleBefore = new Date(Date.now() - this.staleRunningJobAgeMs);
    const recovered = await this.prisma.backgroundJob.updateMany({
      where: {
        type: BackgroundJobType.ASSET_IMAGE,
        status: BackgroundJobStatus.RUNNING,
        OR: [
          { startedAt: null },
          {
            startedAt: {
              lt: staleBefore,
            },
          },
        ],
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

  async getRecoverableJobs(conversationId: string) {
    const normalizedConversationId = conversationId.trim();

    if (!normalizedConversationId) {
      return [];
    }

    const recentTerminalCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const jobs = await this.prisma.backgroundJob.findMany({
      where: {
        type: BackgroundJobType.ASSET_IMAGE,
        payload: {
          path: ['conversationId'],
          equals: normalizedConversationId,
        },
        OR: [
          {
            status: {
              in: [BackgroundJobStatus.QUEUED, BackgroundJobStatus.RUNNING],
            },
          },
          {
            status: {
              in: [BackgroundJobStatus.SUCCEEDED, BackgroundJobStatus.FAILED],
            },
            completedAt: {
              gte: recentTerminalCutoff,
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    return jobs.map((job) => this.toPublicJob(job));
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const stack = error instanceof Error ? error.stack : undefined;

      this.logger.error(`Asset image queue cycle failed: ${message}`, stack);
    } finally {
      this.processing = false;
    }
  }

  private toPublicJob(job: {
    id: string;
    status: BackgroundJobStatus;
    payload: Prisma.JsonValue;
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
      payload: job.payload,
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
