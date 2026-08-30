import {
  ScheduledPostStatus,
  SocialChannelStatus,
  SocialPlatform,
} from '../generated/prisma/enums';

jest.mock('./publisher.service', () => ({
  PublisherService: class PublisherService {},
}));

jest.mock('./runtime-profile.service', () => ({
  RuntimeProfileService: class RuntimeProfileService {},
}));

import { AutomationService } from './automation.service';

describe('AutomationService Facebook API disconnect', () => {
  const createService = () => {
    const prisma = {
      socialChannel: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'created-channel',
            accessTokenEncrypted: null,
            ...data,
          }),
        ),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'channel-1',
            platform: SocialPlatform.FACEBOOK,
            name: 'Facebook Page',
            status: data.status,
            accessTokenEncrypted: null,
            publishingPreference: data.publishingPreference,
          }),
        ),
      },
      scheduledPost: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      publishAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      brand: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'brand-1',
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          workspaceId: 'workspace-1',
        }),
      },
      $transaction: jest.fn(
        async (callback: (input: unknown) => Promise<unknown>) =>
          callback(prisma),
      ),
    };

    const socialTokenCrypto = {
      encrypt: jest.fn().mockReturnValue('encrypted-token'),
    };
    const service = new AutomationService(
      prisma as never,
      {} as never,
      socialTokenCrypto as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return {
      prisma,
      service,
    };
  };

  it('clears one API token while preserving a linked Browser channel', async () => {
    const { prisma, service } = createService();

    prisma.socialChannel.findUnique.mockResolvedValue({
      id: 'channel-1',
      platform: SocialPlatform.FACEBOOK,
      browserAccountLinks: [
        {
          browserAccountId: 'browser-account-1',
          isPrimary: true,
          browserAccount: {
            id: 'browser-account-1',
            displayName: 'Cloud Browser',
            browserProfileKey: 'profile-1',
            browserProfileName: 'Cloud Browser',
            loginStatus: 'LOGGED_IN',
            cookieStatus: 'ACTIVE',
            proxyType: 'DIRECT',
            proxyCountry: null,
            lastKnownIp: null,
            lastLoginAt: null,
            lastVerifiedAt: null,
            lastHeartbeatAt: new Date(),
            lastLoginError: null,
          },
        },
      ],
    });

    const result = await (service as unknown as {
      disconnectChannelApi: (id: string) => Promise<{
        publishingMode: string;
      }>;
    }).disconnectChannelApi('channel-1');

    expect(prisma.socialChannel.update).toHaveBeenCalledWith({
      where: {
        id: 'channel-1',
      },
      data: {
        accessTokenEncrypted: null,
        tokenExpiresAt: null,
        publishingPreference: 'BROWSER_RUNTIME',
        status: SocialChannelStatus.CONNECTED,
        lastError: null,
      },
    });
    expect(result.publishingMode).toBe('BROWSER_RUNTIME');
  });

  it('disconnects an API-only channel after its token is cleared', async () => {
    const { prisma, service } = createService();

    prisma.socialChannel.findUnique.mockResolvedValue({
      id: 'channel-1',
      platform: SocialPlatform.FACEBOOK,
      browserAccountLinks: [],
    });

    await (service as unknown as {
      disconnectChannelApi: (id: string) => Promise<unknown>;
    }).disconnectChannelApi('channel-1');

    expect(prisma.socialChannel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SocialChannelStatus.DISCONNECTED,
        }),
      }),
    );
  });

  it('clears every Facebook API token without disconnecting Browser-linked channels', async () => {
    const { prisma, service } = createService();

    prisma.socialChannel.findMany.mockResolvedValue([
      {
        id: 'browser-channel',
        browserAccountLinks: [
          {
            browserAccountId: 'browser-account-1',
          },
        ],
      },
      {
        id: 'api-only-channel',
        browserAccountLinks: [],
      },
    ]);

    await (service as unknown as {
      disconnectAllFacebookApi: (confirmation: string) => Promise<unknown>;
    }).disconnectAllFacebookApi('DISCONNECT_ALL_FACEBOOK_API');

    expect(prisma.socialChannel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'browser-channel',
        },
        data: expect.objectContaining({
          status: SocialChannelStatus.CONNECTED,
          publishingPreference: 'BROWSER_RUNTIME',
        }),
      }),
    );
    expect(prisma.socialChannel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'api-only-channel',
        },
        data: expect.objectContaining({
          status: SocialChannelStatus.DISCONNECTED,
        }),
      }),
    );
  });

  it('requires explicit confirmation before clearing every Facebook API token', async () => {
    const { prisma, service } = createService();

    await expect(
      (service as unknown as {
        disconnectAllFacebookApi: (confirmation: string) => Promise<unknown>;
      }).disconnectAllFacebookApi('DISCONNECT'),
    ).rejects.toThrow('Explicit confirmation');

    expect(prisma.socialChannel.findMany).not.toHaveBeenCalled();
  });
});

