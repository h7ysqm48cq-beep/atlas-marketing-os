import { BackgroundJobStatus, BackgroundJobType } from '../generated/prisma/enums';
import { JobsService } from './jobs.service';

describe('JobsService', () => {
  it('returns grouped background-job counts for queue visibility', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      {
        type: BackgroundJobType.AI_STUDIO,
        status: BackgroundJobStatus.QUEUED,
        _count: { _all: 2 },
      },
      {
        type: BackgroundJobType.ASSET_IMAGE,
        status: BackgroundJobStatus.FAILED,
        _count: { _all: 1 },
      },
    ]);
    const service = new JobsService({ backgroundJob: { groupBy } } as never);

    await expect(service.getStats()).resolves.toEqual({
      total: 3,
      groups: [
        { type: BackgroundJobType.AI_STUDIO, status: BackgroundJobStatus.QUEUED, count: 2 },
        { type: BackgroundJobType.ASSET_IMAGE, status: BackgroundJobStatus.FAILED, count: 1 },
      ],
    });
    expect(groupBy).toHaveBeenCalledWith({
      by: ['type', 'status'],
      _count: { _all: true },
    });
  });
});
