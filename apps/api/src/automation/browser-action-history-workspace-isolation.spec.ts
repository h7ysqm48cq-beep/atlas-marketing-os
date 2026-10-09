import { BrowserActionType } from '../generated/prisma/enums';
import { BrowserActionHistoryService } from './browser-action-history.service';

describe('BrowserActionHistoryService workspace isolation', () => {
  function createService(userId: string | null = 'user-a') {
    const prisma = {
      socialChannel: {
        findFirst: jest.fn(),
      },
      browserActionHistory: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };
    const authContext = {
      getUserId: jest.fn(() => userId),
    };
    const workspaceScope = {
      getCurrentWorkspaceId: jest.fn().mockResolvedValue('workspace-a'),
    };

    const service = new BrowserActionHistoryService(
      prisma as never,
      authContext as never,
      workspaceScope as never,
    );

    return { prisma, workspaceScope, service };
  }

  it('blocks creation for a foreign-workspace channel', async () => {
    const { prisma, service } = createService();
    prisma.socialChannel.findFirst.mockResolvedValue(null);

    await expect(
      service.start({
        channelId: 'channel-b',
        action: BrowserActionType.PREPARE,
      }),
    ).rejects.toThrow('Social channel not found.');

    expect(prisma.browserActionHistory.create).not.toHaveBeenCalled();
  });

  it('fails closed when an authenticated request reads a foreign action', async () => {
    const { prisma, service } = createService();
    prisma.browserActionHistory.findFirst.mockResolvedValue(null);

    await expect(service.getRequired('action-b')).rejects.toThrow(
      'Browser Agent action was not found.',
    );

    expect(prisma.browserActionHistory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'action-b',
          channel: {
            workspaceId: 'workspace-a',
          },
        },
      }),
    );
  });

  it('filters recent action history by current workspace before channel id', async () => {
    const { prisma, service } = createService();

    await service.listRecent({
      channelId: 'channel-a',
      limit: 25,
    });

    expect(prisma.browserActionHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channel: {
            workspaceId: 'workspace-a',
          },
          channelId: 'channel-a',
        },
        take: 25,
      }),
    );
  });

  it('preserves no-user trusted internal start semantics', async () => {
    const { prisma, service, workspaceScope } = createService(null);
    prisma.browserActionHistory.create.mockResolvedValue({
      id: 'action-internal',
    });

    await expect(
      service.start({
        channelId: 'channel-b',
        action: BrowserActionType.PREPARE,
      }),
    ).resolves.toEqual({
      id: 'action-internal',
    });

    expect(workspaceScope.getCurrentWorkspaceId).not.toHaveBeenCalled();
    expect(prisma.socialChannel.findFirst).not.toHaveBeenCalled();
    expect(prisma.browserActionHistory.create).toHaveBeenCalled();
  });
});
