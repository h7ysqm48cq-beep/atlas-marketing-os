jest.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: jest.fn(),
}));

jest.mock('socks-proxy-agent', () => ({
  SocksProxyAgent: jest.fn(),
}));

import { RuntimeProfileService } from './runtime-profile.service';

describe('RuntimeProfileService workspace isolation', () => {
  function createService(userId: string | null = 'user-a') {
    const prisma = {
      socialChannel: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      socialChannelRuntimeProfile: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const crypto = {
      encrypt: jest.fn((value: string) => value),
      decrypt: jest.fn((value: string) => value),
    };
    const authContext = {
      getUserId: jest.fn(() => userId),
    };
    const workspaceScope = {
      getCurrentWorkspaceId: jest.fn().mockResolvedValue('workspace-a'),
    };

    const service = new RuntimeProfileService(
      prisma as never,
      crypto as never,
      authContext as never,
      workspaceScope as never,
    );

    return { prisma, authContext, workspaceScope, service };
  }

  it('fails closed when an authenticated request addresses a foreign channel', async () => {
    const { prisma, service } = createService();
    prisma.socialChannel.findFirst.mockResolvedValue(null);

    await expect(service.getForChannel('channel-b')).rejects.toThrow(
      'Social channel not found.',
    );

    expect(prisma.socialChannel.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'channel-b',
        workspaceId: 'workspace-a',
      },
      select: expect.objectContaining({
        id: true,
        name: true,
        platform: true,
      }),
    });
    expect(
      prisma.socialChannelRuntimeProfile.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('limits runtime-profile backfill to the authenticated workspace', async () => {
    const { prisma, service } = createService();

    await expect(service.backfillMissingProfiles()).resolves.toEqual({
      createdCount: 0,
      created: [],
    });

    expect(prisma.socialChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'workspace-a',
          socialChannelRuntimeProfile: null,
        },
      }),
    );
  });

  it('preserves no-user trusted internal channel resolution semantics', async () => {
    const { prisma, service, workspaceScope } = createService(null);
    prisma.socialChannel.findUnique.mockResolvedValue({
      id: 'channel-b',
      name: 'Internal channel',
      platform: 'FACEBOOK',
      externalId: null,
      username: null,
    });
    prisma.socialChannelRuntimeProfile.findUnique.mockResolvedValue(null);

    await expect(service.getForChannel('channel-b')).resolves.toMatchObject({
      exists: false,
      channel: {
        id: 'channel-b',
      },
    });

    expect(workspaceScope.getCurrentWorkspaceId).not.toHaveBeenCalled();
    expect(prisma.socialChannel.findFirst).not.toHaveBeenCalled();
    expect(prisma.socialChannel.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'channel-b' },
      }),
    );
  });
});
