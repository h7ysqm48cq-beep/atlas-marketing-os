import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ScheduledPostStatus,
  SocialChannelStatus,
  SocialPlatform,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { SocialTokenCryptoService } from '../common/social-token-crypto.service';
import { PublisherService } from './publisher.service';
import { FacebookConnectorService } from './facebook-connector.service';
import { TelegramConnectorService } from './telegram-connector.service';
import { RuntimeProfileService } from './runtime-profile.service';

type CreateChannelInput = {
  brandId: string;
  platform: SocialPlatform;
  name: string;
  externalId?: string;
  username?: string;
  accessToken?: string;
  tokenExpiresAt?: string | null;
};

type CreatePostInput = {
  brandId: string;
  channelId: string;
  campaignId?: string;
  historyId?: string;
  platform: SocialPlatform;
  title?: string;
  content: string;
  mediaUrls?: string[];
  scheduledAt: string;
  timezone?: string;
  status?: ScheduledPostStatus;
};

type UpdatePostInput = Partial<CreatePostInput> & {
  lastError?: string | null;
};

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: PublisherService,
    private readonly socialTokenCrypto: SocialTokenCryptoService,
    private readonly facebookConnector: FacebookConnectorService,
    private readonly telegramConnector: TelegramConnectorService,
    private readonly runtimeProfiles: RuntimeProfileService,
  ) {}

  async dashboard() {
    const [channels, postsByStatus, upcoming, recentAttempts] =
      await Promise.all([
        this.prisma.socialChannel.findMany({
          where: {
            hiddenAt: null,
          },
          orderBy: [{ platform: 'asc' }, { createdAt: 'asc' }],
          include: {
            brand: {
              select: {
                id: true,
                name: true,
              },
            },
            browserAccountLinks: {
              orderBy: [
                {
                  isPrimary: 'desc',
                },
                {
                  createdAt: 'asc',
                },
              ],
              include: {
                browserAccount: {
                  select: {
                    id: true,
                    displayName: true,
                    browserProfileKey: true,
                    browserProfileName: true,
                    loginStatus: true,
                    cookieStatus: true,
                    proxyType: true,
                    proxyCountry: true,
                    lastKnownIp: true,
                    lastLoginAt: true,
                    lastVerifiedAt: true,
                    lastHeartbeatAt: true,
                    lastLoginError: true,
                  },
                },
              },
            },
            _count: {
              select: {
                scheduledPosts: true,
              },
            },
          },
        }),

        this.prisma.scheduledPost.groupBy({
          by: ['status'],
          _count: {
            _all: true,
          },
        }),

        this.prisma.scheduledPost.findMany({
          where: {
            status: {
              in: [ScheduledPostStatus.SCHEDULED, ScheduledPostStatus.QUEUED],
            },
            scheduledAt: {
              gte: new Date(),
            },
          },
          take: 10,
          orderBy: {
            scheduledAt: 'asc',
          },
          select: {
            id: true,
            brandId: true,
            channelId: true,
            campaignId: true,
            historyId: true,
            platform: true,
            title: true,
            content: true,
            scheduledAt: true,
            timezone: true,
            status: true,
            externalPostId: true,
            externalPostUrl: true,
            publishedAt: true,
            lastError: true,
            createdAt: true,
            updatedAt: true,

            channel: true,

            brand: {
              select: {
                id: true,
                name: true,
              },
            },

            campaign: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),

        this.prisma.publishAttempt.findMany({
          take: 10,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            scheduledPost: {
              select: {
                id: true,
                brandId: true,
                channelId: true,
                campaignId: true,
                historyId: true,
                platform: true,
                title: true,
                content: true,
                scheduledAt: true,
                timezone: true,
                status: true,
                externalPostId: true,
                externalPostUrl: true,
                publishedAt: true,
                lastError: true,
                createdAt: true,
                updatedAt: true,

                channel: true,

                brand: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        }),
      ]);

    const statusCounts = Object.fromEntries(
      Object.values(ScheduledPostStatus).map((status) => [status, 0]),
    ) as Record<ScheduledPostStatus, number>;

    for (const item of postsByStatus) {
      statusCounts[item.status] = item._count._all;
    }

    return {
      channels: channels.map((channel) => this.sanitizeChannel(channel)),
      statusCounts,
      upcoming: upcoming.map((post) => ({
        ...post,
        channel: this.sanitizeChannel(post.channel),
      })),
      recentAttempts: recentAttempts.map((attempt) => ({
        ...attempt,
        scheduledPost: {
          ...attempt.scheduledPost,
          channel: this.sanitizeChannel(attempt.scheduledPost.channel),
        },
      })),
    };
  }

  async listChannels(includeHidden = false) {
    const channels = await this.prisma.socialChannel.findMany({
      where: includeHidden
        ? undefined
        : {
            hiddenAt: null,
          },
      orderBy: [{ platform: 'asc' }, { createdAt: 'asc' }],
      include: {
        brand: {
          select: {
            id: true,
            name: true,
          },
        },
        browserAccountLinks: {
          orderBy: [
            {
              isPrimary: 'desc',
            },
            {
              createdAt: 'asc',
            },
          ],
          include: {
            browserAccount: {
              select: {
                id: true,
                displayName: true,
                browserProfileKey: true,
                browserProfileName: true,
                loginStatus: true,
                cookieStatus: true,
                proxyType: true,
                proxyCountry: true,
                lastKnownIp: true,
                lastLoginAt: true,
                lastVerifiedAt: true,
                lastHeartbeatAt: true,
                lastLoginError: true,
              },
            },
          },
        },
        _count: {
          select: {
            scheduledPosts: true,
          },
        },
      },
    });

    return channels.map((channel) => this.sanitizeChannel(channel));
  }

  async inspectTelegramBot(botToken: string) {
    if (!botToken?.trim()) {
      throw new BadRequestException('Telegram Bot Token is required.');
    }

    return this.telegramConnector.inspectBot(botToken.trim());
  }

  async createChannel(input: CreateChannelInput) {
    await this.ensureBrand(input.brandId);

    const brand = await this.prisma.brand.findUniqueOrThrow({
      where: {
        id: input.brandId,
      },
      select: {
        workspaceId: true,
      },
    });

    const accessToken = input.accessToken?.trim();

    const externalId = input.externalId?.trim() || null;

    const existingChannel = externalId
      ? await this.prisma.socialChannel.findFirst({
          where: {
            brandId: input.brandId,
            platform: input.platform,
            externalId,
          },
        })
      : null;

    if (existingChannel) {
      const updated = await this.prisma.socialChannel.update({
        where: { id: existingChannel.id },
        data: {
          name: input.name.trim() || existingChannel.name,
          username: input.username?.trim() || existingChannel.username,
          accessTokenEncrypted: accessToken
            ? this.socialTokenCrypto.encrypt(accessToken)
            : existingChannel.accessTokenEncrypted,
          tokenExpiresAt: this.parseOptionalDate(input.tokenExpiresAt),
          status:
            (accessToken || existingChannel.accessTokenEncrypted) && externalId
              ? SocialChannelStatus.CONNECTED
              : SocialChannelStatus.DISCONNECTED,
          lastConnectedAt:
            (accessToken || existingChannel.accessTokenEncrypted) && externalId
              ? new Date()
              : existingChannel.lastConnectedAt,
          lastError: null,
        },
      });

      return this.sanitizeChannel(updated);
    }

    const channel = await this.prisma.socialChannel.create({
      data: {
        workspaceId: brand.workspaceId,
        brandId: input.brandId,
        platform: input.platform,
        name: input.name.trim(),
        externalId: externalId,
        username: input.username?.trim() || null,
        accessTokenEncrypted: accessToken
          ? this.socialTokenCrypto.encrypt(accessToken)
          : null,
        tokenExpiresAt: this.parseOptionalDate(input.tokenExpiresAt),
        status:
          accessToken && input.externalId?.trim()
            ? SocialChannelStatus.CONNECTED
            : SocialChannelStatus.DISCONNECTED,
        lastConnectedAt:
          accessToken && input.externalId?.trim() ? new Date() : null,
        lastError: null,
        publishingPreference:
          input.platform === SocialPlatform.FACEBOOK
            ? 'BROWSER_RUNTIME'
            : undefined,
      },
    });

    return this.sanitizeChannel(channel);
  }

  async getChannel(id: string) {
    const channel = await this.prisma.socialChannel.findUnique({
      where: {
        id,
      },
      include: {
        brand: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            scheduledPosts: true,
          },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('Social channel not found.');
    }

    return this.sanitizeChannel(channel);
  }

  async testChannel(id: string) {
    const channel = await this.prisma.socialChannel.findUnique({
      where: {
        id,
      },
    });

    if (!channel) {
      throw new NotFoundException('Social channel not found.');
    }

    if (channel.platform === SocialPlatform.TELEGRAM) {
      const chatId = channel.externalId?.trim();
      const encryptedToken = channel.accessTokenEncrypted?.trim();

      if (!chatId || !encryptedToken) {
        throw new BadRequestException(
          'Telegram Bot Token and Chat ID are required.',
        );
      }

      try {
        const botToken = this.socialTokenCrypto.decrypt(encryptedToken);
        const result = await this.telegramConnector.testConnection({
          botToken,
          chatId,
        });

        const updated = await this.prisma.socialChannel.update({
          where: { id },
          data: {
            name: result.channel.title || channel.name,
            username: result.channel.username ?? channel.username,
            status: SocialChannelStatus.CONNECTED,
            lastConnectedAt: new Date(),
            lastError: null,
          },
        });

        return {
          channel: this.sanitizeChannel(updated),
          connection: result,
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Telegram connection test failed.';

        await this.prisma.socialChannel.update({
          where: { id },
          data: {
            status: SocialChannelStatus.ERROR,
            lastError: message.slice(0, 500),
          },
        });

        throw error;
      }
    }

    if (channel.platform !== SocialPlatform.FACEBOOK) {
      throw new BadRequestException('Unsupported social channel platform.');
    }

    const pageId = channel.externalId?.trim();

    const encryptedToken = channel.accessTokenEncrypted?.trim();

    if (!pageId) {
      throw new BadRequestException('Facebook Page ID is not configured.');
    }

    if (!encryptedToken) {
      throw new BadRequestException('Facebook access token is not configured.');
    }

    if (channel.tokenExpiresAt && channel.tokenExpiresAt <= new Date()) {
      await this.prisma.socialChannel.update({
        where: {
          id,
        },
        data: {
          status: SocialChannelStatus.EXPIRED,
          lastError: 'Facebook access token has expired.',
        },
      });

      throw new BadRequestException(
        'Facebook access token has expired. Reconnect this Page.',
      );
    }

    try {
      const accessToken = this.socialTokenCrypto.decrypt(encryptedToken);

      const publishNetwork = await this.runtimeProfiles.getPublishNetwork(id);

      if (publishNetwork.proxyType === 'SOCKS5') {
        throw new BadRequestException(
          [
            'SOCKS5 is not supported by',
            'Facebook Native API testing.',
            'Use DIRECT, HTTP or HTTPS,',
            'or wait for Browser Runtime support.',
          ].join(' '),
        );
      }

      const result = await this.facebookConnector.testConnection({
        pageId,
        accessToken,
        proxyUrl: publishNetwork.proxyUrl,
      });

      const updated = await this.prisma.socialChannel.update({
        where: {
          id,
        },
        data: {
          name: result.page.name || channel.name,
          username: result.page.username ?? channel.username,
          status: SocialChannelStatus.CONNECTED,
          lastConnectedAt: new Date(),
          lastError: null,
        },
      });

      return {
        channel: this.sanitizeChannel(updated),
        connection: {
          ...result,
          runtime: {
            proxyType: publishNetwork.proxyType,
            browserProfileKey: publishNetwork.browserProfileKey,
            locale: publishNetwork.locale,
            timezone: publishNetwork.timezone,
          },
        },
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Facebook connection test failed.';

      await this.prisma.socialChannel.update({
        where: {
          id,
        },
        data: {
          status: SocialChannelStatus.ERROR,
          lastError: message.slice(0, 500),
        },
      });

      throw error;
    }
  }

  async disconnectChannel(id: string) {
    await this.ensureChannel(id);

    const channel = await this.prisma.socialChannel.update({
      where: {
        id,
      },
      data: {
        accessTokenEncrypted: null,
        tokenExpiresAt: null,
        status: SocialChannelStatus.DISCONNECTED,
        lastError: null,
      },
    });

    return this.sanitizeChannel(channel);
  }

  async disconnectChannelApi(id: string) {
    const existing =
      await this.prisma.socialChannel.findUnique({
        where: {
          id,
        },
        include: {
          browserAccountLinks: {
            orderBy: [
              {
                isPrimary: 'desc',
              },
              {
                createdAt: 'asc',
              },
            ],
            include: {
              browserAccount: {
                select: {
                  id: true,
                  displayName: true,
                  browserProfileKey: true,
                  browserProfileName: true,
                  loginStatus: true,
                  cookieStatus: true,
                  proxyType: true,
                  proxyCountry: true,
                  lastKnownIp: true,
                  lastLoginAt: true,
                  lastVerifiedAt: true,
                  lastHeartbeatAt: true,
                  lastLoginError: true,
                },
              },
            },
          },
        },
      });

    if (!existing) {
      throw new NotFoundException('Social channel not found.');
    }

    if (existing.platform !== SocialPlatform.FACEBOOK) {
      throw new BadRequestException(
        'Only Facebook channels have a Facebook API connection.',
      );
    }

    const hasBrowserAccount =
      existing.browserAccountLinks.length > 0;

    const channel =
      await this.prisma.socialChannel.update({
        where: {
          id,
        },
        data: {
          accessTokenEncrypted: null,
          tokenExpiresAt: null,
          publishingPreference: 'BROWSER_RUNTIME',
          status: hasBrowserAccount
            ? SocialChannelStatus.CONNECTED
            : SocialChannelStatus.DISCONNECTED,
          lastError: null,
        },
      });

    return this.sanitizeChannel({
      ...channel,
      browserAccountLinks:
        existing.browserAccountLinks,
    });
  }

  async disconnectAllFacebookApi(
    confirmation: string,
  ) {
    if (
      confirmation !==
      'DISCONNECT_ALL_FACEBOOK_API'
    ) {
      throw new BadRequestException(
        'Explicit confirmation "DISCONNECT_ALL_FACEBOOK_API" is required.',
      );
    }

    return this.prisma.$transaction(
      async (transaction) => {
        const channels =
          await transaction.socialChannel.findMany({
            where: {
              platform: SocialPlatform.FACEBOOK,
              accessTokenEncrypted: {
                not: null,
              },
            },
            select: {
              id: true,
              browserAccountLinks: {
                select: {
                  browserAccountId: true,
                },
              },
            },
          });

        const updated =
          await Promise.all(
            channels.map((channel) =>
              transaction.socialChannel.update({
              where: {
                id: channel.id,
              },
              data: {
                accessTokenEncrypted: null,
                tokenExpiresAt: null,
                publishingPreference: 'BROWSER_RUNTIME',
                status:
                  channel.browserAccountLinks.length > 0
                    ? SocialChannelStatus.CONNECTED
                    : SocialChannelStatus.DISCONNECTED,
                lastError: null,
              },
              }),
            ),
          );

        return {
          disconnected: updated.length,
          channels: updated.map((channel) =>
            this.sanitizeChannel(channel),
          ),
        };
      },
    );
  }

  async removeChannel(id: string) {
    const channel = await this.prisma.socialChannel.findUnique({
      where: {
        id,
      },
      include: {
        _count: {
          select: {
            scheduledPosts: true,
          },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('Social channel not found.');
    }

    if (channel._count.scheduledPosts > 0) {
      throw new BadRequestException(
        [
          'This channel cannot be deleted because',
          `it has ${channel._count.scheduledPosts}`,
          'scheduled or historical post record(s).',
          'Disconnect it instead.',
        ].join(' '),
      );
    }

    await this.prisma.socialChannel.delete({
      where: {
        id,
      },
    });

    return {
      deleted: true,
      id,
      name: channel.name,
    };
  }

  async updateChannel(
    id: string,
    input: {
      name?: string;
      externalId?: string;
      username?: string | null;
      accessToken?: string | null;
      tokenExpiresAt?: string | null;
      publishingPreference?: string;
    },
  ) {
    await this.ensureChannel(id);

    const publishingPreference =
      input.publishingPreference === undefined
        ? undefined
        : input.publishingPreference.trim().toUpperCase();

    if (
      publishingPreference !== undefined &&
      ![
        'AUTOMATIC',
        'NATIVE_API',
        'BROWSER_RUNTIME',
      ].includes(
        publishingPreference,
      )
    ) {
      throw new BadRequestException(
        'Invalid publishing preference.',
      );
    }

    const accessToken =
      input.accessToken === undefined
        ? undefined
        : input.accessToken?.trim() || null;

    const channel = await this.prisma.socialChannel.update({
      where: {
        id,
      },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        externalId:
          input.externalId !== undefined
            ? input.externalId.trim() || null
            : undefined,
        username:
          input.username !== undefined
            ? input.username?.trim() || null
            : undefined,
        accessTokenEncrypted:
          accessToken === undefined
            ? undefined
            : accessToken
              ? this.socialTokenCrypto.encrypt(accessToken)
              : null,
        tokenExpiresAt:
          input.tokenExpiresAt === undefined
            ? undefined
            : this.parseOptionalDate(input.tokenExpiresAt),
        publishingPreference,
        status: accessToken
          ? SocialChannelStatus.CONNECTED
          : accessToken === null
            ? SocialChannelStatus.DISCONNECTED
            : undefined,
        lastConnectedAt: accessToken ? new Date() : undefined,
        lastError: accessToken ? null : undefined,
      },
    });

    return this.sanitizeChannel(channel);
  }

  private parseOptionalDate(value?: string | null) {
    if (!value?.trim()) {
      return null;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid tokenExpiresAt value.');
    }

    return parsed;
  }

  private sanitizeChannel<
    T extends {
      accessTokenEncrypted: string | null;
      browserAccountLinks?: Array<{
        isPrimary: boolean;
        browserAccount: {
          id: string;
          displayName: string;
          browserProfileKey: string;
          browserProfileName: string;
          loginStatus: string;
          cookieStatus: string;
          proxyType: string;
          proxyCountry: string | null;
          lastKnownIp: string | null;
          lastLoginAt: Date | null;
          lastVerifiedAt: Date | null;
          lastHeartbeatAt: Date | null;
          lastLoginError: string | null;
        };
      }>;
    },
  >(channel: T) {
    const { accessTokenEncrypted, browserAccountLinks, ...safeChannel } =
      channel;

    const browserAccounts = (browserAccountLinks || []).map((link) => ({
      ...link.browserAccount,
      isPrimary: link.isPrimary,
      health: this.calculateBrowserAccountHealth(link.browserAccount),
    }));

    const primaryBrowserAccount =
      browserAccounts.find((account) => account.isPrimary) ||
      browserAccounts[0] ||
      null;

    return {
      ...safeChannel,
      hasAccessToken: Boolean(accessTokenEncrypted),
      browserAccounts,
      primaryBrowserAccount,
      publishingMode: primaryBrowserAccount
        ? 'BROWSER_RUNTIME'
        : accessTokenEncrypted
          ? 'NATIVE_API'
          : 'UNCONFIGURED',
      managedBy: primaryBrowserAccount
        ? {
            id: primaryBrowserAccount.id,
            displayName: primaryBrowserAccount.displayName,
            browserProfileName: primaryBrowserAccount.browserProfileName,
          }
        : null,
    };
  }

  private calculateBrowserAccountHealth(account: {
    loginStatus: string;
    cookieStatus: string;
    proxyType: string;
    proxyCountry: string | null;
    lastHeartbeatAt: Date | null;
    lastLoginError: string | null;
  }) {
    let score = 100;

    const loginStatus = account.loginStatus.trim().toUpperCase();

    const cookieStatus = account.cookieStatus.trim().toUpperCase();

    if (loginStatus !== 'LOGGED_IN') {
      score -= 45;
    }

    if (cookieStatus !== 'ACTIVE') {
      score -= 25;
    }

    if (account.proxyType !== 'DIRECT' && !account.proxyCountry) {
      score -= 10;
    }

    if (!account.lastHeartbeatAt) {
      score -= 10;
    } else {
      const ageMs = Date.now() - account.lastHeartbeatAt.getTime();

      if (ageMs > 24 * 60 * 60 * 1000) {
        score -= 10;
      }
    }

    if (account.lastLoginError) {
      score -= 10;
    }

    const normalizedScore = Math.max(0, Math.min(100, score));

    const status =
      normalizedScore >= 80
        ? 'HEALTHY'
        : normalizedScore >= 50
          ? 'WARNING'
          : 'CRITICAL';

    return {
      score: normalizedScore,
      status,
    };
  }

  async updateChannelStatus(
    id: string,
    status: SocialChannelStatus,
    lastError?: string,
  ) {
    await this.ensureChannel(id);

    const channel = await this.prisma.socialChannel.update({
      where: {
        id,
      },
      data: {
        status,
        lastError: lastError?.trim() || null,
        lastConnectedAt:
          status === SocialChannelStatus.CONNECTED ? new Date() : undefined,
      },
    });

    return this.sanitizeChannel(channel);
  }

  async listCalendarPosts(
    status?: ScheduledPostStatus,
    from?: string,
    to?: string,
    limit?: number,
  ) {
    const scheduledAt: {
      gte?: Date;
      lt?: Date;
    } = {};

    if (from) {
      const parsedFrom = new Date(from);

      if (!Number.isNaN(parsedFrom.getTime())) {
        scheduledAt.gte = parsedFrom;
      }
    }

    if (to) {
      const parsedTo = new Date(to);

      if (!Number.isNaN(parsedTo.getTime())) {
        scheduledAt.lt = parsedTo;
      }
    }

    const requestedLimit =
      Number.isFinite(limit) && Number(limit) > 0
        ? Math.floor(Number(limit))
        : 300;

    const safeLimit = Math.min(requestedLimit, 500);

    const posts = await this.prisma.scheduledPost.findMany({
      where: {
        ...(status
          ? {
              status,
            }
          : {}),
        ...(Object.keys(scheduledAt).length
          ? {
              scheduledAt,
            }
          : {}),
      },
      orderBy: {
        scheduledAt: 'asc',
      },
      take: safeLimit,
      select: {
        id: true,
        brandId: true,
        channelId: true,
        campaignId: true,
        platform: true,
        title: true,
        content: true,
        mediaUrls: true,
        scheduledAt: true,
        timezone: true,
        status: true,
        externalPostId: true,
        externalPostUrl: true,

        channel: {
          select: {
            id: true,
            name: true,
          },
        },

        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return posts.map((post) => ({
      ...post,

      // Defense in depth. API and database guards reject
      // inline/base64 payloads before they can be persisted.
      mediaUrls:
          post.mediaUrls?.filter(
            (url) => !url.startsWith("data:")
          ) ?? [],
    }));
  }

  async listPosts(
    status?: ScheduledPostStatus,
    from?: string,
    to?: string,
    limit?: number,
  ) {
    const scheduledAt: {
      gte?: Date;
      lt?: Date;
    } = {};

    if (from) {
      const parsedFrom = new Date(from);

      if (!Number.isNaN(parsedFrom.getTime())) {
        scheduledAt.gte = parsedFrom;
      }
    }

    if (to) {
      const parsedTo = new Date(to);

      if (!Number.isNaN(parsedTo.getTime())) {
        scheduledAt.lt = parsedTo;
      }
    }

    const requestedLimit =
      Number.isFinite(limit) && Number(limit) > 0
        ? Math.floor(Number(limit))
        : 300;

    const safeLimit = Math.min(requestedLimit, 500);

    const posts = await this.prisma.scheduledPost.findMany({
      where: {
        ...(status
          ? {
              status,
            }
          : {}),
        ...(Object.keys(scheduledAt).length
          ? {
              scheduledAt,
            }
          : {}),
      },
      orderBy: {
        scheduledAt: 'asc',
      },
      take: safeLimit,
      select: {
        id: true,
        brandId: true,
        channelId: true,
        campaignId: true,
        historyId: true,

        platform: true,
        title: true,
        content: true,

        scheduledAt: true,
        timezone: true,
        status: true,

        externalPostId: true,
        externalPostUrl: true,
        publishedAt: true,

        lastError: true,

        createdAt: true,
        updatedAt: true,

        channel: {
          select: {
            id: true,
            name: true,
            platform: true,
            brandId: true,
          },
        },

        brand: {
          select: {
            id: true,
            name: true,
          },
        },

        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return posts.map((post) => ({
      ...post,
      mediaUrls: [] as string[],
    }));
  }

  async getPost(id: string) {
    const post = await this.prisma.scheduledPost.findUnique({
      where: {
        id,
      },
      include: {
        channel: true,
        brand: true,
        campaign: true,
        history: true,
        attempts: {
          orderBy: {
            attemptNumber: 'desc',
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Scheduled post not found.');
    }

    return post;
  }

  private normalizeScheduledPostMediaUrls(
    mediaUrls?: string[],
  ) {
    if (mediaUrls === undefined) {
      return undefined;
    }

    const normalized = [
      ...new Set(
        mediaUrls
          .map((url) => url.trim())
          .filter(Boolean),
      ),
    ];

    if (normalized.length > 20) {
      throw new BadRequestException(
        'A scheduled post can contain at most 20 media URLs.',
      );
    }

    for (const url of normalized) {
      if (
        url.toLowerCase().startsWith('data:')
      ) {
        throw new BadRequestException(
          'Inline/base64 media is not allowed. Upload the asset first and store its URL.',
        );
      }

      if (url.length > 4096) {
        throw new BadRequestException(
          'Media URL is too large.',
        );
      }

      let parsed: URL;

      try {
        parsed = new URL(url);
      } catch {
        throw new BadRequestException(
          'Invalid media URL.',
        );
      }

      if (
        parsed.protocol !== 'http:' &&
        parsed.protocol !== 'https:'
      ) {
        throw new BadRequestException(
          'Media URL must use HTTP or HTTPS.',
        );
      }
    }

    return normalized;
  }

  async createPost(input: CreatePostInput) {
    if (!input.content?.trim()) {
      throw new BadRequestException('Content is required.');
    }

    const scheduledAt = new Date(input.scheduledAt);

    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('Invalid scheduledAt value.');
    }

    const channel = await this.prisma.socialChannel.findUnique({
      where: {
        id: input.channelId,
      },
    });

    if (!channel) {
      throw new NotFoundException('Social channel not found.');
    }

    if (channel.brandId !== input.brandId) {
      throw new BadRequestException('Channel does not belong to this brand.');
    }

    if (channel.platform !== input.platform) {
      throw new BadRequestException(
        'Channel platform does not match post platform.',
      );
    }

    return this.prisma.scheduledPost.create({
      data: {
        brandId: input.brandId,
        channelId: input.channelId,
        campaignId: input.campaignId || null,
        historyId: input.historyId || null,
        platform: input.platform,
        title: input.title?.trim() || null,
        content: input.content.trim(),
        mediaUrls:
          this.normalizeScheduledPostMediaUrls(
            input.mediaUrls,
          ) ?? [],
        scheduledAt,
        timezone: input.timezone || 'Asia/Kuala_Lumpur',
        status: input.status ?? ScheduledPostStatus.DRAFT,
      },
      include: {
        channel: true,
        brand: {
          select: {
            id: true,
            name: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async createMultiPlatformPosts(input: {
    brandId: string;
    campaignId?: string;
    historyId?: string;
    title?: string;
    contents: Partial<Record<SocialPlatform, string>>;
    mediaUrls?: Partial<Record<SocialPlatform, string[]>>;
    channelIds?: Partial<Record<SocialPlatform, string>>;
    platforms: SocialPlatform[];
    scheduledAt: string;
    timezone?: string;
    queueImmediately?: boolean;
  }) {
    if (!input.platforms?.length) {
      throw new BadRequestException('At least one platform is required.');
    }

    const uniquePlatforms = [...new Set(input.platforms)];

    const channels = await this.prisma.socialChannel.findMany({
      where: {
        brandId: input.brandId,
        platform: {
          in: uniquePlatforms,
        },
        status: SocialChannelStatus.CONNECTED,
      },
    });

    const channelByPlatform = new Map<
      SocialPlatform,
      (typeof channels)[number]
    >();

    for (const platform of uniquePlatforms) {
      const requestedChannelId = input.channelIds?.[platform]?.trim();

      const platformChannels = channels.filter(
        (channel) => channel.platform === platform,
      );

      if (requestedChannelId) {
        const requestedChannel = platformChannels.find(
          (channel) => channel.id === requestedChannelId,
        );

        if (!requestedChannel) {
          throw new BadRequestException(
            `Requested connected channel not found for ${platform}.`,
          );
        }

        channelByPlatform.set(platform, requestedChannel);

        continue;
      }

      if (platformChannels.length === 0) {
        throw new BadRequestException(
          `Connected channel missing for: ${platform}`,
        );
      }

      if (platformChannels.length > 1) {
        throw new BadRequestException(
          `Multiple connected channels found for ${platform}; channelId is required.`,
        );
      }

      channelByPlatform.set(platform, platformChannels[0]);
    }

    const createdPosts: Array<{
      id: string;
      platform: SocialPlatform;
      status: ScheduledPostStatus;
      scheduledAt: Date;
      channel: {
        id: string;
        name: string;
      };
    }> = [];

    for (const platform of uniquePlatforms) {
      const content = input.contents?.[platform]?.trim();

      if (!content) {
        throw new BadRequestException(`Content is required for ${platform}.`);
      }

      const channel = channelByPlatform.get(platform);

      if (!channel) {
        throw new BadRequestException(`Channel not found for ${platform}.`);
      }

      const post = await this.createPost({
        brandId: input.brandId,
        channelId: channel.id,
        campaignId: input.campaignId,
        historyId: input.historyId,
        platform,
        title: input.title,
        content,
        mediaUrls: input.mediaUrls?.[platform] ?? [],
        scheduledAt: input.scheduledAt,
        timezone: input.timezone,
        status: input.queueImmediately
          ? ScheduledPostStatus.QUEUED
          : ScheduledPostStatus.DRAFT,
      });

      createdPosts.push({
        id: post.id,
        platform: post.platform,
        status: post.status,
        scheduledAt: post.scheduledAt,
        channel: {
          id: post.channel.id,
          name: post.channel.name,
        },
      });
    }

    return {
      success: true,
      count: createdPosts.length,
      posts: createdPosts,
    };
  }

  async updatePost(id: string, input: UpdatePostInput) {
    const current = await this.getPost(id);

    if (current.status === ScheduledPostStatus.PUBLISHED) {
      throw new BadRequestException('Published posts cannot be edited.');
    }

    const scheduledAt = input.scheduledAt
      ? new Date(input.scheduledAt)
      : undefined;

    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('Invalid scheduledAt value.');
    }

    return this.prisma.scheduledPost.update({
      where: {
        id,
      },
      data: {
        title:
          input.title === undefined ? undefined : input.title.trim() || null,
        content: input.content === undefined ? undefined : input.content.trim(),
        mediaUrls:
          this.normalizeScheduledPostMediaUrls(
            input.mediaUrls,
          ),
        scheduledAt,
        timezone: input.timezone,
        status: input.status,
        campaignId:
          input.campaignId === undefined ? undefined : input.campaignId || null,
        historyId:
          input.historyId === undefined ? undefined : input.historyId || null,
        lastError:
          input.lastError !== undefined
            ? input.lastError
            : input.status !== undefined &&
                input.status !== ScheduledPostStatus.FAILED
              ? null
              : undefined,
      },
      include: {
        channel: true,
        brand: {
          select: {
            id: true,
            name: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async removePost(id: string) {
    const current = await this.getPost(id);

    if (current.status === ScheduledPostStatus.PUBLISHED) {
      throw new BadRequestException('Published posts cannot be deleted.');
    }

    await this.prisma.scheduledPost.delete({
      where: {
        id,
      },
    });

    return {
      deleted: true,
      id,
    };
  }

  async queuePost(id: string) {
    const current = await this.getPost(id);

    if (
      current.status !== ScheduledPostStatus.DRAFT &&
      current.status !== ScheduledPostStatus.SCHEDULED &&
      current.status !== ScheduledPostStatus.FAILED
    ) {
      throw new BadRequestException(
        'Only draft, scheduled or failed posts can be queued.',
      );
    }

    return this.prisma.scheduledPost.update({
      where: {
        id,
      },
      data: {
        status: ScheduledPostStatus.QUEUED,
        lastError: null,
      },
    });
  }

  async cancelPost(id: string) {
    const current = await this.getPost(id);

    if (current.status === ScheduledPostStatus.PUBLISHED) {
      throw new BadRequestException('Published posts cannot be cancelled.');
    }

    return this.prisma.scheduledPost.update({
      where: {
        id,
      },
      data: {
        status: ScheduledPostStatus.CANCELLED,
      },
    });
  }

  async getSettings() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found.');
    }

    return this.prisma.automationSetting.upsert({
      where: {
        workspaceId: workspace.id,
      },
      update: {},
      create: {
        workspaceId: workspace.id,
      },
    });
  }

  async updateSettings(input: {
    timezone?: string;
    approvalRequired?: boolean;
    autoPublishEnabled?: boolean;
    retryLimit?: number;
    retryDelayMinutes?: number;
    defaultFacebookTime?: string;
    defaultTelegramTime?: string;
  }) {
    const settings = await this.getSettings();

    return this.prisma.automationSetting.update({
      where: {
        id: settings.id,
      },
      data: input,
    });
  }

  private async ensureBrand(id: string) {
    const brand = await this.prisma.brand.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
      },
    });

    if (!brand) {
      throw new NotFoundException('Brand not found.');
    }
  }

  private async ensureChannel(id: string) {
    const channel = await this.prisma.socialChannel.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
      },
    });

    if (!channel) {
      throw new NotFoundException('Social channel not found.');
    }
  }

  async runPublisher() {
    return this.publisher.run();
  }

  async retryPost(id: string) {
    const post = await this.getPost(id);

    if (post.status !== ScheduledPostStatus.FAILED) {
      throw new BadRequestException('Only failed posts can be retried.');
    }

    return this.prisma.scheduledPost.update({
      where: {
        id,
      },
      data: {
        status: ScheduledPostStatus.QUEUED,
        lastError: null,
        scheduledAt: new Date(),
      },
      include: {
        channel: true,
        brand: {
          select: {
            id: true,
            name: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        history: {
          select: {
            id: true,
            topic: true,
            status: true,
          },
        },
        attempts: {
          orderBy: {
            attemptNumber: 'desc',
          },
        },
      },
    });
  }
}
