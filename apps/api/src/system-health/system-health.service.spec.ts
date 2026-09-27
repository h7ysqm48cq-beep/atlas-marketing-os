jest.mock('../automation/browser-runtime-bridge.service', () => ({
  BrowserRuntimeBridgeService: class {},
}));
jest.mock('../assets/assets.service', () => ({ AssetsService: class {} }));

import {
  buildSportsSchedulerHealth,
  buildSystemHealthIssues,
  SystemHealthService,
} from './system-health.service';

describe('SystemHealthService', () => {
  it('reports calendar health from the scheduled-post table', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ count: 1n }]),
      scheduledPost: {
        count: jest
          .fn()
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(2),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            publishedAt: new Date('2026-09-27T20:00:00.000Z'),
          })
          .mockResolvedValueOnce({
            scheduledAt: new Date('2026-09-28T01:00:00.000Z'),
          }),
      },
      backgroundJob: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'QUEUED', _count: { _all: 2 } },
          { status: 'RUNNING', _count: { _all: 1 } },
          { status: 'SUCCEEDED', _count: { _all: 4 } },
          { status: 'FAILED', _count: { _all: 3 } },
        ]),
      },
    };
    const service = new SystemHealthService(
      prisma as never,
      {} as never,
      {
        health: jest.fn().mockResolvedValue({
          healthy: true,
          service: 'test-browser-worker',
        }),
      } as never,
    );

    const health = await service.getSystemHealth();

    expect(health.calendar).toEqual({ status: 'healthy', scheduledPosts: 3 });
    expect(health.publishing).toEqual({
      status: 'healthy',
      overdueEligiblePosts: 0,
      stuckPublishingPosts: 0,
      recentFailedPosts: 0,
      publishedLast24h: 2,
      latestPublishedAt: '2026-09-27T20:00:00.000Z',
      nextScheduledAt: '2026-09-28T01:00:00.000Z',
      thresholds: {
        stuckMinutes: 15,
        failureWindowHours: 24,
      },
    });
    expect(health.issues).toEqual([]);
    expect(health.queues).toEqual({
      status: 'healthy',
      backgroundJobs: {
        queued: 2,
        running: 1,
        succeeded: 4,
        failed: 3,
        cancelled: 0,
        total: 10,
      },
    });
  });

  it('marks publishing health critical for overdue or stuck posts', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ count: 1n }]),
      scheduledPost: {
        count: jest
          .fn()
          .mockResolvedValueOnce(10)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(4),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            publishedAt: new Date('2026-09-27T19:00:00.000Z'),
          })
          .mockResolvedValueOnce({
            scheduledAt: new Date('2026-09-28T01:00:00.000Z'),
          }),
      },
      backgroundJob: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new SystemHealthService(
      prisma as never,
      {} as never,
      {
        health: jest.fn().mockResolvedValue({
          healthy: true,
          service: 'test-browser-worker',
        }),
      } as never,
    );

    const health = await service.getSystemHealth();

    expect(health.publishing.status).toBe('critical');
    expect(health.publishing.overdueEligiblePosts).toBe(2);
    expect(health.publishing.stuckPublishingPosts).toBe(1);
    expect(health.issues).toEqual([
      {
        code: 'publishing_overdue',
        severity: 'critical',
        count: 2,
      },
      {
        code: 'publishing_stuck',
        severity: 'critical',
        count: 1,
      },
    ]);
  });

  it('marks publishing health degraded for recent failures without stuck work', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ count: 1n }]),
      scheduledPost: {
        count: jest
          .fn()
          .mockResolvedValueOnce(10)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(1),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            publishedAt: new Date('2026-09-27T18:00:00.000Z'),
          })
          .mockResolvedValueOnce(null),
      },
      backgroundJob: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new SystemHealthService(
      prisma as never,
      {} as never,
      {
        health: jest.fn().mockResolvedValue({
          healthy: true,
          service: 'test-browser-worker',
        }),
      } as never,
    );

    const health = await service.getSystemHealth();

    expect(health.publishing.status).toBe('degraded');
    expect(health.publishing.recentFailedPosts).toBe(3);
    expect(health.publishing.publishedLast24h).toBe(1);
    expect(health.publishing.latestPublishedAt).toBe(
      '2026-09-27T18:00:00.000Z',
    );
    expect(health.publishing.nextScheduledAt).toBeNull();
    expect(health.issues).toEqual([
      {
        code: 'publishing_recent_failures',
        severity: 'warning',
        count: 3,
      },
    ]);
  });
});


