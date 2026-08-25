import {
  randomUUID,
} from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BrowserAccountEventStatus,
  SocialChannelStatus,
  SocialPlatform,
  SocialProxyType,
} from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SocialTokenCryptoService } from '../../common/social-token-crypto.service';
import { createHash } from 'node:crypto';

type CreateBrowserAccountInput = {
  displayName?: string;
  facebookEmail?: string;
  facebookPassword?: string;

  platform?: SocialPlatform;
  browserProfileName?: string;

  locale?: string;
  timezone?: string;

  browserEngine?: string;
  operatingSystem?: string;
  userAgent?: string | null;

  screenWidth?: number;
  screenHeight?: number;
  deviceScaleFactor?: number;
  colorScheme?: string;

  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;

  identityLocked?: boolean;

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
    const facebookEmail =
      input.facebookEmail
        ?.trim()
        .toLowerCase() ||
      '';

    if (
      facebookEmail &&
      !this.isValidEmail(
        facebookEmail,
      )
    ) {
      throw new BadRequestException(
        'Facebook email is invalid.',
      );
    }

    const facebookEmailHash =
      facebookEmail
        ? createHash(
            'sha256',
          )
            .update(
              facebookEmail,
              'utf8',
            )
            .digest(
              'hex',
            )
        : null;

    const facebookPassword =
      input.facebookPassword ||
      '';

    const derivedDisplayName =
      facebookEmail
        ? facebookEmail
            .split('@')[0]
            .replace(
              /[._-]+/g,
              ' ',
            )
            .replace(
              /\b\w/g,
              (value) =>
                value.toUpperCase(),
            )
            .trim()
        : '';

    const displayName =
      input.displayName?.trim() ||
      derivedDisplayName;

    if (!displayName) {
      throw new BadRequestException(
        'Display name or Facebook email is required.',
      );
    }

    const browserEngine =
      input.browserEngine
        ?.trim()
        .toLowerCase() ||
      'chromium';

    if (
      ![
        'chromium',
        'firefox',
        'webkit',
      ].includes(
        browserEngine,
      )
    ) {
      throw new BadRequestException(
        'Browser engine must be chromium, firefox or webkit.',
      );
    }

    const operatingSystem =
      input.operatingSystem
        ?.trim() ||
      'macOS';

    const screenWidth =
      this.normalizeInteger(
        input.screenWidth,
        1440,
        800,
        7680,
      );

    const screenHeight =
      this.normalizeInteger(
        input.screenHeight,
        900,
        600,
        4320,
      );

    const deviceScaleFactor =
      this.normalizeNumber(
        input.deviceScaleFactor,
        2,
        0.5,
        4,
      );

    if (facebookEmailHash) {
      const existingAccount =
        await this.prisma.browserAccount
          .findUnique({
            where: {
              facebookEmailHash,
            },
            select: {
              id: true,
              displayName: true,
            },
          });

      if (existingAccount) {
        throw new BadRequestException(
          `A browser account already exists for this Facebook email: ${existingAccount.displayName}.`,
        );
      }
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

          facebookEmailEncrypted:
            facebookEmail
              ? this.socialTokenCrypto.encrypt(
                  facebookEmail,
                )
              : null,

          facebookPasswordEncrypted:
            facebookPassword
              ? this.socialTokenCrypto.encrypt(
                  facebookPassword,
                )
              : null,

          facebookEmailHash,


          locale:
            input.locale?.trim() ||
            'en-MY',

          timezone:
            input.timezone?.trim() ||
            'Asia/Kuala_Lumpur',

          browserEngine,
          operatingSystem,

          userAgent:
            input.userAgent?.trim() ||
            null,

          screenWidth,
          screenHeight,
          deviceScaleFactor,

          colorScheme:
            input.colorScheme?.trim() ||
            'light',

          hardwareConcurrency:
            input.hardwareConcurrency ==
            null
              ? null
              : this.normalizeInteger(
                  input.hardwareConcurrency,
                  8,
                  1,
                  128,
                ),

          deviceMemory:
            input.deviceMemory ==
            null
              ? null
              : this.normalizeInteger(
                  input.deviceMemory,
                  8,
                  1,
                  128,
                ),

          identityLocked:
            input.identityLocked ??
            true,

          identityVersion:
            1,

          fingerprintStatus:
            'LOCKED',

          identityError:
            null,

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
      browserEngine?: string;
      operatingSystem?: string;
      userAgent?: string | null;
      screenWidth?: number;
      screenHeight?: number;
      deviceScaleFactor?: number;
      identityLocked?: boolean;
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
      rawPages.flatMap(
        (page, index) => {
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

          /*
           * Facebook often exposes managed Pages with a vanity URL instead
           * of a numeric ID. The browser worker cannot derive a numeric ID
           * from those links, so use the stable URL username as the external
           * identifier rather than rejecting the whole onboarding batch.
           */
          const pageId =
            page.pageId?.trim() ||
            username ||
            '';

          if (
            !pageId ||
            this.isReservedFacebookPath(pageId) ||
            [
              'find friends',
              'meta business suite',
              'professional dashboard',
            ].includes(name.toLowerCase())
          ) {
            return [];
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
            return [];
          }

          return [{
            pageId,
            name,
            url,
            imageUrl:
              page.imageUrl?.trim() ||
              null,
            username,
          }];
        },
      );

    if (!normalizedPages.length) {
      throw new BadRequestException(
        'Facebook did not return any Page with a usable ID or username. Open the browser, switch to the Page profile once, then retry onboarding.',
      );
    }

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
        this.isReservedFacebookPath(candidate)
      ) {
        return null;
      }

      return candidate;
    } catch {
      return null;
    }
  }

  private isReservedFacebookPath(value: string) {
    return [
      'ads',
      'adsmanager',
      'bookmarks',
      'business',
      'events',
      'friends',
      'gaming',
      'groups',
      'help',
      'latest',
      'marketplace',
      'me',
      'memories',
      'messages',
      'notifications',
      'pages',
      'policies',
      'privacy',
      'profile.php',
      'reels',
      'settings',
      'watch',
    ].includes(value.trim().toLowerCase());
  }

  async linkChannel(
    accountId: string,
    channelId: string,
    input?: {
      isPrimary?: boolean;
    },
  ) {
    const cleanAccountId =
      accountId.trim();

    const cleanChannelId =
      channelId.trim();

    const [account, channel] =
      await Promise.all([
        this.prisma.browserAccount.findUnique({
          where: {
            id: cleanAccountId,
          },
          select: {
            id: true,
            platform: true,
          },
        }),
        this.prisma.socialChannel.findUnique({
          where: {
            id: cleanChannelId,
          },
          select: {
            id: true,
            platform: true,
            name: true,
          },
        }),
      ]);

    if (!account) {
      throw new NotFoundException(
        'Browser account was not found.',
      );
    }

    if (!channel) {
      throw new NotFoundException(
        'Social channel was not found.',
      );
    }

    if (
      account.platform !==
        SocialPlatform.FACEBOOK ||
      channel.platform !==
        SocialPlatform.FACEBOOK
    ) {
      throw new BadRequestException(
        'Only Facebook Browser Accounts can be linked to Facebook channels.',
      );
    }

    const isPrimary =
      input?.isPrimary ??
      true;

    const result =
      await this.prisma.$transaction(
        async (transaction) => {
          if (isPrimary) {
            await transaction
              .browserAccountChannel
              .updateMany({
                where: {
                  channelId:
                    cleanChannelId,
                },
                data: {
                  isPrimary:
                    false,
                },
              });
          }

          return transaction
            .browserAccountChannel
            .upsert({
              where: {
                browserAccountId_channelId: {
                  browserAccountId:
                    cleanAccountId,
                  channelId:
                    cleanChannelId,
                },
              },
              create: {
                browserAccountId:
                  cleanAccountId,
                channelId:
                  cleanChannelId,
                isPrimary,
              },
              update: {
                isPrimary,
              },
              include: {
                browserAccount: {
                  select: {
                    id: true,
                    displayName: true,
                    browserProfileName: true,
                    loginStatus: true,
                    cookieStatus: true,
                  },
                },
                channel: {
                  select: {
                    id: true,
                    name: true,
                    platform: true,
                  },
                },
              },
            });
        },
      );

    return {
      success: true,
      link: result,
    };
  }

  async selectForChannel(
    channelId: string,
    input?: {
      excludeAccountIds?: string[];
      minimumHealthScore?: number;
      requireActiveCookie?: boolean;
    },
  ) {
    const cleanChannelId =
      channelId?.trim();

    if (!cleanChannelId) {
      throw new BadRequestException(
        'channelId is required.',
      );
    }

    const channel =
      await this.prisma.socialChannel.findUnique({
        where: {
          id: cleanChannelId,
        },
        select: {
          id: true,
          name: true,
          platform: true,
          status: true,
        },
      });

    if (!channel) {
      throw new NotFoundException(
        'Social channel was not found.',
      );
    }

    if (
      channel.platform !==
      SocialPlatform.FACEBOOK
    ) {
      throw new BadRequestException(
        'Browser selection currently supports Facebook channels only.',
      );
    }

    const excludedIds =
      new Set(
        (
          input?.excludeAccountIds ||
          []
        )
          .map(
            (value) =>
              value?.trim(),
          )
          .filter(Boolean),
      );

    const minimumHealthScore =
      Number.isFinite(
        input?.minimumHealthScore,
      )
        ? Math.max(
            0,
            Math.min(
              100,
              Number(
                input?.minimumHealthScore,
              ),
            ),
          )
        : 50;

    const requireActiveCookie =
      input?.requireActiveCookie ??
      true;

    const links =
      await this.prisma.browserAccountChannel.findMany({
        where: {
          channelId:
            cleanChannelId,
        },
        include: {
          browserAccount: true,
        },
      });

    if (!links.length) {
      return {
        selected:
          null,
        channel,
        reason:
          'NO_LINKED_BROWSER_ACCOUNT',
        candidates: [],
      };
    }

    const now =
      Date.now();

    const candidates =
      links
        .filter(
          (link) =>
            !excludedIds.has(
              link.browserAccountId,
            ),
        )
        .map(
          (link) => {
            const account =
              link.browserAccount;

            const loginStatus =
              String(
                account.loginStatus ||
                'UNKNOWN',
              )
                .trim()
                .toUpperCase();

            const cookieStatus =
              String(
                account.cookieStatus ||
                'UNKNOWN',
              )
                .trim()
                .toUpperCase();

            let score =
              100;

            const warnings:
              string[] = [];

            const sessionReusable =
              loginStatus ===
                'LOGGED_IN' ||
              (
                loginStatus ===
                  'BROWSER_CLOSED' &&
                cookieStatus ===
                  'ACTIVE'
              );

            if (!sessionReusable) {
              score -=
                50;

              warnings.push(
                `Login status is ${loginStatus}.`,
              );
            } else if (
              loginStatus ===
              'BROWSER_CLOSED'
            ) {
              warnings.push(
                'Browser is closed and will be opened automatically.',
              );
            }

            if (
              cookieStatus !==
              'ACTIVE'
            ) {
              score -=
                25;

              warnings.push(
                `Cookie status is ${cookieStatus}.`,
              );
            }

            let heartbeatAgeSeconds:
              number | null =
              null;

            if (
              account.lastHeartbeatAt
            ) {
              heartbeatAgeSeconds =
                Math.max(
                  0,
                  Math.floor(
                    (
                      now -
                      account
                        .lastHeartbeatAt
                        .getTime()
                    ) /
                    1000,
                  ),
                );

              if (
                heartbeatAgeSeconds >
                86400
              ) {
                score -=
                  15;

                warnings.push(
                  'Heartbeat is older than 24 hours.',
                );
              } else if (
                heartbeatAgeSeconds >
                3600
              ) {
                score -=
                  5;

                warnings.push(
                  'Heartbeat is older than one hour.',
                );
              }
            } else {
              score -=
                10;

              warnings.push(
                'No heartbeat recorded.',
              );
            }

            if (
              account.proxyType !==
                SocialProxyType.DIRECT &&
              !account.lastKnownIp
            ) {
              score -=
                10;

              warnings.push(
                'Proxy IP has not been verified.',
              );
            }

            if (
              account.lastLoginError
            ) {
              score -=
                10;

              warnings.push(
                account.lastLoginError,
              );
            }

            if (
              link.isPrimary
            ) {
              score +=
                5;
            }

            score =
              Math.max(
                0,
                Math.min(
                  100,
                  score,
                ),
              );

            const eligible =
              sessionReusable &&
              (
                !requireActiveCookie ||
                cookieStatus ===
                  'ACTIVE'
              ) &&
              score >=
                minimumHealthScore;

            return {
              id:
                account.id,
              displayName:
                account.displayName,
              browserProfileKey:
                account.browserProfileKey,
              browserProfileName:
                account.browserProfileName,
              loginStatus:
                account.loginStatus,
              cookieStatus:
                account.cookieStatus,
              proxyType:
                account.proxyType,
              proxyCountry:
                account.proxyCountry,
              lastKnownIp:
                account.lastKnownIp,
              lastHeartbeatAt:
                account.lastHeartbeatAt,
              heartbeatAgeSeconds,
              isPrimary:
                link.isPrimary,
              healthScore:
                score,
              eligible,
              warnings,
            };
          },
        )
        .sort(
          (left, right) => {
            if (
              left.eligible !==
              right.eligible
            ) {
              return left.eligible
                ? -1
                : 1;
            }

            if (
              left.healthScore !==
              right.healthScore
            ) {
              return (
                right.healthScore -
                left.healthScore
              );
            }

            if (
              left.isPrimary !==
              right.isPrimary
            ) {
              return left.isPrimary
                ? -1
                : 1;
            }

            const leftHeartbeat =
              left.lastHeartbeatAt
                ? new Date(
                    left.lastHeartbeatAt,
                  ).getTime()
                : 0;

            const rightHeartbeat =
              right.lastHeartbeatAt
                ? new Date(
                    right.lastHeartbeatAt,
                  ).getTime()
                : 0;

            return (
              rightHeartbeat -
              leftHeartbeat
            );
          },
        );

    const selected =
      candidates.find(
        (candidate) =>
          candidate.eligible,
      ) ||
      null;

    return {
      selected,
      channel,
      reason:
        selected
          ? 'BEST_ELIGIBLE_BROWSER_SELECTED'
          : 'NO_ELIGIBLE_BROWSER_ACCOUNT',
      policy: {
        minimumHealthScore,
        requireActiveCookie,
        excludedAccountIds:
          Array.from(
            excludedIds,
          ),
      },
      candidates,
      selectedAt:
        new Date()
          .toISOString(),
    };
  }

  async pool() {
    const accounts =
      await this.prisma.browserAccount.findMany({
        orderBy: [
          {
            loginStatus:
              'asc',
          },
          {
            updatedAt:
              'desc',
          },
        ],
        include: {
          channels: {
            include: {
              channel: {
                select: {
                  id: true,
                  name: true,
                  platform: true,
                  status: true,
                  externalId: true,
                  username: true,
                },
              },
            },
          },
        },
      });

    const now =
      Date.now();

    const pool =
      accounts.map(
        (account) => {
          let healthScore =
            100;

          const warnings:
            string[] = [];

          const loginStatus =
            String(
              account.loginStatus ||
              'UNKNOWN',
            )
              .trim()
              .toUpperCase();

          const cookieStatus =
            String(
              account.cookieStatus ||
              'UNKNOWN',
            )
              .trim()
              .toUpperCase();

          if (
            loginStatus !==
            'LOGGED_IN'
          ) {
            healthScore -=
              40;

            warnings.push(
              `Login status: ${loginStatus}`,
            );
          }

          if (
            cookieStatus !==
            'ACTIVE'
          ) {
            healthScore -=
              25;

            warnings.push(
              `Cookie status: ${cookieStatus}`,
            );
          }

          if (
            account.proxyType !==
              'DIRECT' &&
            !account.lastKnownIp
          ) {
            healthScore -=
              10;

            warnings.push(
              'Proxy IP has not been verified.',
            );
          }

          let heartbeatAgeSeconds:
            number | null =
            null;

          if (
            account.lastHeartbeatAt
          ) {
            heartbeatAgeSeconds =
              Math.max(
                0,
                Math.floor(
                  (
                    now -
                    account
                      .lastHeartbeatAt
                      .getTime()
                  ) /
                  1000,
                ),
              );

            if (
              heartbeatAgeSeconds >
              86400
            ) {
              healthScore -=
                15;

              warnings.push(
                'Heartbeat is older than 24 hours.',
              );
            } else if (
              heartbeatAgeSeconds >
              3600
            ) {
              healthScore -=
                5;

              warnings.push(
                'Heartbeat is older than 1 hour.',
              );
            }
          } else {
            healthScore -=
              10;

            warnings.push(
              'No browser heartbeat recorded.',
            );
          }

          if (
            account.lastLoginError
          ) {
            healthScore -=
              10;

            warnings.push(
              account.lastLoginError,
            );
          }

          healthScore =
            Math.max(
              0,
              Math.min(
                100,
                healthScore,
              ),
            );

          const healthStatus =
            healthScore >=
            80
              ? 'HEALTHY'
              : healthScore >=
                  50
                ? 'WARNING'
                : 'CRITICAL';

          const availability =
            loginStatus ===
              'LOGGED_IN' &&
            healthScore >=
              80
              ? 'AVAILABLE'
              : loginStatus ===
                  'LOGGED_IN'
                ? 'ATTENTION'
                : 'LOGIN_REQUIRED';

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

            proxyCountry:
              account.proxyCountry,

            lastKnownIp:
              account.lastKnownIp,

            loginStatus:
              account.loginStatus,

            cookieStatus:
              account.cookieStatus,

            lastLoginAt:
              account.lastLoginAt,

            lastVerifiedAt:
              account.lastVerifiedAt,

            lastHeartbeatAt:
              account.lastHeartbeatAt,

            heartbeatAgeSeconds,

            lastLoginError:
              account.lastLoginError,

            pageCount:
              account.channels.length,

            pages:
              account.channels.map(
                (link) => ({
                  id:
                    link.channel.id,
                  name:
                    link.channel.name,
                  platform:
                    link.channel.platform,
                  status:
                    link.channel.status,
                  externalId:
                    link.channel.externalId,
                  username:
                    link.channel.username,
                  isPrimary:
                    link.isPrimary,
                }),
              ),

            health: {
              score:
                healthScore,
              status:
                healthStatus,
              warnings,
            },

            availability,

            createdAt:
              account.createdAt,

            updatedAt:
              account.updatedAt,
          };
        },
      );

    const summary = {
      total:
        pool.length,

      healthy:
        pool.filter(
          (account) =>
            account.health
              .status ===
            'HEALTHY',
        ).length,

      warning:
        pool.filter(
          (account) =>
            account.health
              .status ===
            'WARNING',
        ).length,

      critical:
        pool.filter(
          (account) =>
            account.health
              .status ===
            'CRITICAL',
        ).length,

      available:
        pool.filter(
          (account) =>
            account.availability ===
            'AVAILABLE',
        ).length,

      loginRequired:
        pool.filter(
          (account) =>
            account.availability ===
            'LOGIN_REQUIRED',
        ).length,
    };

    return {
      summary,
      accounts:
        pool,
      generatedAt:
        new Date()
          .toISOString(),
    };
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

      browserProfileName:
        account.browserProfileName,

      browserEngine:
        account.browserEngine,

      operatingSystem:
        account.operatingSystem,

      userAgent:
        account.userAgent,

      viewport: {
        width:
          account.screenWidth,
        height:
          account.screenHeight,
      },

      screenWidth:
        account.screenWidth,

      screenHeight:
        account.screenHeight,

      deviceScaleFactor:
        account.deviceScaleFactor,

      colorScheme:
        account.colorScheme,

      hardwareConcurrency:
        account.hardwareConcurrency,

      deviceMemory:
        account.deviceMemory,

      locale:
        account.locale,

      timezone:
        account.timezone,

      identityLocked:
        account.identityLocked,

      identityVersion:
        account.identityVersion,

      fingerprintStatus:
        account.fingerprintStatus,

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

      expectedIp:
        account.expectedIp,

      lastKnownIp:
        account.lastKnownIp,

      ipStatus:
        account.ipStatus,

      headless:
        false,

      startUrl:
        'https://www.facebook.com/',
    };
  }

  async getLoginCredentials(
    id: string,
  ) {
    const account =
      await this.prisma.browserAccount.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          facebookEmailEncrypted:
            true,
          facebookPasswordEncrypted:
            true,
        },
      });

    if (!account) {
      throw new NotFoundException(
        'Browser account was not found.',
      );
    }

    return {
      accountId:
        account.id,

      email:
        account.facebookEmailEncrypted
          ? this.socialTokenCrypto.decrypt(
              account.facebookEmailEncrypted,
            )
          : null,

      password:
        account.facebookPasswordEncrypted
          ? this.socialTokenCrypto.decrypt(
              account.facebookPasswordEncrypted,
            )
          : null,
    };
  }

  async markLoginRequired(
    id: string,
    message = 'Facebook login is required.',
  ) {
    const normalizedMessage =
      message.trim() ||
      'Facebook login is required.';

    const boundedMessage =
      normalizedMessage.slice(
        0,
        1000,
      );

    const account =
      await this.prisma.browserAccount.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          loginStatus: true,
          lastLoginError: true,
        },
      });

    if (!account) {
      throw new NotFoundException(
        'Browser account was not found.',
      );
    }

    const observedAt =
      new Date();

    await this.prisma.$transaction(
      async (transaction) => {
        await transaction.browserAccount.update({
          where: {
            id,
          },
          data: {
            loginStatus:
              'LOGIN_REQUIRED',
            cookieStatus:
              'PROFILE_READY',
            lastVerifiedAt:
              observedAt,
            lastHeartbeatAt:
              observedAt,
            lastLoginError:
              boundedMessage,
          },
        });

        if (
          account.loginStatus !==
            'LOGIN_REQUIRED' ||
          account.lastLoginError !==
            boundedMessage
        ) {
          await transaction.browserAccountEvent.create({
            data: {
              browserAccountId:
                id,
              eventType:
                'LOGIN_ATTENTION_REQUIRED',
              status:
                BrowserAccountEventStatus.WARNING,
              title:
                'Facebook login requires attention',
              message:
                boundedMessage,
              metadata: {
                source:
                  'FACEBOOK_PUBLISHER',
                observedAt:
                  observedAt.toISOString(),
              },
            },
          });
        }
      },
    );

    return {
      accountId:
        id,
      loginStatus:
        'LOGIN_REQUIRED',
      cookieStatus:
        'PROFILE_READY',
      observedAt:
        observedAt.toISOString(),
    };
  }

  async markLoginVerified(
    id: string,
    message = 'Facebook Cloud Browser login is ready.',
  ) {
    const account =
      await this.prisma.browserAccount.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          loginStatus: true,
        },
      });

    if (!account) {
      throw new NotFoundException(
        'Browser account was not found.',
      );
    }

    const observedAt =
      new Date();

    await this.prisma.$transaction(
      async (transaction) => {
        await transaction.browserAccount.update({
          where: {
            id,
          },
          data: {
            loginStatus:
              'LOGGED_IN',
            cookieStatus:
              'ACTIVE',
            lastLoginAt:
              observedAt,
            lastVerifiedAt:
              observedAt,
            lastHeartbeatAt:
              observedAt,
            lastLoginError:
              null,
          },
        });

        if (
          account.loginStatus !==
          'LOGGED_IN'
        ) {
          await transaction.browserAccountEvent.create({
            data: {
              browserAccountId:
                id,
              eventType:
                'LOGIN_VERIFIED',
              status:
                BrowserAccountEventStatus.SUCCESS,
              title:
                'Facebook login verified',
              message:
                message.trim() ||
                'Facebook Cloud Browser login is ready.',
              metadata: {
                source:
                  'FACEBOOK_PUBLISHER',
                observedAt:
                  observedAt.toISOString(),
              },
            },
          });
        }
      },
    );

    return {
      accountId:
        id,
      loginStatus:
        'LOGGED_IN',
      cookieStatus:
        'ACTIVE',
      observedAt:
        observedAt.toISOString(),
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
      workspaceId:
        account.workspaceId,
      brandId:
        account.brandId,
      browserProfileKey:
        account.browserProfileKey,
      browserProfileName:
        account.browserProfileName,

      maskedEmail:
        account.facebookEmailEncrypted
          ? this.maskEmail(
              this.socialTokenCrypto.decrypt(
                account.facebookEmailEncrypted,
              ),
            )
          : null,

      hasFacebookEmail:
        Boolean(
          account.facebookEmailEncrypted,
        ),

      hasPassword:
        Boolean(
          account.facebookPasswordEncrypted,
        ),

      locale:
        account.locale,

      timezone:
        account.timezone,

      browserEngine:
        account.browserEngine,

      operatingSystem:
        account.operatingSystem,

      userAgent:
        account.userAgent,

      screenWidth:
        account.screenWidth,

      screenHeight:
        account.screenHeight,

      deviceScaleFactor:
        account.deviceScaleFactor,

      colorScheme:
        account.colorScheme,

      hardwareConcurrency:
        account.hardwareConcurrency,

      deviceMemory:
        account.deviceMemory,

      identityLocked:
        account.identityLocked,

      identityVersion:
        account.identityVersion,

      fingerprintStatus:
        account.fingerprintStatus,

      identityError:
        account.identityError,

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

      expectedIp:
        account.expectedIp,

      lastIpCheckedAt:
        account.lastIpCheckedAt,

      ipStatus:
        account.ipStatus,

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
  private maskEmail(
    value: string,
  ) {
    const [
      localPart,
      domain,
    ] = value.split('@');

    if (
      !localPart ||
      !domain
    ) {
      return '***';
    }

    const visibleLength =
      Math.min(
        2,
        localPart.length,
      );

    return (
      localPart.slice(
        0,
        visibleLength,
      ) +
      '***@' +
      domain
    );
  }

  private isValidEmail(
    value: string,
  ) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      value,
    );
  }

  private normalizeInteger(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    if (
      value === undefined ||
      value === null
    ) {
      return fallback;
    }

    const normalized =
      Math.trunc(
        Number(value),
      );

    if (
      !Number.isFinite(
        normalized,
      ) ||
      normalized < minimum ||
      normalized > maximum
    ) {
      throw new BadRequestException(
        `Value must be between ${minimum} and ${maximum}.`,
      );
    }

    return normalized;
  }

  private normalizeNumber(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    if (
      value === undefined ||
      value === null
    ) {
      return fallback;
    }

    const normalized =
      Number(value);

    if (
      !Number.isFinite(
        normalized,
      ) ||
      normalized < minimum ||
      normalized > maximum
    ) {
      throw new BadRequestException(
        `Value must be between ${minimum} and ${maximum}.`,
      );
    }

    return normalized;
  }

}
