jest.mock('../automation/browser-runtime-bridge.service', () => ({
  BrowserRuntimeBridgeService: class {},
}));
jest.mock('../assets/assets.service', () => ({ AssetsService: class {} }));

import { SystemHealthService } from './system-health.service';

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
          .mockResolvedValueOnce(0),
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
    const service = new SystemHealthService(prisma as never, {} as never, {} as never);

    const health = await service.getSystemHealth();

    expect(health.calendar).toEqual({ status: 'healthy', scheduledPosts: 3 });
    expect(health.publishing).toEqual({
      status: 'healthy',
      overdueEligiblePosts: 0,
      stuckPublishingPosts: 0,
      recentFailedPosts: 0,
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
          .mockResolvedValueOnce(0),
      },
      backgroundJob: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new SystemHealthService(prisma as never, {} as never, {} as never);

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
          .mockResolvedValueOnce(3),
      },
      backgroundJob: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new SystemHealthService(prisma as never, {} as never, {} as never);

    const health = await service.getSystemHealth();

    expect(health.publishing.status).toBe('degraded');
    expect(health.publishing.recentFailedPosts).toBe(3);
    expect(health.issues).toEqual([
      {
        code: 'publishing_recent_failures',
        severity: 'warning',
        count: 3,
      },
    ]);
  });
});
