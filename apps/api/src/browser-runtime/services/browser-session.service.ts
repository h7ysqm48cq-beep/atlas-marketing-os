import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  PrismaService,
} from '../../database/prisma.service';
import {
  BrowserRuntimeBridgeService,
} from '../../automation/browser-runtime-bridge.service';
import {
  BrowserAccountService,
} from './browser-account.service';

type OpenBrowserInput = {
  headless?: boolean;
  startUrl?: string;
};

type WorkerInspection = {
  page?: {
    title?: string;
    url?: string;
    loginLikely?: boolean;
    textPreview?: string;
    inputs?: Array<{
      type?: string | null;
      name?: string | null;
      autocomplete?: string | null;
    }>;
  };
  frameInspections?: Array<{
    frameUrl?: string;
    frameName?: string;
    textPreview?: string;
    inputs?: Array<{
      type?: string | null;
      name?: string | null;
      autocomplete?: string | null;
      visible?: boolean;
    }>;
  }>;
  success?: boolean;
  [key: string]: unknown;
};

@Injectable()
export class BrowserSessionService {
  constructor(
    private readonly prisma:
      PrismaService,
    private readonly browserAccounts:
      BrowserAccountService,
    private readonly browserRuntime:
      BrowserRuntimeBridgeService,
  ) {}