describe('AutomationService hidden channels', () => {
  it('excludes hidden channels from the dashboard query', async () => {
    const prisma = {
      socialChannel: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      scheduledPost: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      publishAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new AutomationService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.dashboard();

    expect(prisma.socialChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          hiddenAt: null,
        },
      }),
    );
  });
});

describe('AutomationService Facebook channel defaults', () => {
  it('creates a Facebook channel in Browser Runtime mode even when an API token is supplied', async () => {
    const prisma = {
      brand: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'brand-1',
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          workspaceId: 'workspace-1',
        }),
      },
      socialChannel: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'channel-1',
            ...data,
          }),
        ),
      },
    };
    const service = new AutomationService(
      prisma as never,
      {} as never,
      {
        encrypt: jest.fn().mockReturnValue('encrypted-token'),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.createChannel({
      brandId: 'brand-1',
      platform: SocialPlatform.FACEBOOK,
      name: 'Facebook Page',
      externalId: 'page-1',
      accessToken: 'page-token',
    });

    expect(prisma.socialChannel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        publishingPreference: 'BROWSER_RUNTIME',
      }),
    });
  });
});

describe('AutomationService calendar visibility', () => {
  it('excludes posts belonging to hidden channels and returns publish diagnostics', async () => {
    const prisma = {
      scheduledPost: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new AutomationService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.listCalendarPosts();

    expect(prisma.scheduledPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channel: {
            hiddenAt: null,
          },
        },
        select: expect.objectContaining({
          historyId: true,
          publishedAt: true,
          lastError: true,
        }),
      }),
    );
  });
});

describe('AutomationService Instagram scheduling validation', () => {
  it('rejects scheduling an Instagram post without an image asset', async () => {
    const prisma = {
      socialChannel: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'channel-1',
          brandId: 'brand-1',
          platform: SocialPlatform.INSTAGRAM,
        }),
      },
      scheduledPost: {
        create: jest.fn(),
      },
    };
    const service = new AutomationService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createPost({
        brandId: 'brand-1',
        channelId: 'channel-1',
        platform: SocialPlatform.INSTAGRAM,
        content: 'Test',
        mediaUrls: [],
        scheduledAt: '2026-08-27T12:16:00.000Z',
        status: ScheduledPostStatus.SCHEDULED,
      }),
    ).rejects.toThrow(
      'Instagram posts require at least one image asset before scheduling.',
    );
    expect(prisma.scheduledPost.create).not.toHaveBeenCalled();
  });

  it('rejects queueing an Instagram post without an image asset', async () => {
    const prisma = {
      scheduledPost: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'post-1',
          platform: SocialPlatform.INSTAGRAM,
          status: ScheduledPostStatus.FAILED,
          mediaUrls: [],
        }),
        update: jest.fn(),
      },
    };
    const service = new AutomationService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.queuePost('post-1')).rejects.toThrow(
      'Instagram posts require at least one image asset before queueing.',
    );
    expect(prisma.scheduledPost.update).not.toHaveBeenCalled();
  });
});


describe(
  'AutomationService dashboard Browser Account identity',
  () => {
    it(
      'selects Facebook personal profile name for Connected Platforms',
      async () => {
        const prisma = {
          socialChannel: {
            findMany:
              jest.fn().mockResolvedValue([]),
          },
          scheduledPost: {
            groupBy:
              jest.fn().mockResolvedValue([]),
            findMany:
              jest.fn().mockResolvedValue([]),
          },
          publishAttempt: {
            findMany:
              jest.fn().mockResolvedValue([]),
          },
        };

        const service =
          new AutomationService(
            prisma as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
          );

        await service.dashboard();

        expect(
          prisma.socialChannel.findMany,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            include:
              expect.objectContaining({
                browserAccountLinks:
                  expect.objectContaining({
                    include:
                      expect.objectContaining({
                        browserAccount:
                          expect.objectContaining({
                            select:
                              expect.objectContaining({
                                facebookUserName:
                                  true,
                              }),
                          }),
                      }),
                  }),
              }),
          }),
        );
      },
    );
  },
);
