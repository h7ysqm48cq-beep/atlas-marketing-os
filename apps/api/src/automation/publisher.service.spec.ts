import {
  resolvePublisherRetryDecision,
  resolveSportsNewsRetryDecision,
} from './publisher-retry-policy';
import { PublishAttemptStatus, ScheduledPostStatus, SocialPlatform } from '../generated/prisma/enums';
import { PublisherService } from './publisher.service';

jest.mock('./runtime-profile.service', () => ({
  RuntimeProfileService: class RuntimeProfileService {},
}));

describe('resolveSportsNewsRetryDecision', () => {
  const failedAt = new Date('2026-08-17T00:00:00.000Z');

  it('schedules an enabled retry after the configured delay', () => {
    expect(
      resolveSportsNewsRetryDecision({
        policy: {
          publishRetryEnabled: true,
          publishRetryLimit: 3,
          publishRetryDelayMinutes: 10,
        },
        failedAttemptCount: 1,
        failedAt,
      }),
    ).toEqual({
      shouldRetry: true,
      scheduledAt: new Date('2026-08-17T00:10:00.000Z'),
    });
  });

  it('stops after the configured retry limit', () => {
    expect(
      resolveSportsNewsRetryDecision({
        policy: {
          publishRetryEnabled: true,
          publishRetryLimit: 3,
          publishRetryDelayMinutes: 10,
        },
        failedAttemptCount: 4,
        failedAt,
      }),
    ).toEqual({
      shouldRetry: false,
      scheduledAt: null,
    });
  });

  it('does not retry posts without Sports News retry metadata', () => {
    expect(
      resolveSportsNewsRetryDecision({
        policy: null,
        failedAttemptCount: 1,
        failedAt,
      }),
    ).toEqual({
      shouldRetry: false,
      scheduledAt: null,
    });
  });
});

describe('resolvePublisherRetryDecision', () => {
  const policy = {
    publishRetryEnabled: true,
    publishRetryLimit: 3,
    publishRetryDelayMinutes: 10,
  };
  const failedAt =
    new Date('2026-08-25T00:00:00.000Z');

  it('keeps a Browser Runtime failure FAILED without automatic retry', () => {
    expect(
      resolvePublisherRetryDecision({
        policy,
        failedAttemptCount: 1,
        failedAt,
        usedBrowserRuntime: true,
      }),
    ).toEqual({
      shouldRetry: false,
      scheduledAt: null,
    });
  });

  it('automatically retries an unconfirmed Browser Runtime publish', () => {
    expect(
      resolvePublisherRetryDecision({
        policy,
        failedAttemptCount: 1,
        failedAt,
        usedBrowserRuntime: true,
        failureKind: 'UNCONFIRMED',
      }),
    ).toEqual({
      shouldRetry: true,
      scheduledAt:
        new Date('2026-08-25T00:10:00.000Z'),
    });
  });

  it('preserves the configured retry for Native API and other publishers', () => {
    expect(
      resolvePublisherRetryDecision({
        policy,
        failedAttemptCount: 1,
        failedAt,
        usedBrowserRuntime: false,
      }),
    ).toEqual({
      shouldRetry: true,
      scheduledAt:
        new Date('2026-08-25T00:10:00.000Z'),
    });
  });
});

