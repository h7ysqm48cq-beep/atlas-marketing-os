import {
  BackgroundJobStatus,
  BackgroundJobType,
} from '../generated/prisma/enums';
import { AssetImageBackgroundJobService } from './asset-image-background-job.service';

describe('AssetImageBackgroundJobService', () => {
  const findMany = jest.fn();

  const service = new AssetImageBackgroundJobService(
    {
      backgroundJob: {
        findMany,
      },
    } as never,
    {} as never,
  );

  beforeEach(() => {
    findMany.mockReset();
  });

  it('does not expose jobs without a conversation id', async () => {
    await expect(service.getRecoverableJobs('')).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes active and recent terminal jobs to one conversation', async () => {
    const createdAt = new Date('2026-08-17T00:00:00.000Z');

    findMany.mockResolvedValue([
      {
        id: 'job-1',
        type: BackgroundJobType.ASSET_IMAGE,
        status: BackgroundJobStatus.SUCCEEDED,
        payload: {
          conversationId: 'conversation-1',
          messageIndex: 2,
        },
        result: {
          asset: {
            url: 'https://example.com/image.png',
          },
        },
        error: null,
        attempts: 1,
        startedAt: createdAt,
        completedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    const jobs = await service.getRecoverableJobs(' conversation-1 ');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: BackgroundJobType.ASSET_IMAGE,
          payload: {
            path: ['conversationId'],
            equals: 'conversation-1',
          },
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: {
                in: [BackgroundJobStatus.QUEUED, BackgroundJobStatus.RUNNING],
              },
            }),
            expect.objectContaining({
              status: {
                in: [BackgroundJobStatus.SUCCEEDED, BackgroundJobStatus.FAILED],
              },
            }),
          ]),
        }),
      }),
    );
    expect(jobs).toEqual([
      expect.objectContaining({
        id: 'job-1',
        status: BackgroundJobStatus.SUCCEEDED,
      }),
    ]);
  });
});
