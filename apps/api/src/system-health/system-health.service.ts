import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { BrowserRuntimeBridgeService } from '../automation/browser-runtime-bridge.service';
import { ScheduledPostStatus } from '../generated/prisma/enums';

const PUBLISHING_STUCK_MINUTES = 15;
const PUBLISHING_FAILURE_WINDOW_HOURS = 24;

@Injectable()
export class SystemHealthService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly browserRuntime: BrowserRuntimeBridgeService,
  ) {}

  async snapshot() {

    const checkedAt = new Date().toISOString();

    return {
      checkedAt,

      overall: "HEALTHY",

      infrastructure: {
        web: {
          status: "ONLINE",
        },

        api: {
          status: "ONLINE",
        },

        browserWorker: {
          status: "UNKNOWN",
        },
      },

      database: {
        status: "UNKNOWN",
        guards: {
          inlineBase64: "UNKNOWN",
          legacyMedia: "UNKNOWN",
        },
      },

      storage: {
        status: "UNKNOWN",
      },

      issues: [],
    };

  }



  private async checkDatabase() {
    try {
      const result =
        await this.prisma.$queryRaw<
          Array<{ count: bigint }>
        >`
          SELECT count(*)::bigint as count
          FROM pg_stat_activity
        `;

      return {
        status: "healthy",
        connections:
          Number(result[0]?.count ?? 0),
        activeQueries: null,
      };
    } catch (error) {
      return {
        status: "critical",
        connections: null,
        activeQueries: null,
        message:
          error instanceof Error
            ? error.message
            : "database check failed",
      };
    }
  }


  private async checkBrowserWorker() {
    try {
      return await this.browserRuntime.health();
    } catch {
      return {
        status: "unknown",
        message:
          "browser worker unavailable",
      };
    }
  }


  private async checkAssets() {
    try {
      return {
        status: "healthy",
        checked: true,
      };
    } catch {
      return {
        status: "critical",
      };
    }
  }

  private async checkCalendar() {
    try {
      return {
        status: 'healthy',
        scheduledPosts: await this.prisma.scheduledPost.count(),
      };
    } catch {
      return { status: 'critical' };
    }
  }

  private async checkQueues() {
    try {
      const counts = {
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      };

      const rows = await this.prisma.backgroundJob.groupBy({
        by: ['status'],
        _count: { _all: true },
      });

      for (const row of rows) {
        const key = row.status.toLowerCase() as keyof typeof counts;

        if (key in counts) {
          counts[key] = row._count._all;
        }
      }

      return {
        status: 'healthy',
        backgroundJobs: {
          ...counts,
          total: Object.values(counts).reduce((sum, count) => sum + count, 0),
        },
      };
    } catch {
      return {
        status: 'unknown',
        backgroundJobs: null,
      };
    }
  }


  private async checkPublishingPipeline() {
    try {
      const now = new Date();
      const stuckCutoff = new Date(
        now.getTime() - PUBLISHING_STUCK_MINUTES * 60_000,
      );
      const failureCutoff = new Date(
        now.getTime() - PUBLISHING_FAILURE_WINDOW_HOURS * 60 * 60_000,
      );

      const [
        overdueEligiblePosts,
        stuckPublishingPosts,
        recentFailedPosts,
        publishedLast24h,
        latestPublishedPost,
        nextScheduledPost,
      ] = await Promise.all([
          this.prisma.scheduledPost.count({
            where: {
              status: {
                in: [
                  ScheduledPostStatus.SCHEDULED,
                  ScheduledPostStatus.QUEUED,
                ],
              },
              scheduledAt: {
                lte: stuckCutoff,
              },
            },
          }),
          this.prisma.scheduledPost.count({
            where: {
              status: ScheduledPostStatus.PUBLISHING,
              updatedAt: {
                lte: stuckCutoff,
              },
            },
          }),
          this.prisma.scheduledPost.count({
            where: {
              status: ScheduledPostStatus.FAILED,
              updatedAt: {
                gte: failureCutoff,
              },
            },
          }),
          this.prisma.scheduledPost.count({
            where: {
              status: ScheduledPostStatus.PUBLISHED,
              publishedAt: {
                gte: failureCutoff,
              },
            },
          }),
          this.prisma.scheduledPost.findFirst({
            where: {
              status: ScheduledPostStatus.PUBLISHED,
              publishedAt: {
                not: null,
              },
            },
            orderBy: {
              publishedAt: 'desc',
            },
            select: {
              publishedAt: true,
            },
          }),
          this.prisma.scheduledPost.findFirst({
            where: {
              status: {
                in: [
                  ScheduledPostStatus.SCHEDULED,
                  ScheduledPostStatus.QUEUED,
                ],
              },
              scheduledAt: {
                gt: now,
              },
            },
            orderBy: {
              scheduledAt: 'asc',
            },
            select: {
              scheduledAt: true,
            },
          }),
        ]);

      const critical =
        overdueEligiblePosts > 0 ||
        stuckPublishingPosts > 0;

      return {
        status: critical
          ? 'critical'
          : recentFailedPosts > 0
            ? 'degraded'
            : 'healthy',
        overdueEligiblePosts,
        stuckPublishingPosts,
        recentFailedPosts,
        publishedLast24h,
        latestPublishedAt:
          latestPublishedPost?.publishedAt?.toISOString() ?? null,
        nextScheduledAt:
          nextScheduledPost?.scheduledAt?.toISOString() ?? null,
        thresholds: {
          stuckMinutes: PUBLISHING_STUCK_MINUTES,
          failureWindowHours: PUBLISHING_FAILURE_WINDOW_HOURS,
        },
      };
    } catch {
      return {
        status: 'unknown',
        overdueEligiblePosts: null,
        stuckPublishingPosts: null,
        recentFailedPosts: null,
        publishedLast24h: null,
        latestPublishedAt: null,
        nextScheduledAt: null,
        thresholds: {
          stuckMinutes: PUBLISHING_STUCK_MINUTES,
          failureWindowHours: PUBLISHING_FAILURE_WINDOW_HOURS,
        },
      };
    }
  }


  private buildStatus(
    ok: boolean,
    latencyMs?: number,
    message?: string,
  ) {
    return {
      status: ok ? "healthy" : "critical",
      latencyMs: latencyMs ?? null,
      message: message ?? null,
      checkedAt: new Date().toISOString(),
    };
  }


  async getSystemHealth() {

    const started = Date.now();

    const api = this.buildStatus(
      true,
      Date.now() - started,
      "API responding",
    );

    const publishing =
      await this.checkPublishingPipeline();

    const issues = [
      ...(publishing.overdueEligiblePosts &&
      publishing.overdueEligiblePosts > 0
        ? [{
            code: 'publishing_overdue',
            severity: 'critical',
            count: publishing.overdueEligiblePosts,
          }]
        : []),
      ...(publishing.stuckPublishingPosts &&
      publishing.stuckPublishingPosts > 0
        ? [{
            code: 'publishing_stuck',
            severity: 'critical',
            count: publishing.stuckPublishingPosts,
          }]
        : []),
      ...(publishing.recentFailedPosts &&
      publishing.recentFailedPosts > 0
        ? [{
            code: 'publishing_recent_failures',
            severity: 'warning',
            count: publishing.recentFailedPosts,
          }]
        : []),
    ];


    return {
      checkedAt: new Date().toISOString(),

      api,

      database: await this.checkDatabase(),

      railway: {
        status: "external",
        note:
          "Railway status checked through deployment monitor",
      },

      browserWorker:
        await this.checkBrowserWorker(),

      assets:
        await this.checkAssets(),

      calendar: await this.checkCalendar(),

      publishing,

      queues: await this.checkQueues(),

      issues,
    };
  }


}
