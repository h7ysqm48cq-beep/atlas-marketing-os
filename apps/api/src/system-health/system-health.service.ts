import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { BrowserRuntimeBridgeService } from '../automation/browser-runtime-bridge.service';
import { ScheduledPostStatus } from '../generated/prisma/enums';

const PUBLISHING_STUCK_MINUTES = 15;
const PUBLISHING_FAILURE_WINDOW_HOURS = 24;
const SPORTS_SCHEDULER_GRACE_MINUTES = 15;

const DEPLOYMENT_AUTOMATION_PRIMARY_CADENCE_SECONDS = 60;

export function buildDeploymentAutomationHealth() {
  return {
    status: 'informational',
    policy: 'railway_daemon_primary_github_schedule_fallback',
    primary: {
      provider: 'railway',
      mode: 'daemon',
      service: 'production-deploy-executor',
      expectedCadenceSeconds: DEPLOYMENT_AUTOMATION_PRIMARY_CADENCE_SECONDS,
      livenessSource: 'runtime_heartbeat',
    },
    fallback: {
      provider: 'github-actions',
      mode: 'schedule',
      workflow: 'atlas-production-deploy-executor.yml',
      configuredCron: '*/5 * * * *',
      cadenceGuarantee: 'best_effort',
    },
    note:
      'Production liveness is determined by the Railway daemon heartbeat; GitHub scheduled workflow timing is fallback-only and is not a five-minute SLA.',
  };
}

type SportsSchedulerSettingsSnapshot = {
  enabled: boolean;
  timezone: string;
  morningEnabled: boolean;
  morningTime: string;
  eveningEnabled: boolean;
  eveningTime: string;
  lastMorningRunAt: Date | null;
  lastEveningRunAt: Date | null;
  lastRunStatus: string | null;
  lastError: string | null;
};

function localDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function localTime(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);

  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';

  return `${hour}:${minute}`;
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(':').map(Number);
  const total = hour * 60 + minute + minutes;
  const normalized = Math.min(total, 23 * 60 + 59);
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(
    normalized % 60,
  ).padStart(2, '0')}`;
}

export function buildSportsSchedulerHealth(
  settings: SportsSchedulerSettingsSnapshot | null,
  now = new Date(),
) {
  if (!settings) {
    return {
      status: 'unknown',
      enabled: null,
      timezone: null,
      morningTime: null,
      eveningTime: null,
      lastMorningRunAt: null,
      lastEveningRunAt: null,
      lastRunStatus: null,
      lastError: null,
      nextRunLocal: null,
      missedRuns: [] as string[],
      graceMinutes: SPORTS_SCHEDULER_GRACE_MINUTES,
    };
  }

  if (!settings.enabled) {
    return {
      status: 'disabled',
      enabled: false,
      timezone: settings.timezone,
      morningTime: settings.morningTime,
      eveningTime: settings.eveningTime,
      lastMorningRunAt: settings.lastMorningRunAt?.toISOString() ?? null,
      lastEveningRunAt: settings.lastEveningRunAt?.toISOString() ?? null,
      lastRunStatus: settings.lastRunStatus,
      lastError: settings.lastError,
      nextRunLocal: null,
      missedRuns: [] as string[],
      graceMinutes: SPORTS_SCHEDULER_GRACE_MINUTES,
    };
  }

  const today = localDate(now, settings.timezone);
  const currentTime = localTime(now, settings.timezone);
  const ranToday = (value: Date | null) =>
    value ? localDate(value, settings.timezone) === today : false;

  const missedRuns: string[] = [];

  if (
    settings.morningEnabled &&
    currentTime >= addMinutes(settings.morningTime, SPORTS_SCHEDULER_GRACE_MINUTES) &&
    !ranToday(settings.lastMorningRunAt)
  ) {
    missedRuns.push('MORNING');
  }

  if (
    settings.eveningEnabled &&
    currentTime >= addMinutes(settings.eveningTime, SPORTS_SCHEDULER_GRACE_MINUTES) &&
    !ranToday(settings.lastEveningRunAt)
  ) {
    missedRuns.push('EVENING');
  }

  const slots = [
    ...(settings.morningEnabled
      ? [{ edition: 'MORNING', time: settings.morningTime }]
      : []),
    ...(settings.eveningEnabled
      ? [{ edition: 'EVENING', time: settings.eveningTime }]
      : []),
  ].sort((left, right) => left.time.localeCompare(right.time));

  const nextToday = slots.find((slot) => slot.time > currentTime);
  const tomorrow = localDate(
    new Date(now.getTime() + 24 * 60 * 60_000),
    settings.timezone,
  );
  const nextRunLocal = nextToday
    ? `${today} ${nextToday.time} ${settings.timezone} ${nextToday.edition}`
    : slots[0]
      ? `${tomorrow} ${slots[0].time} ${settings.timezone} ${slots[0].edition}`
      : null;

  return {
    status:
      missedRuns.length > 0
        ? 'critical'
        : settings.lastRunStatus === 'FAILED' || Boolean(settings.lastError)
          ? 'degraded'
          : 'healthy',
    enabled: true,
    timezone: settings.timezone,
    morningTime: settings.morningTime,
    eveningTime: settings.eveningTime,
    lastMorningRunAt: settings.lastMorningRunAt?.toISOString() ?? null,
    lastEveningRunAt: settings.lastEveningRunAt?.toISOString() ?? null,
    lastRunStatus: settings.lastRunStatus,
    lastError: settings.lastError,
    nextRunLocal,
    missedRuns,
    graceMinutes: SPORTS_SCHEDULER_GRACE_MINUTES,
  };
}

type CoreHealthSnapshot = {
  database: { status?: string; message?: string | null };
  browserWorker: { status?: string; healthy?: boolean; message?: string | null };
  assets: { status?: string };
  calendar: { status?: string };
  publishing: {
    status?: string;
    overdueEligiblePosts?: number | null;
    stuckPublishingPosts?: number | null;
    recentFailedPosts?: number | null;
  };
  sportsScheduler: {
    status?: string;
    missedRuns: string[];
    lastError?: string | null;
  };
  queues: {
    status?: string;
    backgroundJobs?: {
      failed?: number | null;
    } | null;
  };
};

export function buildSystemHealthIssues(snapshot: CoreHealthSnapshot) {
  return [
    ...(snapshot.database.status === 'critical'
      ? [{
          code: 'database_unhealthy',
          severity: 'critical',
          message: snapshot.database.message ?? null,
        }]
      : []),

    ...(
      snapshot.browserWorker.healthy === false ||
      snapshot.browserWorker.status === 'critical' ||
      snapshot.browserWorker.status === 'unknown'
        ? [{
            code: 'browser_worker_unhealthy',
            severity: 'critical',
            message: snapshot.browserWorker.message ?? null,
          }]
        : []
    ),

    ...(snapshot.assets.status === 'critical'
      ? [{
          code: 'assets_unhealthy',
          severity: 'critical',
        }]
      : []),

    ...(snapshot.calendar.status === 'critical'
      ? [{
          code: 'calendar_unhealthy',
          severity: 'critical',
        }]
      : []),

    ...(snapshot.publishing.status === 'unknown'
      ? [{
          code: 'publishing_health_unknown',
          severity: 'critical',
        }]
      : []),

    ...(snapshot.publishing.overdueEligiblePosts &&
    snapshot.publishing.overdueEligiblePosts > 0
      ? [{
          code: 'publishing_overdue',
          severity: 'critical',
          count: snapshot.publishing.overdueEligiblePosts,
        }]
      : []),

    ...(snapshot.publishing.stuckPublishingPosts &&
    snapshot.publishing.stuckPublishingPosts > 0
      ? [{
          code: 'publishing_stuck',
          severity: 'critical',
          count: snapshot.publishing.stuckPublishingPosts,
        }]
      : []),

    ...(snapshot.publishing.recentFailedPosts &&
    snapshot.publishing.recentFailedPosts > 0
      ? [{
          code: 'publishing_recent_failures',
          severity: 'warning',
          count: snapshot.publishing.recentFailedPosts,
        }]
      : []),

    ...(snapshot.sportsScheduler.status === 'unknown'
      ? [{
          code: 'sports_scheduler_health_unknown',
          severity: 'critical',
        }]
      : []),

    ...(snapshot.sportsScheduler.missedRuns.length > 0
      ? [{
          code: 'sports_scheduler_missed_run',
          severity: 'critical',
          count: snapshot.sportsScheduler.missedRuns.length,
          editions: snapshot.sportsScheduler.missedRuns,
        }]
      : []),

    ...(snapshot.sportsScheduler.status === 'degraded'
      ? [{
          code: 'sports_scheduler_last_run_failed',
          severity: 'warning',
          message: snapshot.sportsScheduler.lastError ?? null,
        }]
      : []),

    ...(snapshot.queues.status === 'unknown'
      ? [{
          code: 'background_queue_health_unknown',
          severity: 'critical',
        }]
      : []),

  ];
}

@Injectable()
export class SystemHealthService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly browserRuntime: BrowserRuntimeBridgeService,
  ) {}


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
      return await this.assetsService.health();
    } catch (error) {
      return {
        status: 'critical',
        provider: 'supabase',
        bucket: null,
        configured: null,
        message:
          error instanceof Error
            ? error.message
            : 'asset storage health check failed',
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


  private async checkSportsScheduler() {
    try {
      const settings = await this.prisma.sportsNewsSetting.findFirst({
        orderBy: {
          updatedAt: 'desc',
        },
        select: {
          enabled: true,
          timezone: true,
          morningEnabled: true,
          morningTime: true,
          eveningEnabled: true,
          eveningTime: true,
          lastMorningRunAt: true,
          lastEveningRunAt: true,
          lastRunStatus: true,
          lastError: true,
        },
      });

      return buildSportsSchedulerHealth(settings);
    } catch {
      return buildSportsSchedulerHealth(null);
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

    const [
      database,
      browserWorker,
      assets,
      calendar,
      publishing,
      sportsScheduler,
      queues,
    ] = await Promise.all([
      this.checkDatabase(),
      this.checkBrowserWorker(),
      this.checkAssets(),
      this.checkCalendar(),
      this.checkPublishingPipeline(),
      this.checkSportsScheduler(),
      this.checkQueues(),
    ]);

    const issues = buildSystemHealthIssues({
      database,
      browserWorker,
      assets,
      calendar,
      publishing,
      sportsScheduler,
      queues,
    });

    return {
      checkedAt: new Date().toISOString(),

      api,

      database,

      railway: {
        status: "external",
        note:
          "Railway status checked through deployment monitor",
      },

      deploymentAutomation: buildDeploymentAutomationHealth(),

      browserWorker,

      assets,

      calendar,

      publishing,

      sportsScheduler,

      queues,

      issues,
    };
  }


}
