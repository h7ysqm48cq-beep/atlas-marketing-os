import {
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrowserRuntimeBridgeService } from './browser-runtime-bridge.service';
import { BrowserAccountService } from './browser-account.service';
import { RuntimeProfileService } from './runtime-profile.service';

jest.mock('./runtime-profile.service', () => ({
  RuntimeProfileService: class RuntimeProfileService {},
}));

type NormalizePrepareInput = (input: {
  caption: string;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
}) => {
  caption: string;
  imageUrl: string | null;
  imageUrls: string[];
};

describe('BrowserRuntimeBridgeService Facebook media input', () => {
  const browserAccounts = {
    markLoginRequired:
      jest.fn(),
    markLoginVerified:
      jest.fn(),
  };

  const service = new BrowserRuntimeBridgeService(
    {} as ConfigService,
    {} as RuntimeProfileService,
    browserAccounts as unknown as BrowserAccountService,
  );
  const normalizePrepareInput = (
    service as unknown as {
      normalizePrepareInput: NormalizePrepareInput;
    }
  ).normalizePrepareInput.bind(service);

  it('normalizes, de-duplicates and preserves all Facebook image URLs', () => {
    expect(
      normalizePrepareInput({
        caption: ' Test post ',
        imageUrl: 'https://cdn.example.com/one.jpg',
        imageUrls: [
          ' https://cdn.example.com/one.jpg ',
          'https://cdn.example.com/two.png',
        ],
      }),
    ).toMatchObject({
      caption: 'Test post',
      imageUrl: 'https://cdn.example.com/one.jpg',
      imageUrls: [
        'https://cdn.example.com/one.jpg',
        'https://cdn.example.com/two.png',
      ],
    });
  });

  it('rejects a non-http Facebook image URL', () => {
    expect(() =>
      normalizePrepareInput({
        caption: 'Test post',
        imageUrls: ['file:///tmp/image.jpg'],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects more than ten Facebook images', () => {
    expect(() =>
      normalizePrepareInput({
        caption: 'Test post',
        imageUrls: Array.from(
          { length: 11 },
          (_, index) => `https://cdn.example.com/${index}.jpg`,
        ),
      }),
    ).toThrow('Facebook posts support at most 10 images.');
  });
});

describe('BrowserRuntimeBridgeService Facebook login state', () => {
  const profile = {
    browserAccountId:
      'browser-account-1',
    browserProfileKey:
      'profile-1',
  };

  const createService = () => {
    const browserAccounts = {
      markLoginRequired:
        jest.fn().mockResolvedValue(
          undefined,
        ),
      markLoginVerified:
        jest.fn().mockResolvedValue(
          undefined,
        ),
    };

    const service =
      new BrowserRuntimeBridgeService(
        {} as ConfigService,
        {} as RuntimeProfileService,
        browserAccounts as unknown as BrowserAccountService,
      );

    return {
      browserAccounts,
      service,
    };
  };

  it('marks the Browser Account when the worker requires Facebook login', async () => {
    const {
      browserAccounts,
      service,
    } = createService();

    const error =
      new BadGatewayException({
        message:
          'Facebook login is required.',
        workerStatus:
          400,
        workerResponse: {
          success:
            false,
          loginRequired:
            true,
        },
      });

    await expect(
      (
        service as unknown as {
          withLoginStateSync: <T>(
            inputProfile: typeof profile,
            operation: () => Promise<T>,
          ) => Promise<T>;
        }
      ).withLoginStateSync(
        profile,
        async () =>
          Promise.reject(
            error,
          ),
      ),
    ).rejects.toBe(
      error,
    );

    expect(
      browserAccounts.markLoginRequired,
    ).toHaveBeenCalledWith(
      'browser-account-1',
      'Facebook login is required.',
    );
  });

  it('does not change Browser Account state for unrelated worker errors', async () => {
    const {
      browserAccounts,
      service,
    } = createService();

    const error =
      new BadGatewayException({
        message:
          'Facebook composer was not found.',
        workerStatus:
          400,
        workerResponse: {
          success:
            false,
        },
      });

    await expect(
      (
        service as unknown as {
          withLoginStateSync: <T>(
            inputProfile: typeof profile,
            operation: () => Promise<T>,
          ) => Promise<T>;
        }
      ).withLoginStateSync(
        profile,
        async () =>
          Promise.reject(
            error,
          ),
      ),
    ).rejects.toBe(
      error,
    );

    expect(
      browserAccounts.markLoginRequired,
    ).not.toHaveBeenCalled();
  });

  it('blocks and synchronizes a live Facebook login page before publishing', async () => {
    const {
      browserAccounts,
      service,
    } = createService();

    jest.spyOn(
      service,
      'ensureProfile',
    ).mockResolvedValue(
      profile as never,
    );
    jest.spyOn(
      service,
      'request',
    ).mockResolvedValue({
      success: true,
      page: {
        url: 'https://www.facebook.com/login/',
        textPreview:
          'Log in to Facebook Forgotten password?',
        inputs: [
          {
            type: 'password',
          },
        ],
      },
    });

    await expect(
      service.preflightFacebookLoginForChannel(
        'channel-1',
      ),
    ).resolves.toMatchObject({
      ready: false,
      loginRequired: true,
      browserAccountId:
        'browser-account-1',
      browserProfileKey:
        'profile-1',
    });

    expect(
      browserAccounts.markLoginRequired,
    ).toHaveBeenCalledWith(
      'browser-account-1',
      'Facebook login is required in the linked Cloud Browser.',
    );
  });

  it('allows a live logged-in Facebook page', async () => {
    const {
      browserAccounts,
      service,
    } = createService();

    jest.spyOn(
      service,
      'ensureProfile',
    ).mockResolvedValue(
      profile as never,
    );
    jest.spyOn(
      service,
      'request',
    ).mockResolvedValue({
      success: true,
      page: {
        url: 'https://www.facebook.com/',
        textPreview:
          'M Story Professional dashboard',
        inputs: [],
      },
    });

    await expect(
      service.preflightFacebookLoginForChannel(
        'channel-1',
      ),
    ).resolves.toMatchObject({
      ready: true,
      loginRequired: false,
    });

    expect(
      browserAccounts.markLoginRequired,
    ).not.toHaveBeenCalled();
    expect(
      browserAccounts.markLoginVerified,
    ).toHaveBeenCalledWith(
      'browser-account-1',
      'Facebook Cloud Browser login is ready.',
    );
  });

  it('ignores hidden login inputs on a live logged-in Facebook page', async () => {
    const {
      browserAccounts,
      service,
    } = createService();

    jest.spyOn(
      service,
      'ensureProfile',
    ).mockResolvedValue(
      profile as never,
    );
    jest.spyOn(
      service,
      'request',
    ).mockResolvedValue({
      success: true,
      page: {
        url: 'https://www.facebook.com/pages/?category=your_pages',
        textPreview:
          'Pages that Dania Dani manages MGM满贯门SportsNews 专治你没瓜看 M Story Shiba MGM House',
        inputs: [],
      },
      frameInspections: [
        {
          inputs: [
            {
              type: 'password',
              visible: false,
            },
          ],
        },
      ],
    });

    await expect(
      service.preflightFacebookLoginForChannel(
        'channel-1',
      ),
    ).resolves.toMatchObject({
      ready: true,
      loginRequired: false,
    });

    expect(
      browserAccounts.markLoginRequired,
    ).not.toHaveBeenCalled();
    expect(
      browserAccounts.markLoginVerified,
    ).toHaveBeenCalledWith(
      'browser-account-1',
      'Facebook Cloud Browser login is ready.',
    );
  });

  it('uses an extended request timeout for Facebook publishing', async () => {
    const {
      service,
    } = createService();

    jest.spyOn(
      service,
      'ensureProfile',
    ).mockResolvedValue(
      profile as never,
    );
    const request = jest.spyOn(
      service,
      'request',
    ).mockResolvedValue({
      success: true,
      published: true,
      verification: {
        status: 'CONFIRMED',
      },
    });

    await service.publishFacebookPost(
      'channel-1',
      'PUBLISH',
    );

    expect(request).toHaveBeenCalledWith(
      '/profiles/profile-1/facebook/publish-post',
      expect.objectContaining({
        method: 'POST',
      }),
      true,
      180000,
    );
  });
});
