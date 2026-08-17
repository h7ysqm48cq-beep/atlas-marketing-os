import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '../generated/prisma/client';
import {
  BackgroundJobStatus,
  BackgroundJobType,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { GenerateContentDto } from './dto/generate-content.dto';
import { AiService } from './ai.service';

@Injectable()
export class AiBackgroundJobService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiBackgroundJobService.name);
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async onApplicationBootstrap() {
    await this.prisma.backgroundJob.updateMany({
      where: {
        type: BackgroundJobType.AI_STUDIO,
        status: BackgroundJobStatus.RUNNING,
      },
      data: { status: BackgroundJobStatus.QUEUED },
    });
    void this.processQueue();
  }

  async enqueue(payload: GenerateContentDto) {
    const job = await this.prisma.backgroundJob.create({
      data: {
        type: BackgroundJobType.AI_STUDIO,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    void this.processQueue();
    return this.publicJob(job);
  }

  async get(id: string) {
    const job = await this.prisma.backgroundJob.findFirstOrThrow({
      where: { id, type: BackgroundJobType.AI_STUDIO },
    });
    return this.publicJob(job);
  }

  @Interval(5000)
  processPending() {
    void this.processQueue();
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const job = await this.prisma.backgroundJob.findFirst({
          where: {
            type: BackgroundJobType.AI_STUDIO,
            status: BackgroundJobStatus.QUEUED,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (!job) break;

        const claimed = await this.prisma.backgroundJob.updateMany({
          where: { id: job.id, status: BackgroundJobStatus.QUEUED },
          data: {
            status: BackgroundJobStatus.RUNNING,
            startedAt: new Date(),
            attempts: { increment: 1 },
            error: null,
          },
        });
        if (!claimed.count) continue;

        try {
          const result = await this.ai.generate(
            job.payload as unknown as GenerateContentDto,
          );
          await this.prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: BackgroundJobStatus.SUCCEEDED,
              result: JSON.parse(
                JSON.stringify(result),
              ) as Prisma.InputJsonValue,
              completedAt: new Date(),
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`AI Studio job ${job.id} failed: ${message}`);
          await this.prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: BackgroundJobStatus.FAILED,
              error: message,
              completedAt: new Date(),
            },
          });
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private publicJob(job: {
    id: string;
    status: BackgroundJobStatus;
    result: Prisma.JsonValue | null;
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