describe('PublisherService Facebook Cloud Browser preflight', () => {
  const createPost = (
    publishingPreference: string,
  ) => ({
    id: 'post-1',
    platform:
      SocialPlatform.FACEBOOK,
    status:
      ScheduledPostStatus.QUEUED,
    channelId: 'channel-1',
    content: 'Test post',
    mediaUrls: [],
    scheduledAt:
      new Date('2026-08-25T00:00:00.000Z'),
    timezone:
      'Asia/Kuala_Lumpur',
    retryCount: 0,
    historyId: null,
    brandRenderingSettings: null,
    channel: {
      id: 'channel-1',
      name: 'Cloud Browser Page',
      publishingPreference,
      accessTokenEncrypted:
        publishingPreference ===
        'NATIVE_API'
          ? 'encrypted-token'
          : null,
      externalId: 'page-1',
      tokenExpiresAt: null,
      socialChannelRuntimeProfile: null,
    },
  });

  const createService = (
    publishingPreference =
      'BROWSER_RUNTIME',
  ) => {
    const prisma = {
      scheduledPost: {
        findMany:
          jest.fn().mockResolvedValue([
            createPost(
              publishingPreference,
            ),
          ]),
        updateMany:
          jest.fn().mockResolvedValue({
            count: 1,
          }),
        update:
          jest.fn().mockResolvedValue({}),
      },
      publishAttempt: {
        create:
          jest.fn().mockResolvedValue({
            id: 'attempt-1',
          }),
        update:
          jest.fn().mockResolvedValue({}),
      },
    };
    const runtimeProfiles = {
      getBrowserPublishingSafety:
        jest.fn().mockResolvedValue({
          hasLinkedAccounts: true,
          allowed: true,
          selected: {
            id: 'browser-account-1',
            displayName: 'Cloud Browser',
            browserProfileKey:
              'profile-1',
            browserProfileName:
              'Cloud Browser',
            proxyCountry: null,
            lastKnownIp: null,
          },
          candidates: [],
          reason: 'READY',
        }),
      getPublishNetwork:
        jest.fn().mockResolvedValue({
          browserAccountId: null,
          browserProfileKey: null,
          locale: null,
          timezone:
            'Asia/Kuala_Lumpur',
          proxyType: 'DIRECT',
          proxyUrl: null,
        }),
    };
    const browserRuntime = {
      preflightFacebookLoginForChannel:
        jest.fn().mockResolvedValue({
          ready: false,
          loginRequired: true,
          message:
            'Facebook login is required in the linked Cloud Browser.',
          browserAccountId:
            'browser-account-1',
          browserProfileKey:
            'profile-1',
        }),
      prepareFacebookPostForChannel:
        jest.fn().mockResolvedValue({
          success: true,
          readyForReview: true,
          captionFilled: true,
          imageAttached: false,
          attachedMediaCount: 0,
        }),
      publishFacebookPost:
        jest.fn().mockResolvedValue({
          success: true,
          published: true,
          verification: {
            status: 'CONFIRMED',
          },
        }),
    };
    const facebook = {
      publish:
        jest.fn().mockResolvedValue({
          id: 'external-post-1',
        }),
    };
    const service =
      new PublisherService(
        prisma as never,
        facebook as never,
        {} as never,
        {
          decrypt:
            jest.fn().mockReturnValue(
              'access-token',
            ),
        } as never,
        runtimeProfiles as never,
        browserRuntime as never,
      );

    return {
      browserRuntime,
      facebook,
      prisma,
      runtimeProfiles,
      service,
    };
  };

  it('keeps a Browser Runtime post queued when live Facebook login is required', async () => {
    const {
      browserRuntime,
      prisma,
      runtimeProfiles,
      service,
    } = createService();

    await expect(
      service.run(),
    ).resolves.toMatchObject({
      found: 1,
      published: 0,
      blocked: 1,
    });

    expect(
      prisma.scheduledPost.updateMany,
    ).toHaveBeenCalledTimes(1);
    expect(
      prisma.scheduledPost.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          lastError:
            expect.stringContaining(
              'Post remains queued',
            ),
        },
      }),
    );
    expect(
      prisma.publishAttempt.create,
    ).not.toHaveBeenCalled();
    expect(
      browserRuntime.preflightFacebookLoginForChannel,
    ).toHaveBeenCalledTimes(1);
    expect(
      runtimeProfiles.getPublishNetwork,
    ).not.toHaveBeenCalled();
    expect(
      runtimeProfiles.getBrowserPublishingSafety,
    ).not.toHaveBeenCalled();
  });

  it('excludes hidden channels from scheduled post selection', async () => {
    const {
      prisma,
      service,
    } = createService();

    await service.run();

    expect(
      prisma.scheduledPost.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: {
            hiddenAt: null,
          },
        }),
      }),
    );
  });

  it('treats legacy AUTOMATIC as Browser-only even when an API token exists', async () => {
    const {
      browserRuntime,
      facebook,
      prisma,
      service,
    } = createService(
      'AUTOMATIC',
    );

    prisma.scheduledPost.findMany.mockResolvedValue([
      {
        ...createPost(
          'AUTOMATIC',
        ),
        channel: {
          ...createPost(
            'AUTOMATIC',
          ).channel,
          accessTokenEncrypted:
            'encrypted-token',
        },
      },
    ]);

    await expect(
      service.run(),
    ).resolves.toMatchObject({
      found: 1,
      published: 0,
      blocked: 1,
    });

    expect(
      browserRuntime.preflightFacebookLoginForChannel,
    ).toHaveBeenCalledWith(
      'channel-1',
    );
    expect(
      facebook.publish,
    ).not.toHaveBeenCalled();
  });

  it('does not run the VNC preflight for a Native API channel', async () => {
    const {
      browserRuntime,
      facebook,
      prisma,
      service,
    } = createService(
      'NATIVE_API',
    );

    await service.run();

    expect(
      browserRuntime.preflightFacebookLoginForChannel,
    ).not.toHaveBeenCalled();
    expect(
      prisma.scheduledPost.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status:
            ScheduledPostStatus.PUBLISHING,
        }),
      }),
    );
    expect(
      facebook.publish,
    ).toHaveBeenCalledTimes(1);
  });

  it('forwards all Facebook Browser Runtime images and requires the full attachment count', async () => {
    const {
      browserRuntime,
      prisma,
      runtimeProfiles,
      service,
    } = createService();

    const mediaUrls = [
      'https://cdn.example.com/one.jpg',
      'https://cdn.example.com/two.jpg',
      'https://cdn.example.com/three.jpg',
      'https://cdn.example.com/four.jpg',
    ];

    prisma.scheduledPost.findMany.mockResolvedValue([
      {
        ...createPost('BROWSER_RUNTIME'),
        mediaUrls,
      },
    ]);
    browserRuntime.preflightFacebookLoginForChannel.mockResolvedValue({
      ready: true,
      loginRequired: false,
      message: 'Ready',
      browserAccountId: 'browser-account-1',
      browserProfileKey: 'profile-1',
    });
    runtimeProfiles.getPublishNetwork.mockResolvedValue({
      browserAccountId: 'browser-account-1',
      browserProfileKey: 'profile-1',
      locale: 'en-MY',
      timezone: 'Asia/Kuala_Lumpur',
      proxyType: 'DIRECT',
      proxyUrl: null,
    });
    browserRuntime.prepareFacebookPostForChannel.mockResolvedValue({
      success: true,
      readyForReview: true,
      captionFilled: true,
      imageAttached: true,
      attachedMediaCount: 4,
    });

    await expect(service.run()).resolves.toMatchObject({
      found: 1,
      published: 1,
    });

    expect(browserRuntime.prepareFacebookPostForChannel).toHaveBeenCalledWith(
      'channel-1',
      {
        caption: 'Test post',
        imagePath: null,
        imageUrl: mediaUrls[0],
        imageUrls: mediaUrls,
      },
    );
  });

  it('fails closed when Facebook Browser Runtime attaches only part of a multi-image post', async () => {
    const {
      browserRuntime,
      prisma,
      runtimeProfiles,
      service,
    } = createService();

    const mediaUrls = [
      'https://cdn.example.com/one.jpg',
      'https://cdn.example.com/two.jpg',
      'https://cdn.example.com/three.jpg',
      'https://cdn.example.com/four.jpg',
    ];

    prisma.scheduledPost.findMany.mockResolvedValue([
      {
        ...createPost('BROWSER_RUNTIME'),
        mediaUrls,
      },
    ]);
    browserRuntime.preflightFacebookLoginForChannel.mockResolvedValue({
      ready: true,
      loginRequired: false,
      message: 'Ready',
      browserAccountId: 'browser-account-1',
      browserProfileKey: 'profile-1',
    });
    runtimeProfiles.getPublishNetwork.mockResolvedValue({
      browserAccountId: 'browser-account-1',
      browserProfileKey: 'profile-1',
      locale: 'en-MY',
      timezone: 'Asia/Kuala_Lumpur',
      proxyType: 'DIRECT',
      proxyUrl: null,
    });
    browserRuntime.prepareFacebookPostForChannel.mockResolvedValue({
      success: true,
      readyForReview: true,
      captionFilled: true,
      imageAttached: true,
      attachedMediaCount: 3,
    });

    await expect(service.run()).resolves.toMatchObject({
      found: 1,
      published: 0,
    });

    expect(prisma.scheduledPost.update).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: expect.objectContaining({
        status: ScheduledPostStatus.FAILED,
        lastError: 'Facebook draft preparation failed: expected 4 image(s) (Facebook Browser Runtime), attached 3.',
      }),
    });
  });

  it('keeps an actual Browser Runtime publishing failure FAILED without rescheduling it', async () => {
    const {
      browserRuntime,
      prisma,
      runtimeProfiles,
      service,
    } = createService();

    prisma.scheduledPost.findMany.mockResolvedValue([
      {
        ...createPost(
          'BROWSER_RUNTIME',
        ),
        brandRenderingSettings: {
          sportsNews: {
            publishRetryEnabled: true,
            publishRetryLimit: 10,
            publishRetryDelayMinutes: 10,
          },
        },
      },
    ]);
    browserRuntime.preflightFacebookLoginForChannel.mockResolvedValue({
      ready: true,
      loginRequired: false,
      message: 'Ready',
      browserAccountId: 'browser-account-1',
      browserProfileKey: 'profile-1',
    });
    runtimeProfiles.getPublishNetwork.mockResolvedValue({
      browserAccountId: 'browser-account-1',
      browserProfileKey: 'profile-1',
      locale: 'en-MY',
      timezone: 'Asia/Kuala_Lumpur',
      proxyType: 'DIRECT',
      proxyUrl: null,
    });
    browserRuntime.prepareFacebookPostForChannel.mockRejectedValue(
      new Error(
        'Facebook image upload could not be verified.',
      ),
    );

    await expect(
      service.run(),
    ).resolves.toMatchObject({
      found: 1,
      published: 0,
    });

    expect(
      prisma.scheduledPost.update,
    ).toHaveBeenCalledWith({
      where: {
        id: 'post-1',
      },
      data: expect.objectContaining({
        status:
          ScheduledPostStatus.FAILED,
        retryCount: 1,
        lastError:
          'Facebook image upload could not be verified.',
      }),
    });

    const failureUpdate =
      prisma.scheduledPost.update.mock.calls.at(-1)?.[0];

    expect(
      failureUpdate?.data,
    ).not.toHaveProperty(
      'scheduledAt',
    );
  });
});

