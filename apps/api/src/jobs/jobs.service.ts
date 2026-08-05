import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BackgroundJobStatus,
  BackgroundJobType,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { ListJobsDto } from './dto/list-jobs.dto';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListJobsDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const search = query.search?.trim().toLowerCase();

    const where = {
      status: query.status,
      type: query.type,
    };

    const [jobs, total] = await Promise.all([
      this.prisma.backgroundJob.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.backgroundJob.count({
        where,
      }),
    ]);

    const filtered = search
      ? jobs.filter((job) => {
          const summary = this.getTitle(job.type, job.payload);
          return [
            job.id,
            job.type,
            job.status,
            summary,
            job.error,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(search);
        })
      : jobs;

    return {
      items: filtered.map((job) => this.toSummary(job)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(id: string) {
    const job = await this.prisma.backgroundJob.findUnique({
      where: {
        id,
      },
    });

    if (!job) {
      throw new NotFoundException('Background job not found.');
    }

    return {
      ...this.toSummary(job),
      payload: job.payload,
      result: job.result,
    };
  }

  async retry(id: string) {
    const job = await this.getJob(id);

    if (
      job.status !== BackgroundJobStatus.FAILED &&
      job.status !== BackgroundJobStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'Only failed or cancelled jobs can be retried.',
      );
    }

    const updated = await this.prisma.backgroundJob.update({
      where: {
        id,
      },
      data: {
        status: BackgroundJobStatus.QUEUED,
        error: null,
        result: undefined,
        attempts: 0,
        startedAt: null,
        completedAt: null,
      },
    });

    return this.toSummary(updated);
  }

  async cancel(id: string) {
    const job = await this.getJob(id);

    if (
      job.status === BackgroundJobStatus.SUCCEEDED ||
      job.status === BackgroundJobStatus.FAILED ||
      job.status === BackgroundJobStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `A ${job.status.toLowerCase()} job cannot be cancelled.`,
      );
    }

    /*
     * QUEUED jobs stop immediately.
     *
     * A RUNNING external request cannot always be forcibly interrupted,
     * but changing its durable status prevents it from being claimed again.
     * Workers must also avoid overwriting CANCELLED after finishing.
     */
    const updated = await this.prisma.backgroundJob.update({
      where: {
        id,
      },
      data: {
        status: BackgroundJobStatus.CANCELLED,
        error: 'Cancelled by user.',
        completedAt: new Date(),
      },
    });

    return this.toSummary(updated);
  }

  async remove(id: string) {
    const job = await this.getJob(id);

    if (
      job.status === BackgroundJobStatus.QUEUED ||
      job.status === BackgroundJobStatus.RUNNING
    ) {
      throw new BadRequestException(
        'Queued or running jobs cannot be deleted. Cancel the job first.',
      );
    }

    await this.prisma.backgroundJob.delete({
      where: {
        id,
      },
    });

    return {
      success: true,
      id,
    };
  }

  private async getJob(id: string) {
    const job = await this.prisma.backgroundJob.findUnique({
      where: {
        id,
      },
    });

    if (!job) {
      throw new NotFoundException('Background job not found.');
    }

    return job;
  }

  private toSummary(job: {
    id: string;
    type: BackgroundJobType;
    status: BackgroundJobStatus;
    payload: unknown;
    result: unknown;
    error: string | null;
    attempts: number;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      title: this.getTitle(job.type, job.payload),
      progress: this.getProgress(job.status),
      attempts: job.attempts,
      error: job.error,
      resultAvailable: job.result !== null,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      updatedAt: job.updatedAt,
    };
  }

  private getProgress(status: BackgroundJobStatus): number {
    switch (status) {
      case BackgroundJobStatus.QUEUED:
        return 5;
      case BackgroundJobStatus.RUNNING:
        return 50;
      case BackgroundJobStatus.SUCCEEDED:
        return 100;
      case BackgroundJobStatus.FAILED:
      case BackgroundJobStatus.CANCELLED:
        return 100;
      default:
        return 0;
    }
  }

  private getTitle(
    type: BackgroundJobType,
    payload: unknown,
  ): string {
    const data =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};

    const candidates = [
      data.name,
      data.title,
      data.topic,
      data.prompt,
    ];

    const title = candidates.find(
      (value): value is string =>
        typeof value === 'string' &&
        value.trim().length > 0,
    );

    if (title) {
      const normalized = title.trim().replace(/\s+/g, ' ');
      return normalized.length > 90
        ? `${normalized.slice(0, 87)}...`
        : normalized;
    }

    const labels: Record<BackgroundJobType, string> = {
      [BackgroundJobType.AI_STUDIO]: 'AI Studio content',
      [BackgroundJobType.COPILOT_CHAT]: 'Atlas Copilot response',
      [BackgroundJobType.COPILOT_MARKETING_PLAN]:
        'Marketing plan',
      [BackgroundJobType.ASSET_IMAGE]: 'Image generation',
    };

    return labels[type] || type;
  }
}
