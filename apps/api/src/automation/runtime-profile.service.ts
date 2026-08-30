import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SocialProxyType,
} from '../generated/prisma/enums';
import {
  get as httpsGet,
  type Agent as HttpsAgent,
} from 'node:https';
import {
  HttpsProxyAgent,
} from 'https-proxy-agent';
import {
  SocksProxyAgent,
} from 'socks-proxy-agent';
import { PrismaService } from '../database/prisma.service';
import { SocialTokenCryptoService } from '../common/social-token-crypto.service';

type UpdateRuntimeProfileInput = {
  browserProfileName?: string;
  locale?: string;
  timezone?: string;

  proxyType?: SocialProxyType;
  proxyHost?: string | null;
  proxyPort?: number | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
  proxyCountry?: string | null;
};

@Injectable()
export class RuntimeProfileService {
  constructor(
    private readonly prisma:
      PrismaService,
    private readonly socialTokenCrypto:
      SocialTokenCryptoService,
  ) {}

  async ensureForChannel(
    channelId: string,
    channelName?: string,
  ) {
    const channel =
      await this.ensureChannel(
        channelId,
      );

    const resolvedName =
      channelName?.trim() ||
      channel.name;

    return this.prisma
      .socialChannelRuntimeProfile
      .upsert({
        where: {
          channelId,
        },
        create: {
          channelId,
          browserProfileKey:
            this.buildProfileKey(
              channelId,
            ),
          browserProfileName:
            `${resolvedName} Browser`,
          locale:
            'en-MY',
          timezone:
            'Asia/Kuala_Lumpur',
          proxyType:
            SocialProxyType.DIRECT,
        },
        update: {},
      });
  }

  async backfillMissingProfiles() {
    const channels =
      await this.prisma
        .socialChannel
        .findMany({
          where: {
            socialChannelRuntimeProfile:
              null,
          },
          select: {
            id: true,
            name: true,
            platform: true,
          },
        });

    const created: Array<{
      channelId: string;
      channelName: string;
      platform: string;
      profileId: string;
      browserProfileKey: string;
    }> = [];

    for (
      const channel
      of channels
    ) {
      const profile =
        await this.ensureForChannel(
          channel.id,
          channel.name,
        );

      created.push({
        channelId:
          channel.id,
        channelName:
          channel.name,
        platform:
          channel.platform,
        profileId:
          profile.id,
        browserProfileKey:
          profile.browserProfileKey,
      });
    }

    return {
      createdCount:
        created.length,
      created,
    };
  }


  async getForChannel(
    channelId: string,
  ) {
    const channel =
      await this.ensureChannel(
        channelId,
      );

    const profile =
      await this.prisma
        .socialChannelRuntimeProfile
        .findUnique({
          where: {
            channelId,
          },
        });

    if (!profile) {
      return {
        exists: false,
        channel: {
          id: channel.id,
          name: channel.name,
          platform:
            channel.platform,
        },
        profile:
          this.defaultProfile(
            channel.id,
            channel.name,
          ),
      };
    }

    return {
      exists: true,
      channel: {
        id: channel.id,
        name: channel.name,
        platform:
          channel.platform,
      },
      profile:
        this.sanitizeProfile(
          profile,
        ),
    };
  }