  async open(
    accountId: string,
    input: OpenBrowserInput = {},
  ) {
    const profile =
      await this.browserAccounts
        .getLaunchProfile(
          accountId,
        );

    const startUrl =
      input.startUrl?.trim() ||
      'https://www.facebook.com/';

    this.validateStartUrl(
      startUrl,
    );

    const result =
      await this.browserRuntime.request(
        '/profiles/open',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            ...profile,
            headless:
              input.headless ??
              false,
            startUrl,
          }),
        },
      );

    await this.prisma.browserAccount.update({
      where: {
        id: accountId,
      },
      data: {
        loginStatus:
          'BROWSER_OPEN',
        cookieStatus:
          'PROFILE_READY',
        lastHeartbeatAt:
          new Date(),
        lastLoginError:
          null,
      },
    });

    return {
      accountId,
      browserProfileKey:
        profile.browserProfileKey,
      result,
    };
  }

  async status(
    accountId: string,
  ) {
    const profile =
      await this.browserAccounts
        .getLaunchProfile(
          accountId,
        );

    const result =
      await this.browserRuntime.request(
        `/profiles/${encodeURIComponent(
          profile.browserProfileKey,
        )}/status`,
        {
          method: 'GET',
        },
      );

    await this.prisma.browserAccount.update({
      where: {
        id: accountId,
      },
      data: {
        lastHeartbeatAt:
          new Date(),
      },
    });

    return {
      accountId,
      browserProfileKey:
        profile.browserProfileKey,
      ...result,
    };
  }

  async inspect(
    accountId: string,
  ) {
    const profile =
      await this.browserAccounts
        .getLaunchProfile(
          accountId,
        );

    const inspectPath =
      `/profiles/${encodeURIComponent(
        profile.browserProfileKey,
      )}/inspect`;

    let result:
      WorkerInspection;

    try {
      result =
        (
          await this.browserRuntime.request(
            inspectPath,
            {
              method: 'POST',
            },
          )
        ) as WorkerInspection;
    } catch (error) {
      if (
        !this.isProfileNotRunningError(
          error,
        )
      ) {
        throw error;
      }

      await this.browserRuntime.request(
        '/profiles/open',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            ...profile,
            headless: false,
            startUrl:
              'https://www.facebook.com/',
          }),
        },
      );

      result =
        (
          await this.browserRuntime.request(
            inspectPath,
            {
              method: 'POST',
            },
          )
        ) as WorkerInspection;
    }

    const page =
      result.page || {};

    const currentUrl =
      page.url?.trim() ||
      '';

    const textPreview =
      page.textPreview
        ?.trim()
        .toLowerCase() ||
      '';

    const frameInspections =
      Array.isArray(
        result.frameInspections,
      )
        ? result.frameInspections
        : [];

    const pageInputs =
      Array.isArray(
        page.inputs,
      )
        ? page.inputs
        : [];

    const frameInputs =
      frameInspections.flatMap(
        (frame: any) =>
          Array.isArray(
            frame?.inputs,
          )
            ? frame.inputs
            : [],
      );

    const allInputs = [
      ...pageInputs,
      ...frameInputs,
    ];

    const hasEmailInput =
      allInputs.some(
        (input: any) => {
          const name =
            String(
              input?.name || '',
            ).toLowerCase();

          const type =
            String(
              input?.type || '',
            ).toLowerCase();

          const autocomplete =
            String(
              input?.autocomplete ||
              '',
            ).toLowerCase();

          return (
            name === 'email' ||
            autocomplete.includes(
              'username',
            ) ||
            (
              type === 'text' &&
              name.includes(
                'email',
              )
            )
          );
        },
      );

    const hasPasswordInput =
      allInputs.some(
        (input: any) =>
          String(
            input?.type || '',
          ).toLowerCase() ===
          'password',
      );

    const hasLoginText =
      [
        'log in to facebook',
        'forgotten password',
        'create new account',
        'email address or mobile number',
      ].some(
        (value) =>
          textPreview.includes(
            value,
          ),
      );

    const loginPageByUrl =
      this.isFacebookLoginPage(
        currentUrl,
      );

    const twoFactorRequired =
      currentUrl
        .toLowerCase()
        .includes(
          'two_step_verification',
        ) ||
      textPreview.includes(
        'authentication code',
      ) ||
      textPreview.includes(
        'two-factor authentication',
      ) ||
      textPreview.includes(
        'enter the code',
      );

    const checkpointRequired =
      currentUrl
        .toLowerCase()
        .includes(
          '/checkpoint',
        ) ||
      textPreview.includes(
        'security check',
      ) ||
      textPreview.includes(
        'confirm your identity',
      );

    const loginRequired =
      !twoFactorRequired &&
      !checkpointRequired &&
      (
        loginPageByUrl ||
        hasPasswordInput ||
        (
          hasEmailInput &&
          hasLoginText
        )
      );

    const loginLikely =
      !loginRequired &&
      !twoFactorRequired &&
      !checkpointRequired &&
      currentUrl
        .toLowerCase()
        .includes(
          'facebook.com',
        );

    const loginStatus =
      twoFactorRequired
        ? 'TWO_FACTOR_REQUIRED'
        : checkpointRequired
          ? 'CHECKPOINT_REQUIRED'
          : loginRequired
            ? 'LOGIN_REQUIRED'
            : loginLikely
              ? 'LOGGED_IN'
              : 'UNKNOWN';

    const cookieStatus =
      loginLikely
        ? 'ACTIVE'
        : loginRequired
          ? 'PROFILE_READY'
          : twoFactorRequired ||
              checkpointRequired
            ? 'PENDING_VERIFICATION'
            : 'UNKNOWN';

    await this.prisma.browserAccount.update({
      where: {
        id: accountId,
      },
      data: {
        loginStatus,
        cookieStatus,
        lastLoginAt:
          loginLikely
            ? new Date()
            : undefined,
        lastVerifiedAt:
          new Date(),
        lastHeartbeatAt:
          new Date(),
        lastLoginError:
          loginRequired
            ? 'Facebook login is required.'
            : twoFactorRequired
              ? 'Facebook two-factor verification is required.'
              : checkpointRequired
                ? 'Facebook security checkpoint requires attention.'
                : null,
      },
    });

    return {
      accountId,
      browserProfileKey:
        profile.browserProfileKey,
      loginStatus,
      loginLikely,
      loginRequired,
      twoFactorRequired,
      checkpointRequired,
      detection: {
        loginPageByUrl,
        hasEmailInput,
        hasPasswordInput,
        hasLoginText,
      },
      page,
      result,
    };
  }

  async discoverFacebookPages(
    accountId: string,
  ) {
    const profile =
      await this.browserAccounts
        .getLaunchProfile(
          accountId,
        );

    const status =
      await this.browserRuntime.request(
        `/profiles/${encodeURIComponent(
          profile.browserProfileKey,
        )}/status`,
        {
          method: 'GET',
        },
      );

    if (
      status.running !== true
    ) {
      await this.browserRuntime.request(
        '/profiles/open',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            ...profile,
            headless: false,
            startUrl:
              'https://www.facebook.com/',
          }),
        },
      );
    }

    const result =
      await this.browserRuntime.request(
        `/profiles/${encodeURIComponent(
          profile.browserProfileKey,
        )}/facebook/discover-pages`,
        {
          method: 'POST',
        },
      );

    const discoveredPages =
      Array.isArray(
        result.pages,
      )
        ? result.pages
        : [];

    await this.prisma.browserAccount.update({
      where: {
        id: accountId,
      },
      data: {
        lastVerifiedAt:
          new Date(),
        lastHeartbeatAt:
          new Date(),
        lastLoginError:
          null,
      },
    });

    return {
      accountId,
      browserProfileKey:
        profile.browserProfileKey,
      count:
        discoveredPages.length,
      pages:
        discoveredPages,
      currentUrl:
        result.currentUrl ??
        null,
      discoveredAt:
        result.discoveredAt ??
        new Date().toISOString(),
    };
  }

  async close(
    accountId: string,
  ) {
    const profile =
      await this.browserAccounts
        .getLaunchProfile(
          accountId,
        );

    const result =
      await this.browserRuntime.request(
        `/profiles/${encodeURIComponent(
          profile.browserProfileKey,
        )}/close`,
        {
          method: 'POST',
        },
      );

    await this.prisma.browserAccount.update({
      where: {
        id: accountId,
      },
      data: {
        loginStatus:
          'BROWSER_CLOSED',
        lastHeartbeatAt:
          new Date(),
      },
    });

    return {
      accountId,
      browserProfileKey:
        profile.browserProfileKey,
      result,
    };
  }

  private validateStartUrl(
    value: string,
  ) {
    let parsed: URL;

    try {
      parsed =
        new URL(value);
    } catch {
      throw new BadRequestException(
        'Start URL is invalid.',
      );
    }

    if (
      ![
        'http:',
        'https:',
      ].includes(
        parsed.protocol,
      )
    ) {
      throw new BadRequestException(
        'Start URL must use HTTP or HTTPS.',
      );
    }
  }

  private isProfileNotRunningError(
    error: unknown,
  ) {
    const response =
      error &&
      typeof error === 'object' &&
      'getResponse' in error &&
      typeof (
        error as {
          getResponse?: unknown;
        }
      ).getResponse ===
        'function'
        ? (
            error as {
              getResponse:
                () => unknown;
            }
          ).getResponse()
        : error;

    const normalized =
      (
        typeof response ===
        'string'
          ? response
          : JSON.stringify(
              response,
            )
      ).toLowerCase();

    return (
      normalized.includes(
        'browser profile is not running',
      ) ||
      normalized.includes(
        'profile is not running',
      ) ||
      normalized.includes(
        'profile was not found',
      ) ||
      normalized.includes(
        '"workerstatus":404',
      )
    );
  }

  private isFacebookLoginPage(
    url: string,
  ) {
    const normalized =
      url.toLowerCase();

    return (
      normalized.includes(
        '/login',
      ) ||
      normalized.includes(
        '/checkpoint',
      ) ||
      normalized.includes(
        '/two_step_verification',
      ) ||
      normalized.includes(
        '/recover',
      )
    );
  }
}
