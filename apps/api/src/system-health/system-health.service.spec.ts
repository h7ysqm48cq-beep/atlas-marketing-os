jest.mock('../automation/browser-runtime-bridge.service', () => ({
  BrowserRuntimeBridgeService: class {},
}));
jest.mock('../assets/assets.service', () => ({ AssetsService: class {} }));

import { SystemHealthService } from './system-health.service';

describe('SystemHealthService', () => {
  it('reports calendar health from the scheduled-post table', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ count: 1n }]),
      scheduledPost: { count: jest.fn().mockResolvedValue(3) },
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
});
