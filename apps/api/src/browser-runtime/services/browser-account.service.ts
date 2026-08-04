import {
  randomUUID,
} from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SocialChannelStatus,
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
      brandId?: string | null;
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

    let brandId =
      existing.brandId;

    let workspaceId =
      existing.workspaceId;

    if (
      input.brandId !==
      undefined
    ) {
      brandId =
        input.brandId?.trim() ||
        null;

      if (brandId) {
        const brand =
          await this.prisma.brand.findUnique({
            where: {
              id: brandId,
            },
            select: {
              id: true,
              workspaceId: true,
            },
          });

        if (!brand) {
          throw new NotFoundException(
            'Brand was not found.',
          );
        }

        workspaceId =
          brand.workspaceId;
      } else {
        workspaceId =
          null;
      }
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
          brandId,
          workspaceId,
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


  async syncFacebookPages(
    accountId: string,
    input: {
      brandId?: string | null;
      pages?: Array<{
        pageId?: string | null;
        name?: string;
        url?: string | null;
        imageUrl?: string | null;
        username?: string | null;
      }>;
    },
  ) {
    const account =
      await this.prisma.browserAccount.findUnique({
        where: {
          id: accountId,
        },
      });

    if (!account) {
      throw new NotFoundException(
        'Browser account was not found.',
      );
    }

    if (
      account.platform !==
      SocialPlatform.FACEBOOK
    ) {
      throw new BadRequestException(
        'Only Facebook Browser Accounts can sync Facebook Pages.',
      );
    }

    const requestedBrandId =
      input.brandId?.trim() ||
      account.brandId?.trim() ||
      '';

    if (!requestedBrandId) {
      throw new BadRequestException(
        'brandId is required before Pages can be synced.',
      );
    }

    const brand =
      await this.prisma.brand.findUnique({
        where: {
          id: requestedBrandId,
        },
        select: {
          id: true,
          workspaceId: true,
        },
      });

    if (!brand) {
      throw new NotFoundException(
        'Brand was not found.',
      );
    }

    const workspaceId =
      account.workspaceId?.trim() ||
      brand.workspaceId;

    if (!workspaceId) {
      throw new BadRequestException(
        'The selected Brand does not have a Workspace.',
      );
    }

    const rawPages =
      Array.isArray(input.pages)
        ? input.pages
        : [];

    if (!rawPages.length) {
      throw new BadRequestException(
        'Select at least one Facebook Page.',
      );
    }

    const normalizedPages =
      rawPages.map(
        (page, index) => {
          const pageId =
            page.pageId?.trim() ||
            '';

          const name =
            page.name?.trim() ||
            '';

          const url =
            page.url?.trim() ||
            null;

          const username =
            page.username?.trim() ||
            this.extractFacebookUsername(
              url,
            );

          if (!pageId) {
            throw new BadRequestException(
              `Page ID is required for item ${index + 1}.`,
            );
          }

          if (
            !/^[a-zA-Z0-9._-]+$/.test(
              pageId,
            )
          ) {
            throw new BadRequestException(
              `Invalid Facebook Page ID for item ${index + 1}.`,
            );
          }

          if (!name) {
            throw new BadRequestException(
              `Page name is required for item ${index + 1}.`,
            );
          }

          return {
            pageId,
            name,
            url,
            imageUrl:
              page.imageUrl?.trim() ||
              null,
            username,
          };
        },
      );

    const uniquePages =
      Array.from(
        new Map(
          normalizedPages.map(
            (page) => [
              page.pageId,
              page,
            ],
          ),
        ).values(),
      );

    const result =
      await this.prisma.$transaction(
        async (transaction) => {
          let created = 0;
          let reused = 0;
          let linked = 0;

          const channels: Array<{
            id: string;
            name: string;
            platform: SocialPlatform;
            externalId: string | null;
            username: string | null;
            status: SocialChannelStatus;
            pageUrl: string | null;
            imageUrl: string | null;
            created: boolean;
          }> = [];

          for (
            const page
            of uniquePages
          ) {
            let channelCreated =
              false;

            let channel =
              await transaction.socialChannel.findFirst({
                where: {
                  brandId:
                    requestedBrandId,
                  platform:
                    SocialPlatform.FACEBOOK,
                  externalId:
                    page.pageId,
                },
              });

            if (channel) {
              reused += 1;

              channel =
                await transaction.socialChannel.update({
                  where: {
                    id: channel.id,
                  },
                  data: {
                    name:
                      page.name,
                    username:
                      page.username,
                    workspaceId,
                    status:
                      SocialChannelStatus.CONNECTED,
                    lastConnectedAt:
                      new Date(),
                    lastError:
                      null,
                  },
                });
            } else {
              channel =
                await transaction.socialChannel.create({
                  data: {
                    workspaceId,
                    brandId:
                      requestedBrandId,
                    platform:
                      SocialPlatform.FACEBOOK,
                    name:
                      page.name,
                    externalId:
                      page.pageId,
                    username:
                      page.username,
                    status:
                      SocialChannelStatus.CONNECTED,
                    lastConnectedAt:
                      new Date(),
                    lastError:
                      null,
                  },
                });

              created += 1;
              channelCreated =
                true;
            }

            const existingLink =
              await transaction.browserAccountChannel.findUnique({
                where: {
                  browserAccountId_channelId: {
                    browserAccountId:
                      accountId,
                    channelId:
                      channel.id,
                  },
                },
              });

            if (!existingLink) {
              await transaction.browserAccountChannel.create({
                data: {
                  browserAccountId:
                    accountId,
                  channelId:
                    channel.id,
                  isPrimary:
                    false,
                },
              });

              linked += 1;
            }

            channels.push({
              id:
                channel.id,
              name:
                channel.name,
              platform:
                channel.platform,
              externalId:
                channel.externalId,
              username:
                channel.username,
              status:
                channel.status,
              pageUrl:
                page.url,
              imageUrl:
                page.imageUrl,
              created:
                channelCreated,
            });
          }

          await transaction.browserAccount.update({
            where: {
              id: accountId,
            },
            data: {
              workspaceId,
              brandId:
                requestedBrandId,
              lastVerifiedAt:
                new Date(),
              lastHeartbeatAt:
                new Date(),
              lastLoginError:
                null,
            },
          });

          return {
            created,
            reused,
            linked,
            channels,
          };
        },
      );

    return {
      success: true,
      accountId,
      brandId:
        requestedBrandId,
      workspaceId,
      requested:
        rawPages.length,
      processed:
        uniquePages.length,
      ...result,
      syncedAt:
        new Date().toISOString(),
    };
  }

  private extractFacebookUsername(
    url?: string | null,
  ) {
    if (!url) {
      return null;
    }

    try {
      const parsed =
        new URL(url);

      const parts =
        parsed.pathname
          .split('/')
          .filter(Boolean);

      const candidate =
        parts[0] ||
        null;

      if (
        !candidate ||
        [
          'pages',
          'profile.php',
          'groups',
          'watch',
          'marketplace',
          'messages',
        ].includes(
          candidate.toLowerCase(),
        )
      ) {
        return null;
      }

      return candidate;
    } catch {
      return null;
    }
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
