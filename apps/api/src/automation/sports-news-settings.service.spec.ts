import {
  sanitizeSportsNewsSettingsResponse,
  SportsNewsSettingsService,
} from './sports-news-settings.service';

describe('SportsNewsSettingsService response redaction', () => {
  const rawSettings = {
    id: 'settings-1',
    workspaceId: 'workspace-1',
    storyMinimum: 1,
    storyMaximum: 5,
    telegramChannel: {
      id: 'telegram-1',
      name: 'Telegram',
      accessTokenEncrypted: 'telegram-ciphertext',
    },
    facebookChannel: {
      id: 'facebook-1',
      name: 'Facebook',
      accessTokenEncrypted: null,
    },
  };

  it('removes encrypted social tokens while preserving connection metadata', () => {
    const result = sanitizeSportsNewsSettingsResponse(rawSettings);

    expect(result.telegramChannel).toEqual({
      id: 'telegram-1',
      name: 'Telegram',
      hasAccessToken: true,
    });
    expect(result.facebookChannel).toEqual({
      id: 'facebook-1',
      name: 'Facebook',
      hasAccessToken: false,
    });
    expect(
      'accessTokenEncrypted' in (result.telegramChannel as object),
    ).toBe(false);
    expect(
      'accessTokenEncrypted' in (result.facebookChannel as object),
    ).toBe(false);
  });

  it('applies the same redaction to the GET settings path', async () => {
    const prisma = {
      sportsNewsSetting: {
        upsert: jest.fn().mockResolvedValue(rawSettings),
      },
    };
    const workspaceScope = {
      getCurrentWorkspace: jest.fn().mockResolvedValue({
        id: 'workspace-1',
      }),
    };
    const service = new SportsNewsSettingsService(
      prisma as never,
      workspaceScope as never,
    );

    const result = await service.get();

    expect(prisma.sportsNewsSetting.upsert).toHaveBeenCalled();
    expect(result.telegramChannel).toEqual({
      id: 'telegram-1',
      name: 'Telegram',
      hasAccessToken: true,
    });
    expect(result.facebookChannel).toEqual({
      id: 'facebook-1',
      name: 'Facebook',
      hasAccessToken: false,
    });
  });
});