describe('buildSportsSchedulerHealth', () => {
  const settings = {
    enabled: true,
    timezone: 'Asia/Kuala_Lumpur',
    morningEnabled: true,
    morningTime: '09:00',
    eveningEnabled: true,
    eveningTime: '20:00',
    lastMorningRunAt: new Date('2026-09-28T01:02:00.000Z'),
    lastEveningRunAt: new Date('2026-09-27T12:02:00.000Z'),
    lastRunStatus: 'SUCCESS',
    lastError: null,
  };

  it('reports healthy and the next local run before the morning slot', () => {
    const health = buildSportsSchedulerHealth(
      {
        ...settings,
        lastMorningRunAt: new Date('2026-09-27T01:02:00.000Z'),
      },
      new Date('2026-09-27T21:53:00.000Z'),
    );

    expect(health.status).toBe('healthy');
    expect(health.missedRuns).toEqual([]);
    expect(health.nextRunLocal).toBe(
      '2026-09-28 09:00 Asia/Kuala_Lumpur MORNING',
    );
  });

  it('fails closed when an enabled morning run is still missing after grace', () => {
    const health = buildSportsSchedulerHealth(
      {
        ...settings,
        lastMorningRunAt: new Date('2026-09-27T01:02:00.000Z'),
      },
      new Date('2026-09-28T01:20:00.000Z'),
    );

    expect(health.status).toBe('critical');
    expect(health.missedRuns).toEqual(['MORNING']);
    expect(health.nextRunLocal).toBe(
      '2026-09-28 20:00 Asia/Kuala_Lumpur EVENING',
    );
  });

  it('does not treat disabled sports automation as a failure', () => {
    const health = buildSportsSchedulerHealth(
      {
        ...settings,
        enabled: false,
      },
      new Date('2026-09-28T04:00:00.000Z'),
    );

    expect(health.status).toBe('disabled');
    expect(health.missedRuns).toEqual([]);
    expect(health.nextRunLocal).toBeNull();
  });
});


describe('buildSystemHealthIssues', () => {
  const healthy = {
    database: { status: 'healthy' },
    browserWorker: { healthy: true },
    assets: { status: 'healthy' },
    calendar: { status: 'healthy' },
    publishing: {
      status: 'healthy',
      overdueEligiblePosts: 0,
      stuckPublishingPosts: 0,
      recentFailedPosts: 0,
    },
    sportsScheduler: {
      status: 'healthy',
      missedRuns: [],
      lastError: null,
    },
    queues: {
      status: 'healthy',
      backgroundJobs: {
        failed: 4,
      },
    },
  };

  it('returns no issues for healthy core subsystems', () => {
    expect(buildSystemHealthIssues(healthy)).toEqual([]);
  });

  it('promotes database, browser, calendar, and queue availability failures to critical issues', () => {
    expect(
      buildSystemHealthIssues({
        ...healthy,
        database: {
          status: 'critical',
          message: 'db unavailable',
        },
        browserWorker: {
          status: 'unknown',
          message: 'browser worker unavailable',
        },
        calendar: {
          status: 'critical',
        },
        queues: {
          status: 'unknown',
          backgroundJobs: null,
        },
      }),
    ).toEqual([
      {
        code: 'database_unhealthy',
        severity: 'critical',
        message: 'db unavailable',
      },
      {
        code: 'browser_worker_unhealthy',
        severity: 'critical',
        message: 'browser worker unavailable',
      },
      {
        code: 'calendar_unhealthy',
        severity: 'critical',
      },
      {
        code: 'background_queue_health_unknown',
        severity: 'critical',
      },
    ]);
  });

  it('preserves publishing and sports scheduler issue semantics', () => {
    expect(
      buildSystemHealthIssues({
        ...healthy,
        publishing: {
          status: 'critical',
          overdueEligiblePosts: 2,
          stuckPublishingPosts: 1,
          recentFailedPosts: 3,
        },
        sportsScheduler: {
          status: 'degraded',
          missedRuns: ['MORNING'],
          lastError: 'generation failed',
        },
      }),
    ).toEqual([
      {
        code: 'publishing_overdue',
        severity: 'critical',
        count: 2,
      },
      {
        code: 'publishing_stuck',
        severity: 'critical',
        count: 1,
      },
      {
        code: 'publishing_recent_failures',
        severity: 'warning',
        count: 3,
      },
      {
        code: 'sports_scheduler_missed_run',
        severity: 'critical',
        count: 1,
        editions: ['MORNING'],
      },
      {
        code: 'sports_scheduler_last_run_failed',
        severity: 'warning',
        message: 'generation failed',
      },
    ]);
  });
});
