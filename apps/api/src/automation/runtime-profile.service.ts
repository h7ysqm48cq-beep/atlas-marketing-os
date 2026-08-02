import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SocialProxyType,
} from '../generated/prisma/enums';
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
