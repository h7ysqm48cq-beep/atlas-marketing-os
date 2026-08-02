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
