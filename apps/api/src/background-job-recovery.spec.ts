import { AiBackgroundJobService } from './ai/ai-background-job.service';
import { CopilotBackgroundJobService } from './copilot/copilot-background-job.service';

describe('background job recovery during rolling deploys', () => {
  const staleBefore = new Date('2026-08-29T11:30:00.000Z');

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-08-29T12:00:00.000Z').getTime(),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['AI', (prisma: object) => new AiBackgroundJobService(prisma as never, {} as never)],
    [
      'Copilot',
      (prisma: object) =>
        new CopilotBackgroundJobService(
          prisma as never,
          {} as never,
          {} as never,
          {} as never,
        ),
    ],
  ])('only requeues stale %s jobs on startup', async (_name, createService) => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      backgroundJob: {
        updateMany,
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    await createService(prisma).onApplicationBootstrap();

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'RUNNING',
          OR: [
            { startedAt: null },
            { startedAt: { lt: staleBefore } },
          ],
        }),
      }),
    );
  });
});