describe('PublisherService Instagram Browser Runtime', () => {
  it('automatically recovers unresolved Instagram external proof in the same publish cycle', async () => {
    const prisma = {
      scheduledPost: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'instagram-post-recovery',
            platform: SocialPlatform.INSTAGRAM,
            status: ScheduledPostStatus.QUEUED,
            channelId: 'instagram-channel-recovery',
            content: 'Consistency is rarely dramatic.',
            mediaUrls: ['https://cdn.example.com/ig.jpg'],
            scheduledAt: new Date('2026-09-26T00:00:00.000Z'),
            timezone: 'Asia/Kuala_Lumpur',
            retryCount: 0,
            historyId: null,
            brandRenderingSettings: null,
            channel: {
              id: 'instagram-channel-recovery',
              name: 'Instagram Browser',
              publishingPreference: 'BROWSER_RUNTIME',
              accessTokenEncrypted: null,
              externalId: null,
              tokenExpiresAt: null,
              socialChannelRuntimeProfile: {
                id: 'runtime-profile-recovery',
                browserProfileKey: 'channel-instagram-channel-recovery',
                browserProfileName: 'Instagram Browser',
                locale: 'en-MY',
                timezone: 'Asia/Kuala_Lumpur',
                proxyType: 'DIRECT',
                proxyHost: null,
                proxyPort: null,
                proxyUsernameEncrypted: null,
                proxyPasswordEncrypted: null,
                proxyCountry: null,
                lastKnownIp: null,
              },
            },
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      publishAttempt: {
        create: jest.fn().mockResolvedValue({ id: 'attempt-instagram-recovery' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const runtimeProfiles = {
      getBrowserPublishingSafety: jest.fn().mockResolvedValue({
        allowed: true,
        selected: { displayName: 'empowermindsmuse' },
      }),
    };
    const browserRuntime = {
      preflightInstagramLoginForChannel: jest.fn().mockResolvedValue({
        ready: true,
        loginRequired: false,
        message: 'Instagram Browser login is ready.',
        browserProfileKey: 'channel-instagram-channel-recovery',
      }),
      prepareInstagramPostForChannel: jest.fn().mockResolvedValue({
        success: true,
        readyForReview: true,
        imageAttached: true,
        attachedMediaCount: 1,
      }),
      publishInstagramPost: jest.fn().mockResolvedValue({
        success: true,
        published: true,
        publishedAt: '2026-09-26T09:04:28.604Z',
        verification: {
          status: 'CONFIRMED',
          externalProof: 'UNRESOLVED',
        },
      }),
      findInstagramPublishedPost: jest.fn().mockResolvedValue({
        found: true,
        reference: {
          externalPostId: 'Ddvq5_XE2iD',
          postUrl: 'https://www.instagram.com/p/Ddvq5_XE2iD/',
          matchedBy: 'caption-profile-post',
        },
      }),
    };
    const service = new PublisherService(
      prisma as never,
      {} as never,
      {} as never,
      { decrypt: jest.fn() } as never,
      runtimeProfiles as never,
      browserRuntime as never,
    );

    await expect(service.run()).resolves.toMatchObject({
      found: 1,
      published: 1,
      blocked: 0,
    });

    expect(browserRuntime.findInstagramPublishedPost).toHaveBeenCalledWith(
      'instagram-channel-recovery',
      'Consistency is rarely dramatic.',
      'empowermindsmuse',
    );
    expect(prisma.publishAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-instagram-recovery' },
      data: expect.objectContaining({
        status: PublishAttemptStatus.SUCCESS,
        responsePayload: expect.objectContaining({
          reconciled: true,
          id: 'Ddvq5_XE2iD',
          externalPostId: 'Ddvq5_XE2iD',
          postUrl: 'https://www.instagram.com/p/Ddvq5_XE2iD/',
          verification: {
            status: 'CONFIRMED',
            externalProof: 'RESOLVED',
          },
        }),
      }),
    });
    expect(prisma.scheduledPost.update).toHaveBeenCalledWith({
      where: { id: 'instagram-post-recovery' },
      data: expect.objectContaining({
        status: ScheduledPostStatus.PUBLISHED,
        externalPostId: 'Ddvq5_XE2iD',
        externalPostUrl: 'https://www.instagram.com/p/Ddvq5_XE2iD/',
      }),
    });
  });

  it('keeps a confirmed Instagram publish successful when automatic proof recovery cannot resolve it', async () => {
    const prisma = {
      scheduledPost: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'instagram-post-unresolved',
            platform: SocialPlatform.INSTAGRAM,
            status: ScheduledPostStatus.QUEUED,
            channelId: 'instagram-channel-unresolved',
            content: 'Unresolved proof post',
            mediaUrls: ['https://cdn.example.com/ig.jpg'],
            scheduledAt: new Date('2026-09-26T00:00:00.000Z'),
            timezone: 'Asia/Kuala_Lumpur',
            retryCount: 0,
            historyId: null,
            brandRenderingSettings: null,
            channel: {
              id: 'instagram-channel-unresolved',
              name: 'Instagram Browser',
              publishingPreference: 'BROWSER_RUNTIME',
              accessTokenEncrypted: null,
              externalId: null,
              tokenExpiresAt: null,
              socialChannelRuntimeProfile: {
                id: 'runtime-profile-unresolved',
                browserProfileKey: 'channel-instagram-channel-unresolved',
                browserProfileName: 'Instagram Browser',
                locale: 'en-MY',
                timezone: 'Asia/Kuala_Lumpur',
                proxyType: 'DIRECT',
                proxyHost: null,
                proxyPort: null,
                proxyUsernameEncrypted: null,
                proxyPasswordEncrypted: null,
                proxyCountry: null,
                lastKnownIp: null,
              },
            },
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      publishAttempt: {
        create: jest.fn().mockResolvedValue({ id: 'attempt-instagram-unresolved' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const runtimeProfiles = {
      getBrowserPublishingSafety: jest.fn().mockResolvedValue({
        allowed: true,
        selected: { displayName: 'empowermindsmuse' },
      }),
    };
    const browserRuntime = {
      preflightInstagramLoginForChannel: jest.fn().mockResolvedValue({
        ready: true,
        loginRequired: false,
        message: 'Instagram Browser login is ready.',
        browserProfileKey: 'channel-instagram-channel-unresolved',
      }),
      prepareInstagramPostForChannel: jest.fn().mockResolvedValue({
        success: true,
        readyForReview: true,
        imageAttached: true,
        attachedMediaCount: 1,
      }),
      publishInstagramPost: jest.fn().mockResolvedValue({
        success: true,
        published: true,
        verification: {
          status: 'CONFIRMED',
          externalProof: 'UNRESOLVED',
        },
      }),
      findInstagramPublishedPost: jest.fn().mockResolvedValue({
        found: false,
        reference: null,
      }),
    };
    const service = new PublisherService(
      prisma as never,
      {} as never,
      {} as never,
      { decrypt: jest.fn() } as never,
      runtimeProfiles as never,
      browserRuntime as never,
    );

    await expect(service.run()).resolves.toMatchObject({
      found: 1,
      published: 1,
      blocked: 0,
    });

    expect(prisma.scheduledPost.update).toHaveBeenCalledWith({
      where: { id: 'instagram-post-unresolved' },
      data: expect.objectContaining({
        status: ScheduledPostStatus.PUBLISHED,
        externalPostId: null,
        externalPostUrl: null,
      }),
    });
    expect(prisma.publishAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-instagram-unresolved' },
      data: expect.objectContaining({
        status: PublishAttemptStatus.SUCCESS,
        responsePayload: expect.objectContaining({
          published: true,
          verification: {
            status: 'CONFIRMED',
            externalProof: 'UNRESOLVED',
          },
        }),
      }),
    });
  });

  it('prepares and publishes a queued Instagram post through the browser worker', async () => {
    const prisma = {
      scheduledPost: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'instagram-post-1',
            platform: SocialPlatform.INSTAGRAM,
            status: ScheduledPostStatus.QUEUED,
            channelId: 'instagram-channel-1',
            content: 'Instagram browser post',
            mediaUrls: ['https://cdn.example.com/ig.jpg'],
            scheduledAt: new Date('2026-08-25T00:00:00.000Z'),
            timezone: 'Asia/Kuala_Lumpur',
            retryCount: 0,
            historyId: null,
            brandRenderingSettings: null,
            channel: {
              id: 'instagram-channel-1',
              name: 'Instagram Browser',
              publishingPreference: 'BROWSER_RUNTIME',
              accessTokenEncrypted: null,
              externalId: null,
              tokenExpiresAt: null,
              socialChannelRuntimeProfile: {
                id: 'runtime-profile-1',
                browserProfileKey: 'channel-instagram-channel-1',
                browserProfileName: 'Instagram Browser',
                locale: 'en-MY',
                timezone: 'Asia/Kuala_Lumpur',
                proxyType: 'DIRECT',
                proxyHost: null,
                proxyPort: null,
                proxyUsernameEncrypted: null,
                proxyPasswordEncrypted: null,
                proxyCountry: null,
                lastKnownIp: null,
              },
            },
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      publishAttempt: {
        create: jest.fn().mockResolvedValue({ id: 'attempt-instagram-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const browserRuntime = {
      preflightInstagramLoginForChannel: jest.fn().mockResolvedValue({
        ready: true,
        loginRequired: false,
        message: 'Instagram Browser login is ready.',
        browserProfileKey: 'channel-instagram-channel-1',
      }),
      prepareInstagramPostForChannel: jest.fn().mockResolvedValue({
        success: true,
        readyForReview: true,
        imageAttached: true,
        attachedMediaCount: 1,
      }),
      publishInstagramPost: jest.fn().mockResolvedValue({
        success: true,
        published: true,
        verification: { status: 'CONFIRMED', externalProof: 'RESOLVED' },
        id: 'IgShortCode123',
        externalPostId: 'IgShortCode123',
        postUrl: 'https://www.instagram.com/p/IgShortCode123/',
      }),
    };
    const service = new PublisherService(
      prisma as never,
      {} as never,
      {} as never,
      { decrypt: jest.fn() } as never,
      {} as never,
      browserRuntime as never,
    );

    await expect(service.run()).resolves.toMatchObject({
      found: 1,
      published: 1,
      blocked: 0,
    });

    expect(browserRuntime.preflightInstagramLoginForChannel).toHaveBeenCalledWith(
      'instagram-channel-1',
    );
    expect(browserRuntime.prepareInstagramPostForChannel).toHaveBeenCalledWith(
      'instagram-channel-1',
      expect.objectContaining({
        caption: 'Instagram browser post',
        imageUrls: ['https://cdn.example.com/ig.jpg'],
      }),
    );
    expect(browserRuntime.publishInstagramPost).toHaveBeenCalledWith(
      'instagram-channel-1',
      'PUBLISH',
    );
    expect(prisma.scheduledPost.update).toHaveBeenCalledWith({
      where: { id: 'instagram-post-1' },
      data: expect.objectContaining({
        status: ScheduledPostStatus.PUBLISHED,
        externalPostId: 'IgShortCode123',
        externalPostUrl: 'https://www.instagram.com/p/IgShortCode123/',
      }),
    });
  });
});
