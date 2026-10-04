import { ConfigService } from '@nestjs/config';
import { BrowserAccountService } from './browser-account.service';
import { BrowserRuntimeBridgeService } from './browser-runtime-bridge.service';
import { RuntimeProfileService } from './runtime-profile.service';

jest.mock('./runtime-profile.service', () => ({
  RuntimeProfileService: class RuntimeProfileService {},
}));

describe('BrowserRuntimeBridgeService channel browser open routing', () => {
  it('opens a Facebook channel at its configured Page target when no explicit start URL is supplied', async () => {
    const runtimeProfiles = {
      getBrowserLaunchProfile: jest.fn().mockResolvedValue({
        channelId: 'channel-1',
        browserAccountId: 'browser-account-1',
        source: 'BROWSER_ACCOUNT',
        browserProfileKey: 'profile-1',
        browserProfileName: 'Shared Facebook Browser',
      }),
      getFacebookPublishingTarget: jest.fn().mockResolvedValue({
        channelId: 'channel-1',
        channelName: 'Target Page',
        pageId: '123456789',
        username: null,
        targetUrl: 'https://www.facebook.com/profile.php?id=123456789',
      }),
    };

    const browserAccounts = {
      markLoginRequired: jest.fn(),
      markLoginVerified: jest.fn(),
    };

    const service = new BrowserRuntimeBridgeService(
      {} as ConfigService,
      runtimeProfiles as unknown as RuntimeProfileService,
      browserAccounts as unknown as BrowserAccountService,
    );

    const request = jest
      .spyOn(service, 'request')
      .mockResolvedValue({
        opened: true,
      });

    await service.open('channel-1', {});

    expect(
      runtimeProfiles.getFacebookPublishingTarget,
    ).toHaveBeenCalledWith('channel-1');

    expect(request).toHaveBeenCalledTimes(1);

    const [, init] = request.mock.calls[0];
    const body = JSON.parse(String(init.body)) as {
      channelId?: string;
      browserProfileKey?: string;
      startUrl?: string;
    };

    expect(body).toMatchObject({
      channelId: 'channel-1',
      browserProfileKey: 'profile-1',
      startUrl: 'https://www.facebook.com/profile.php?id=123456789',
    });
  });
});
