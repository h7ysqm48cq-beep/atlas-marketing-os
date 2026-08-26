import {
  resolvePublisherRetryDecision,
  resolveSportsNewsRetryDecision,
} from './publisher-retry-policy';
import { ScheduledPostStatus, SocialPlatform } from '../generated/prisma/enums';
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
