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
  };
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

    const result =
      (
        await this.browserRuntime.request(
          `/profiles/${encodeURIComponent(
            profile.browserProfileKey,
          )}/inspect`,
          {
            method: 'POST',
          },
        )
      ) as WorkerInspection;

    const page =
      result.page || {};

    const currentUrl =
      page.url?.trim() ||
      '';

    const loginRequired =
      this.isFacebookLoginPage(
        currentUrl,
      );

    const loginLikely =
      page.loginLikely === true ||
      (
        currentUrl.includes(
          'facebook.com',
        ) &&
        !loginRequired
      );

    await this.prisma.browserAccount.update({
      where: {
        id: accountId,
      },
      data: {
        loginStatus:
          loginLikely
            ? 'LOGGED_IN'
            : loginRequired
              ? 'LOGIN_REQUIRED'
              : 'UNKNOWN',
        cookieStatus:
          loginLikely
            ? 'ACTIVE'
            : 'PROFILE_READY',
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
            ? 'Facebook login is not complete.'
            : null,
      },
    });

    return {
      accountId,
      browserProfileKey:
        profile.browserProfileKey,
      loginLikely,
      loginRequired,
      page,
      result,
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
