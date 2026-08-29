import {
  getEditionPlatforms,
  resolveSportsNewsInitialStatus,
  shouldRunScheduledEdition,
  SportsNewsAutomationService,
} from './sports-news-automation.service';
import { ScheduledPostStatus, SocialPlatform } from '../generated/prisma/enums';

describe('shouldRunScheduledEdition', () => {
  const now = new Date('2026-08-17T02:30:00.000Z');

  it('allows a missed morning edition inside the catch-up window', () => {
    expect(
      shouldRunScheduledEdition({
        enabled: true,
        currentTime: '10:30',
        scheduledTime: '08:00',
        beforeTime: '18:00',
        lastCompletedAt: null,
        now,
        timezone: 'Asia/Kuala_Lumpur',
      }),
    ).toBe(true);
  });

  it('does not rerun an edition already completed today', () => {
    expect(
      shouldRunScheduledEdition({
        enabled: true,
        currentTime: '10:30',
        scheduledTime: '08:00',
        beforeTime: '18:00',
        lastCompletedAt: new Date('2026-08-17T01:00:00.000Z'),
        now,
        timezone: 'Asia/Kuala_Lumpur',
      }),
    ).toBe(false);
  });

  it('keeps the morning edition outside the evening window', () => {
    expect(
      shouldRunScheduledEdition({
        enabled: true,
        currentTime: '18:00',
        scheduledTime: '08:00',
        beforeTime: '18:00',
        lastCompletedAt: null,
        now,
        timezone: 'Asia/Kuala_Lumpur',
      }),
    ).toBe(false);
  });

  it('allows a new edition after the local date changes', () => {
    expect(
      shouldRunScheduledEdition({
        enabled: true,
        currentTime: '08:05',
        scheduledTime: '08:00',
        lastCompletedAt: new Date('2026-08-16T01:00:00.000Z'),
        now,
        timezone: 'Asia/Kuala_Lumpur',
      }),
    ).toBe(true);
  });

  it('builds the target list from global and edition channel switches', () => {
    expect(
      getEditionPlatforms('MORNING', {
        telegramEnabled: true,
        facebookEnabled: true,
        morningTelegramEnabled: false,
        morningFacebookEnabled: true,
        eveningTelegramEnabled: true,
        eveningFacebookEnabled: false,
      }),
    ).toEqual([SocialPlatform.FACEBOOK]);
  });

  it('keeps approval-required content in draft', () => {
    expect(
      resolveSportsNewsInitialStatus({
        autoPublishEnabled: true,
        approvalRequired: true,
        queueStatusOnCreate: 'QUEUED',
      }),
    ).toBe(ScheduledPostStatus.DRAFT);
  });

  it('keeps content in draft when auto publishing is disabled', () => {
    expect(
      resolveSportsNewsInitialStatus({
        autoPublishEnabled: false,
        approvalRequired: false,
        queueStatusOnCreate: 'SCHEDULED',
      }),
    ).toBe(ScheduledPostStatus.DRAFT);
  });

  it('honors the configured queue status when automatic publishing is safe', () => {
    expect(
      resolveSportsNewsInitialStatus({
        autoPublishEnabled: true,
        approvalRequired: false,
        queueStatusOnCreate: 'SCHEDULED',
      }),
    ).toBe(ScheduledPostStatus.SCHEDULED);
  });
});

describe('SportsNewsAutomationService history linkage', () => {
  it('links every platform post from one edition to one generation history record', async () => {
    const settings = {
      id: 'sports-settings-1',
      enabled: true,
      timezone: 'Asia/Kuala_Lumpur',
      telegramEnabled: true,
      facebookEnabled: true,
      morningTelegramEnabled: true,
      morningFacebookEnabled: true,
      eveningTelegramEnabled: true,
      eveningFacebookEnabled: true,
      telegramChannelId: 'telegram-channel-1',
      facebookChannelId: 'facebook-channel-1',
      channelOverrides: {},
      duplicateEditionPolicy: 'SKIP',
      autoPublishEnabled: true,
      approvalRequired: false,
      queueStatusOnCreate: 'QUEUED',
      imageGenerationEnabled: false,
      language: 'zh-en',
      publishRetryEnabled: true,
      publishRetryLimit: 3,
      publishRetryDelayMinutes: 10,
      morningSameDaySourcesOnly: false,
      sameDaySourcesOnly: false,
      maxSourceAgeHours: 24,
      requirePublishedAt: false,
      requireSourceUrl: false,
      minimumSources: 1,
      freshnessFallbackEnabled: false,
      morningPostTitleTemplate: 'M-Sports Morning {date}',
      eveningPostTitleTemplate: 'M-Sports Evening {date}',
    } as never;
    const channels = {
      [SocialPlatform.TELEGRAM]: {
        id: 'telegram-channel-1',
        brandId: 'brand-1',
        name: 'Sports Telegram',
      },
      [SocialPlatform.FACEBOOK]: {
        id: 'facebook-channel-1',
        brandId: 'brand-1',
        name: 'Sports Facebook',
      },
    } as const;
    const prisma = {
      scheduledPost: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: `${data.channelId}-post`,
            ...data,
          }),
        ),
      },
      generationHistory: {
        create: jest.fn().mockResolvedValue({ id: 'history-1' }),
      },
      sportsNewsSetting: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest.fn(
        async (callback: (transaction: unknown) => Promise<unknown>) =>
          callback(prisma),
      ),
    };
    const service = new SportsNewsAutomationService(
      { get: jest.fn().mockReturnValue('test-key') } as never,
      prisma as never,
      {} as never,
      {} as never,
      { get: jest.fn().mockResolvedValue(settings) } as never,
      {} as never,
      {} as never,
    );

    const serviceInternals = service as any;

    jest
      .spyOn(serviceInternals, 'resolveChannel')
      .mockImplementation(async (platform: SocialPlatform) =>
        channels[platform],
      );
    jest
      .spyOn(serviceInternals, 'generateNews')
      .mockResolvedValue({
        content: 'Verified sports report',
        imageHighlights: [],
        visualContext: '',
        visualDirection: '',
      } as never);

    await serviceInternals.createEdition('EVENING');

    expect(prisma.generationHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        brandId: 'brand-1',
        platforms: [SocialPlatform.TELEGRAM, SocialPlatform.FACEBOOK],
        telegram: 'Verified sports report',
        facebook: 'Verified sports report',
        language: 'zh-en',
        analysis: expect.objectContaining({
          source: 'SPORTS_NEWS_AUTOMATION',
          edition: 'EVENING',
        }),
      }),
    });

    expect(prisma.scheduledPost.create).toHaveBeenCalledTimes(2);
    expect(prisma.scheduledPost.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ historyId: 'history-1' }),
      }),
    );
    expect(prisma.scheduledPost.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ historyId: 'history-1' }),
      }),
    );
  });
});
