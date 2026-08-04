import {
  randomUUID,
} from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SocialPlatform,
  SocialProxyType,
} from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SocialTokenCryptoService } from '../../common/social-token-crypto.service';

type CreateBrowserAccountInput = {
  displayName: string;
  platform?: SocialPlatform;
  browserProfileName?: string;
  locale?: string;
  timezone?: string;
  proxyType?: SocialProxyType;
  proxyHost?: string | null;
  proxyPort?: number | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
  proxyCountry?: string | null;
  workspaceId?: string | null;
  brandId?: string | null;
};

@Injectable()
export class BrowserAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly socialTokenCrypto: SocialTokenCryptoService,
  ) {}

  async list() {
    const accounts =
      await this.prisma.browserAccount.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          channels: {
            include: {
              channel: true,
            },
          },
        },
      });

    return accounts.map(
      (account) =>
        this.sanitize(account),
    );
  }

  async getById(
    id: string,
  ) {
    const account =
      await this.prisma.browserAccount.findUnique({
        where: {
          id,
        },
        include: {
          channels: {
            include: {
              channel: true,
            },
          },
        },
      });

    if (!account) {
      throw new NotFoundException(
        'Browser account was not found.',
      );
    }

    return this.sanitize(account);
  }

  async create(
    input: CreateBrowserAccountInput,
  ) {
    const displayName =
      input.displayName?.trim();

    if (!displayName) {
      throw new BadRequestException(
        'Display name is required.',
      );
    }

    const proxyType =
      input.proxyType ??
      SocialProxyType.DIRECT;

    if (
      proxyType !==
      SocialProxyType.DIRECT
    ) {
      if (
        !input.proxyHost?.trim()
      ) {
        throw new BadRequestException(
          'Proxy host is required.',
        );
      }

      if (
        !Number.isInteger(
          input.proxyPort,
        ) ||
        !input.proxyPort ||
        input.proxyPort < 1 ||
        input.proxyPort > 65535
      ) {
        throw new BadRequestException(
          'Proxy port must be between 1 and 65535.',
        );
      }
    }

    const account =
      await this.prisma.browserAccount.create({
        data: {
          displayName,
          platform:
            input.platform ??
            SocialPlatform.FACEBOOK,
          browserProfileKey:
            `browser-account-${randomUUID()}`,
          browserProfileName:
            input.browserProfileName?.trim() ||
            `${displayName} Browser`,
          locale:
            input.locale?.trim() ||
            'en-MY',
          timezone:
            input.timezone?.trim() ||
            'Asia/Kuala_Lumpur',
          proxyType,
          proxyHost:
            proxyType ===
            SocialProxyType.DIRECT
              ? null
              : input.proxyHost?.trim() ||
                null,
          proxyPort:
            proxyType ===
            SocialProxyType.DIRECT
              ? null
              : input.proxyPort,
          proxyUsernameEncrypted:
            proxyType ===
              SocialProxyType.DIRECT ||
            !input.proxyUsername
              ? null
              : this.socialTokenCrypto.encrypt(
                  input.proxyUsername,
                ),
          proxyPasswordEncrypted:
            proxyType ===
              SocialProxyType.DIRECT ||
            !input.proxyPassword
              ? null
              : this.socialTokenCrypto.encrypt(
                  input.proxyPassword,
                ),
          proxyCountry:
            proxyType ===
            SocialProxyType.DIRECT
              ? null
              : input.proxyCountry?.trim() ||
                null,
          workspaceId:
            input.workspaceId ||
            null,
          brandId:
            input.brandId ||
            null,
          loginStatus:
            'PENDING',
          cookieStatus:
            'NOT_CREATED',
        },
      });

    return this.sanitize(
      account,
    );
  }

  async update(
    id: string,
    input: {
      displayName?: string;
      browserProfileName?: string;
      locale?: string;
      timezone?: string;
      proxyType?: SocialProxyType;
      proxyHost?: string | null;
      proxyPort?: number | null;
      proxyUsername?: string | null;
      proxyPassword?: string | null;
      proxyCountry?: string | null;
      clearProxyCredentials?: boolean;
    },
  ) {
    const existing =
      await this.prisma.browserAccount.findUnique({
        where: {
          id,
        },
      });

    if (!existing) {
      throw new NotFoundException(
        'Browser account was not found.',
      );
    }

    const displayName =
      input.displayName === undefined
        ? existing.displayName
        : input.displayName.trim();

    if (!displayName) {
      throw new BadRequestException(
        'Display name is required.',
      );
    }

    const browserProfileName =
      input.browserProfileName === undefined
        ? existing.browserProfileName
        : input.browserProfileName.trim();

    if (!browserProfileName) {
      throw new BadRequestException(
        'Browser profile name is required.',
      );
    }

    const locale =
      input.locale === undefined
        ? existing.locale
        : input.locale.trim();

    const timezone =
      input.timezone === undefined
        ? existing.timezone
        : input.timezone.trim();

    if (!locale) {
      throw new BadRequestException(
        'Locale is required.',
      );
    }

    if (!timezone) {
      throw new BadRequestException(
        'Timezone is required.',
      );
    }

    const proxyType =
      input.proxyType ??
      existing.proxyType;

    const proxyHost =
      input.proxyHost === undefined
        ? existing.proxyHost
        : input.proxyHost?.trim() || null;

    const proxyPort =
      input.proxyPort === undefined
        ? existing.proxyPort
        : input.proxyPort;

    const proxyCountry =
      input.proxyCountry === undefined
        ? existing.proxyCountry
        : input.proxyCountry?.trim() || null;

    if (
      proxyType !==
      SocialProxyType.DIRECT
    ) {
      if (!proxyHost) {
        throw new BadRequestException(
          'Proxy host is required.',
        );
      }

      if (
        !Number.isInteger(
          proxyPort,
        ) ||
        !proxyPort ||
        proxyPort < 1 ||
        proxyPort > 65535
      ) {
        throw new BadRequestException(
          'Proxy port must be between 1 and 65535.',
        );
      }
    }

    let proxyUsernameEncrypted =
      existing.proxyUsernameEncrypted;

    let proxyPasswordEncrypted =
      existing.proxyPasswordEncrypted;

    if (
      proxyType ===
        SocialProxyType.DIRECT ||
      input.clearProxyCredentials ===
        true
    ) {
      proxyUsernameEncrypted = null;
      proxyPasswordEncrypted = null;
    } else {
      if (
        input.proxyUsername !==
        undefined
      ) {
        const value =
          input.proxyUsername?.trim() ||
          '';

        proxyUsernameEncrypted =
          value
            ? this.socialTokenCrypto.encrypt(
                value,
              )
            : null;
      }

      if (
        input.proxyPassword !==
        undefined
      ) {
        const value =
          input.proxyPassword;

        proxyPasswordEncrypted =
          value
            ? this.socialTokenCrypto.encrypt(
                value,
              )
            : null;
      }
    }

    const updated =
      await this.prisma.browserAccount.update({
        where: {
          id,
        },
        data: {
          displayName,
          browserProfileName,
          locale,
          timezone,
          proxyType,
          proxyHost:
            proxyType ===
            SocialProxyType.DIRECT
              ? null
              : proxyHost,
          proxyPort:
            proxyType ===
            SocialProxyType.DIRECT
              ? null
              : proxyPort,
          proxyCountry:
            proxyType ===
            SocialProxyType.DIRECT
              ? null
              : proxyCountry,
          proxyUsernameEncrypted,
          proxyPasswordEncrypted,
        },
        include: {
          channels: {
            include: {
              channel: true,
            },
          },
        },
      });

    return this.sanitize(
      updated,
    );
  }

  async getLaunchProfile(
    id: string,
  ) {
    const account =
      await this.prisma.browserAccount.findUnique({
        where: {
          id,
        },
      });

    if (!account) {
      throw new NotFoundException(
        'Browser account was not found.',
      );
    }

    return {
      channelId:
        account.id,
      browserProfileKey:
        account.browserProfileKey,
      locale:
        account.locale,
      timezone:
        account.timezone,
      proxyType:
        account.proxyType,
      proxyHost:
        account.proxyHost,
      proxyPort:
        account.proxyPort,
      proxyUsername:
        account.proxyUsernameEncrypted
          ? this.socialTokenCrypto.decrypt(
              account.proxyUsernameEncrypted,
            )
          : null,
      proxyPassword:
        account.proxyPasswordEncrypted
          ? this.socialTokenCrypto.decrypt(
              account.proxyPasswordEncrypted,
            )
          : null,
      headless:
        false,
      startUrl:
        'https://www.facebook.com/',
    };
  }

  private sanitize(
    account: any,
  ) {
    return {
      id:
        account.id,
      displayName:
        account.displayName,
      platform:
        account.platform,
      browserProfileKey:
        account.browserProfileKey,
      browserProfileName:
        account.browserProfileName,
      locale:
        account.locale,
      timezone:
        account.timezone,
      proxyType:
        account.proxyType,
      proxyHost:
        account.proxyHost,
      proxyPort:
        account.proxyPort,
      proxyCountry:
        account.proxyCountry,
      hasProxyUsername:
        Boolean(
          account.proxyUsernameEncrypted,
        ),
      hasProxyPassword:
        Boolean(
          account.proxyPasswordEncrypted,
        ),
      facebookUserId:
        account.facebookUserId,
      facebookUserName:
        account.facebookUserName,
      loginStatus:
        account.loginStatus,
      cookieStatus:
        account.cookieStatus,
      lastKnownIp:
        account.lastKnownIp,
      lastLoginAt:
        account.lastLoginAt,
      lastVerifiedAt:
        account.lastVerifiedAt,
      lastHeartbeatAt:
        account.lastHeartbeatAt,
      lastLoginError:
        account.lastLoginError,
      channels:
        account.channels ??
        [],
      createdAt:
        account.createdAt,
      updatedAt:
        account.updatedAt,
    };
  }
}