  async upsertForChannel(
    channelId: string,
    input:
      UpdateRuntimeProfileInput,
  ) {
    const channel =
      await this.ensureChannel(
        channelId,
      );

    const proxyType =
      input.proxyType ??
      SocialProxyType.DIRECT;

    const browserProfileName =
      input.browserProfileName
        ?.trim() ||
      `${channel.name} Browser`;

    const locale =
      input.locale?.trim() ||
      'en-MY';

    const timezone =
      input.timezone?.trim() ||
      'Asia/Kuala_Lumpur';

    this.validateProxyInput(
      proxyType,
      input,
    );

    const proxyUsername =
      this.resolveEncryptedSecret(
        input.proxyUsername,
      );

    const proxyPassword =
      this.resolveEncryptedSecret(
        input.proxyPassword,
      );

    const directMode =
      proxyType ===
      SocialProxyType.DIRECT;

    const profile =
      await this.prisma
        .socialChannelRuntimeProfile
        .upsert({
          where: {
            channelId,
          },
          create: {
            channelId,
            browserProfileKey:
              this.buildProfileKey(
                channelId,
              ),
            browserProfileName,
            locale,
            timezone,
            proxyType,
            proxyHost:
              directMode
                ? null
                : input.proxyHost
                    ?.trim() ||
                  null,
            proxyPort:
              directMode
                ? null
                : input.proxyPort ??
                  null,
            proxyUsernameEncrypted:
              directMode
                ? null
                : proxyUsername,
            proxyPasswordEncrypted:
              directMode
                ? null
                : proxyPassword,
            proxyCountry:
              directMode
                ? null
                : input.proxyCountry
                    ?.trim() ||
                  null,
            lastConnectionStatus:
              null,
            lastConnectionError:
              null,
          },
          update: {
            browserProfileName,
            locale,
            timezone,
            proxyType,
            proxyHost:
              directMode
                ? null
                : input.proxyHost ===
                    undefined
                  ? undefined
                  : input.proxyHost
                      ?.trim() ||
                    null,
            proxyPort:
              directMode
                ? null
                : input.proxyPort ===
                    undefined
                  ? undefined
                  : input.proxyPort,
            proxyUsernameEncrypted:
              directMode
                ? null
                : proxyUsername ===
                    undefined
                  ? undefined
                  : proxyUsername,
            proxyPasswordEncrypted:
              directMode
                ? null
                : proxyPassword ===
                    undefined
                  ? undefined
                  : proxyPassword,
            proxyCountry:
              directMode
                ? null
                : input.proxyCountry ===
                    undefined
                  ? undefined
                  : input.proxyCountry
                      ?.trim() ||
                    null,
            lastConnectionStatus:
              null,
            lastConnectionError:
              null,
          },
        });

    return {
      exists: true,
      channel: {
        id: channel.id,
        name: channel.name,
        platform:
          channel.platform,
      },
      profile:
        this.sanitizeProfile(
          profile,
        ),
    };
  }

  private normalizeBrowserAccountState(
    value?: string | null,
  ) {
    return String(
      value || 'UNKNOWN',
    )
      .trim()
      .toUpperCase();
  }


  private async getLinkedBrowserAccountSelection(
    channelId: string,
  ) {
    const links =
      await this.prisma
        .browserAccountChannel
        .findMany({
          where: {
            channelId,
          },
          orderBy: [
            {
              isPrimary:
                'desc',
            },
            {
              createdAt:
                'asc',
            },
          ],
          include: {
            browserAccount:
              true,
          },
        });

    const readyLink =
      links.find(
        (link) => {
          const account =
            link.browserAccount;

          const loginStatus =
            this.normalizeBrowserAccountState(
              account.loginStatus,
            );

          const cookieStatus =
            this.normalizeBrowserAccountState(
              account.cookieStatus,
            );

          return (
            loginStatus ===
              'LOGGED_IN' &&
            cookieStatus ===
              'ACTIVE'
          );
        },
      ) || null;

    /*
     * Runtime preference:
     *
     * 1. A READY account.
     * 2. Otherwise the primary/first account,
     *    so the user can still open it manually
     *    and repair its Facebook login.
     */
    const preferredLink =
      readyLink ||
      links[0] ||
      null;

    return {
      links,
      readyLink,
      preferredLink,
    };
  }


  async getBrowserPublishingSafety(
    channelId: string,
  ) {
    const channel =
      await this.ensureChannel(
        channelId,
      );

    const {
      links,
      readyLink,
    } =
      await this
        .getLinkedBrowserAccountSelection(
          channelId,
        );

    const candidates =
      links.map(
        (link) => {
          const account =
            link.browserAccount;

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
              this.normalizeBrowserAccountState(
                account.loginStatus,
              ),

            cookieStatus:
              this.normalizeBrowserAccountState(
                account.cookieStatus,
              ),

            proxyType:
              account.proxyType,

            proxyCountry:
              account.proxyCountry,

            lastKnownIp:
              account.lastKnownIp,

            lastVerifiedAt:
              account.lastVerifiedAt,

            lastHeartbeatAt:
              account.lastHeartbeatAt,

            lastLoginError:
              account.lastLoginError,

            isPrimary:
              link.isPrimary,
          };
        },
      );

