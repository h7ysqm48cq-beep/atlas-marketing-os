import {
  ScheduledPostStatus,
  SocialChannelStatus,
  SocialPlatform,
} from '../generated/prisma/enums';
import { AutomationService } from './automation.service';

jest.mock('./publisher.service', () => ({
  PublisherService: class PublisherService {},
}));
jest.mock('./facebook-connector.service', () => ({
  FacebookConnectorService: class FacebookConnectorService {},
}));
jest.mock('./telegram-connector.service', () => ({
  TelegramConnectorService: class TelegramConnectorService {},
}));
jest.mock('./instagram-connector.service', () => ({
  InstagramConnectorService: class InstagramConnectorService {},
}));
jest.mock('./runtime-profile.service', () => ({
  RuntimeProfileService: class RuntimeProfileService {},
}));
jest.mock('./browser-runtime-bridge.service', () => ({
  BrowserRuntimeBridgeService: class BrowserRuntimeBridgeService {},
}));

describe('AutomationService multi-platform initial status', () => {
  function createService() {
    const prisma = {
      socialChannel: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'channel-1',
            brandId: 'brand-1',
            platform: SocialPlatform.FACEBOOK,
            name: 'Facebook',
            status: SocialChannelStatus.CONNECTED,
          },
        ]),
      },
    };

    const service = new AutomationService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
    );

    const createPost = jest
      .spyOn(service, 'createPost')
      .mockImplementation((input) =>
        Promise.resolve({
          id: 'post-1',
          platform: input.platform,
          status: input.status ?? ScheduledPostStatus.DRAFT,
          scheduledAt: new Date(input.scheduledAt),
          channel: { id: 'channel-1', name: 'Facebook' },
        } as never),
      );

    return { service, createPost };
  }

  it('honours an explicit scheduled initial status', async () => {
    const { service, createPost } = createService();

    await service.createMultiPlatformPosts(
      {
        brandId: 'brand-1',
        contents: { [SocialPlatform.FACEBOOK]: 'hello' },
        platforms: [SocialPlatform.FACEBOOK],
        scheduledAt: '2030-01-02T12:00:00.000Z',
        queueImmediately: false,
      },
      {
        initialStatus: ScheduledPostStatus.SCHEDULED,
      },
    );

    expect(createPost).toHaveBeenCalledWith(
      expect.objectContaining({ status: ScheduledPostStatus.SCHEDULED }),
    );
  });

  it('keeps the legacy draft default when no initial status is supplied', async () => {
    const { service, createPost } = createService();

    await service.createMultiPlatformPosts({
      brandId: 'brand-1',
      contents: { [SocialPlatform.FACEBOOK]: 'hello' },
      platforms: [SocialPlatform.FACEBOOK],
      scheduledAt: '2030-01-02T12:00:00.000Z',
      queueImmediately: false,
    });

    expect(createPost).toHaveBeenCalledWith(
      expect.objectContaining({ status: ScheduledPostStatus.DRAFT }),
    );
  });
});