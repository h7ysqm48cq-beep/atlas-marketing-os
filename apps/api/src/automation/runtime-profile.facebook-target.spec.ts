jest.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: jest.fn(),
}));

jest.mock('socks-proxy-agent', () => ({
  SocksProxyAgent: jest.fn(),
}));

import { RuntimeProfileService } from './runtime-profile.service';

describe('RuntimeProfileService Facebook Page target', () => {
  it('prefers the stable Facebook Page ID URL when both Page ID and username are present', async () => {
    const prisma = {
      socialChannel: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'channel-1',
          name: 'Target Page',
          platform: 'FACEBOOK',
          externalId: '1152201331300072',
          username: '61588932607346',
        }),
      },
    };

    const service = new RuntimeProfileService(
      prisma as never,
      {} as never,
    );

    await expect(
      service.getFacebookPublishingTarget('channel-1'),
    ).resolves.toMatchObject({
      pageId: '1152201331300072',
      username: '61588932607346',
      targetUrl: 'https://www.facebook.com/profile.php?id=1152201331300072',
    });
  });

  it('falls back to a Page username only when no Page ID is available', async () => {
    const prisma = {
      socialChannel: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'channel-2',
          name: 'Slug Page',
          platform: 'FACEBOOK',
          externalId: null,
          username: 'slug-page',
        }),
      },
    };

    const service = new RuntimeProfileService(
      prisma as never,
      {} as never,
    );

    await expect(
      service.getFacebookPublishingTarget('channel-2'),
    ).resolves.toMatchObject({
      pageId: null,
      username: 'slug-page',
      targetUrl: 'https://www.facebook.com/slug-page/',
    });
  });
});