    /*
     * No BrowserAccount link means this is still a
     * legacy/native channel. Do not unexpectedly
     * block those channels in Safety Gate v1.
     */
    if (!links.length) {
      return {
        hasLinkedAccounts:
          false,

        allowed:
          true,

        reason:
          'NO_LINKED_BROWSER_ACCOUNT',

        channel: {
          id:
            channel.id,

          name:
            channel.name,

          platform:
            channel.platform,
        },

        selected:
          null,

        candidates,
      };
    }

    if (!readyLink) {
      return {
        hasLinkedAccounts:
          true,

        allowed:
          false,

        reason:
          'NO_READY_BROWSER_ACCOUNT',

        channel: {
          id:
            channel.id,

          name:
            channel.name,

          platform:
            channel.platform,
        },

        selected:
          null,

        candidates,
      };
    }

    const account =
      readyLink.browserAccount;

    return {
      hasLinkedAccounts:
        true,

      allowed:
        true,

      reason:
        'READY_BROWSER_ACCOUNT',

      channel: {
        id:
          channel.id,

        name:
          channel.name,

        platform:
          channel.platform,
      },

      selected: {
        id:
          account.id,

        displayName:
          account.displayName,

        browserProfileKey:
          account.browserProfileKey,

        browserProfileName:
          account.browserProfileName,

        loginStatus:
          this.normalizeBrowserAccountState(
            account.loginStatus,
          ),

        cookieStatus:
          this.normalizeBrowserAccountState(
            account.cookieStatus,
          ),

        proxyType:
          account.proxyType,

        proxyCountry:
          account.proxyCountry,

        lastKnownIp:
          account.lastKnownIp,

        lastVerifiedAt:
          account.lastVerifiedAt,

        lastHeartbeatAt:
          account.lastHeartbeatAt,

        isPrimary:
          readyLink.isPrimary,
      },

      candidates,
    };
  }


  /*
   * FACEBOOK_PAGE_PUBLISH_TARGET_V1
   *
   * Browser publishing must target the SocialChannel
   * Facebook Page, never the Browser Account owner's
   * personal Facebook home composer.
   */
  async getFacebookPublishingTarget(
    channelId: string,
  ) {
    const channel =
      await this.prisma
        .socialChannel
        .findUnique({
          where: {
            id:
              channelId,
          },
          select: {
            id: true,
            name: true,
            platform: true,
            externalId: true,
            username: true,
          },
        });

    if (!channel) {
      throw new NotFoundException(
        'Social channel was not found.',
      );
    }

    if (
      String(
        channel.platform,
      ).toUpperCase() !==
      'FACEBOOK'
    ) {
      throw new BadRequestException(
        'Facebook publishing target requires a Facebook channel.',
      );
    }

    const username =
      channel.username
        ?.trim() ||
      '';

    const pageId =
      channel.externalId
        ?.trim() ||
      '';

    const targetUrl =
      pageId
        ? (
            'https://www.facebook.com/profile.php?id=' +
            encodeURIComponent(
              pageId,
            )
          )
        : username
          ? (
              'https://www.facebook.com/' +
              encodeURIComponent(
                username,
              ) +
              '/'
            )
          : null;

    if (!targetUrl) {
      throw new BadRequestException(
        [
          'Facebook channel',
          channel.name,
          'does not have a Page username or Page ID.',
        ].join(' '),
      );
    }

    return {
      channelId:
        channel.id,

      channelName:
        channel.name,

      pageId:
        pageId || null,

      username:
        username || null,

      targetUrl,
    };
  }


  async getBrowserLaunchProfile(
    channelId: string,
  ) {
    const channel =
      await this.ensureChannel(
        channelId,
      );

    const {
      preferredLink,
    } =
      await this
        .getLinkedBrowserAccountSelection(
          channelId,
        );

    /*
     * BrowserAccount is now the authoritative
     * persistent browser identity whenever one
     * is linked to this channel.
     */
    if (preferredLink) {
      const account =
        preferredLink
          .browserAccount;

      return {
        channelId,

        browserAccountId:
          account.id,

        source: 'BROWSER_ACCOUNT' as const,

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
          account
            .proxyUsernameEncrypted
            ? this.socialTokenCrypto
                .decrypt(
                  account
                    .proxyUsernameEncrypted,
                )
            : null,

        proxyPassword:
          account
            .proxyPasswordEncrypted
            ? this.socialTokenCrypto
                .decrypt(
                  account
                    .proxyPasswordEncrypted,
                )
            : null,

        headless:
          false,

        startUrl:
          'https://www.facebook.com/',
      };
    }

    /*
     * Backwards-compatible fallback for channels
     * that have not yet been linked to the new
     * Browser Account system.
     */
    const profile =
      await this.ensureForChannel(
        channelId,
        channel.name,
      );

    return {
      channelId,

      browserAccountId:
        null,

      source: 'LEGACY_RUNTIME_PROFILE' as const,

      browserProfileKey:
        profile.browserProfileKey,

      browserProfileName:
        profile.browserProfileName,

      locale:
        profile.locale,

      timezone:
        profile.timezone,

      proxyType:
        profile.proxyType,

      proxyHost:
        profile.proxyHost,

      proxyPort:
        profile.proxyPort,

      proxyUsername:
        profile
          .proxyUsernameEncrypted
          ? this.socialTokenCrypto
              .decrypt(
                profile
                  .proxyUsernameEncrypted,
              )
          : null,

      proxyPassword:
        profile
          .proxyPasswordEncrypted
          ? this.socialTokenCrypto
              .decrypt(
                profile
                  .proxyPasswordEncrypted,
              )
          : null,
    };
  }


  async getPublishNetwork(
    channelId: string,
    options?: {
      nativeApiOnly?: boolean;
    },
  ): Promise<{
    proxyType:
      | 'DIRECT'
      | 'HTTP'
      | 'HTTPS'
      | 'SOCKS5';

    proxyUrl:
      string | null;

    locale:
      string;

    timezone:
      string;

    browserProfileKey:
      string | null;

    browserAccountId:
      string | null;

    source:
      | 'BROWSER_ACCOUNT'
      | 'LEGACY_RUNTIME_PROFILE'
      | 'NONE';
  }> {
    await this.ensureChannel(
      channelId,
    );

    if (
      options?.nativeApiOnly
    ) {
      return {
        proxyType:
          'DIRECT',
        proxyUrl:
          null,
        locale:
          'en-MY',
        timezone:
          'Asia/Kuala_Lumpur',
        browserProfileKey:
          null,
        browserAccountId:
          null,
        source:
          'NONE',
      };
    }

    const {
      preferredLink,
    } =
      await this
        .getLinkedBrowserAccountSelection(
          channelId,
        );

    if (preferredLink) {
      const account =
        preferredLink
          .browserAccount;

      let proxyUrl:
        string | null =
        null;

      if (
        account.proxyType !==
          SocialProxyType.DIRECT &&
        account.proxyType !==
          SocialProxyType.SOCKS5
      ) {
        proxyUrl =
          this.buildProxyUrl(
            account,
          );
      }

      return {
        proxyType:
          account.proxyType,

        proxyUrl,

        locale:
          account.locale,

        timezone:
          account.timezone,

        browserProfileKey:
          account.browserProfileKey,

        browserAccountId:
          account.id,

        source:
          'BROWSER_ACCOUNT',
      };
    }

    const profile =
      await this.prisma
        .socialChannelRuntimeProfile
        .findUnique({
          where: {
            channelId,
          },
        });

    if (!profile) {
      return {
        proxyType:
          'DIRECT',

        proxyUrl:
          null,

        locale:
          'en-MY',

        timezone:
          'Asia/Kuala_Lumpur',

        browserProfileKey:
          null,

        browserAccountId:
          null,

        source:
          'NONE',
      };
    }

    if (
      profile.proxyType ===
      SocialProxyType.DIRECT
    ) {
      return {
        proxyType:
          'DIRECT',

        proxyUrl:
          null,

        locale:
          profile.locale,

        timezone:
          profile.timezone,

        browserProfileKey:
          profile.browserProfileKey,

        browserAccountId:
          null,

        source:
          'LEGACY_RUNTIME_PROFILE',
      };
    }

    if (
      profile.proxyType ===
      SocialProxyType.SOCKS5
    ) {
      return {
        proxyType:
          'SOCKS5',

        proxyUrl:
          null,

        locale:
          profile.locale,

        timezone:
          profile.timezone,

        browserProfileKey:
          profile.browserProfileKey,

        browserAccountId:
          null,

        source:
          'LEGACY_RUNTIME_PROFILE',
      };
    }

    const proxyUrl =
      this.buildProxyUrl(
        profile,
      );

    return {
      proxyType:
        profile.proxyType,

      proxyUrl,

      locale:
        profile.locale,

      timezone:
        profile.timezone,

      browserProfileKey:
        profile.browserProfileKey,

      browserAccountId:
        null,

      source:
        'LEGACY_RUNTIME_PROFILE',
    };
  }


  async testProxy(
    channelId: string,
  ) {
    await this.ensureChannel(
      channelId,
    );

    const profile =
      await this.prisma
        .socialChannelRuntimeProfile
        .findUnique({
          where: {
            channelId,
          },
        });

    if (!profile) {
      throw new BadRequestException(
        'Save the runtime profile before testing the connection.',
      );
    }

    const startedAt =
      Date.now();

    try {
      const proxyUrl =
        this.buildProxyUrl(
          profile,
        );

      const result =
        await this.fetchPublicIp(
          proxyUrl,
        );

      const latencyMs =
        Date.now() -
        startedAt;

      const updated =
        await this.prisma
          .socialChannelRuntimeProfile
          .update({
            where: {
              channelId,
            },
            data: {
              lastKnownIp:
                result.ip,
              lastConnectionStatus:
                'CONNECTED',
              lastConnectionError:
                null,
              lastConnectionTestAt:
                new Date(),
            },
          });

      return {
        success: true,
        connection: {
          mode:
            profile.proxyType,
          ip:
            result.ip,
          latencyMs,
          testedAt:
            updated
              .lastConnectionTestAt,
        },
        profile:
          this.sanitizeProfile(
            updated,
          ),
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Proxy connection test failed.';

      const updated =
        await this.prisma
          .socialChannelRuntimeProfile
          .update({
            where: {
              channelId,
            },
            data: {
              lastConnectionStatus:
                'ERROR',
              lastConnectionError:
                message.slice(
                  0,
                  500,
                ),
              lastConnectionTestAt:
                new Date(),
            },
          });

      throw new BadRequestException({
        message:
          'Proxy connection test failed.',
        details:
          message,
        profile:
          this.sanitizeProfile(
            updated,
          ),
      });
    }
  }

  private buildProxyUrl(
    profile: {
      proxyType:
        SocialProxyType;
      proxyHost:
        string | null;
      proxyPort:
        number | null;
      proxyUsernameEncrypted:
        string | null;
      proxyPasswordEncrypted:
        string | null;
    },
  ) {
    if (
      profile.proxyType ===
      SocialProxyType.DIRECT
    ) {
      return null;
    }

    const host =
      profile.proxyHost?.trim();

    const port =
      profile.proxyPort;

    if (!host || !port) {
      throw new BadRequestException(
        'Proxy host and port are required.',
      );
    }

    const protocolMap:
      Record<
        Exclude<
          SocialProxyType,
          'DIRECT'
        >,
        string
      > = {
        HTTP: 'http',
        HTTPS: 'https',
        SOCKS5: 'socks5',
      };

    const protocol =
      protocolMap[
        profile.proxyType
      ];

    const username =
      profile
        .proxyUsernameEncrypted
        ? this.socialTokenCrypto
            .decrypt(
              profile
                .proxyUsernameEncrypted,
            )
        : '';

    const password =
      profile
        .proxyPasswordEncrypted
        ? this.socialTokenCrypto
            .decrypt(
              profile
                .proxyPasswordEncrypted,
            )
        : '';

    const credentials =
      username
        ? `${encodeURIComponent(
            username,
          )}:${encodeURIComponent(
            password,
          )}@`
        : '';

    return [
      `${protocol}://`,
      credentials,
      host,
      ':',
      String(port),
    ].join('');
  }

  private fetchPublicIp(
    proxyUrl: string | null,
  ): Promise<{
    ip: string;
  }> {
    return new Promise(
      (resolve, reject) => {
        let agent:
          HttpsAgent | undefined;

        if (proxyUrl) {
          const protocol =
            new URL(
              proxyUrl,
            ).protocol;

          agent =
            protocol === 'socks5:'
              ? new SocksProxyAgent(
                  proxyUrl,
                )
              : new HttpsProxyAgent(
                  proxyUrl,
                );
        }

        const request =
          httpsGet(
            'https://api.ipify.org?format=json',
            {
              agent,
              timeout:
                15000,
              headers: {
                Accept:
                  'application/json',
                'User-Agent':
                  'Atlas-Marketing-OS/1.0',
              },
            },
            (response) => {
              let body = '';

              response.setEncoding(
                'utf8',
              );

              response.on(
                'data',
                (chunk) => {
                  body += chunk;
                },
              );

              response.on(
                'end',
                () => {
                  if (
                    !response.statusCode ||
                    response.statusCode <
                      200 ||
                    response.statusCode >=
                      300
                  ) {
                    reject(
                      new Error(
                        `IP service returned HTTP ${response.statusCode ?? 'unknown'}.`,
                      ),
                    );
                    return;
                  }

                  try {
                    const parsed =
                      JSON.parse(
                        body,
                      ) as {
                        ip?: string;
                      };

                    if (
                      !parsed.ip
                        ?.trim()
                    ) {
                      throw new Error(
                        'No public IP was returned.',
                      );
                    }

                    resolve({
                      ip:
                        parsed.ip.trim(),
                    });
                  } catch (
                    parseError
                  ) {
                    reject(
                      parseError instanceof
                        Error
                        ? parseError
                        : new Error(
                            'Invalid IP service response.',
                          ),
                    );
                  }
                },
              );
            },
          );

        request.on(
          'timeout',
          () => {
            request.destroy(
              new Error(
                'Proxy connection timed out after 15 seconds.',
              ),
            );
          },
        );

        request.on(
          'error',
          reject,
        );
      },
    );
  }


  private async ensureChannel(
    channelId: string,
  ) {
    const channel =
      await this.prisma
        .socialChannel
        .findUnique({
          where: {
            id: channelId,
          },
          select: {
            id: true,
            name: true,
            platform: true,
          },
        });

    if (!channel) {
      throw new NotFoundException(
        'Social channel not found.',
      );
    }

    return channel;
  }

  private validateProxyInput(
    proxyType: SocialProxyType,
    input:
      UpdateRuntimeProfileInput,
  ) {
    if (
      proxyType ===
      SocialProxyType.DIRECT
    ) {
      return;
    }

    if (
      input.proxyHost !==
        undefined &&
      !input.proxyHost?.trim()
    ) {
      throw new BadRequestException(
        'Proxy host cannot be empty.',
      );
    }

    if (
      input.proxyPort !== undefined &&
      input.proxyPort !== null &&
      (
        !Number.isInteger(
          input.proxyPort,
        ) ||
        input.proxyPort < 1 ||
        input.proxyPort > 65535
      )
    ) {
      throw new BadRequestException(
        'Proxy port must be between 1 and 65535.',
      );
    }
  }

  private resolveEncryptedSecret(
    value?: string | null,
  ) {
    if (value === undefined) {
      return undefined;
    }

    const cleanValue =
      value?.trim();

    if (!cleanValue) {
      return null;
    }

    return this.socialTokenCrypto
      .encrypt(cleanValue);
  }

  private buildProfileKey(
    channelId: string,
  ) {
    return `channel-${channelId}`;
  }

  private defaultProfile(
    channelId: string,
    channelName: string,
  ) {
    return {
      id: null,
      channelId,
      browserProfileKey:
        this.buildProfileKey(
          channelId,
        ),
      browserProfileName:
        `${channelName} Browser`,
      locale: 'en-MY',
      timezone:
        'Asia/Kuala_Lumpur',
      proxyType:
        SocialProxyType.DIRECT,
      proxyHost: null,
      proxyPort: null,
      proxyCountry: null,
      hasProxyUsername:
        false,
      hasProxyPassword:
        false,
      lastKnownIp: null,
      lastConnectionStatus:
        null,
      lastConnectionError:
        null,
      lastConnectionTestAt:
        null,
    };
  }

  private sanitizeProfile<
    T extends {
      proxyUsernameEncrypted:
        string | null;
      proxyPasswordEncrypted:
        string | null;
    },
  >(profile: T) {
    const {
      proxyUsernameEncrypted,
      proxyPasswordEncrypted,
      ...safeProfile
    } = profile;

    return {
      ...safeProfile,
      hasProxyUsername:
        Boolean(
          proxyUsernameEncrypted,
        ),
      hasProxyPassword:
        Boolean(
          proxyPasswordEncrypted,
        ),
    };
  }
}
