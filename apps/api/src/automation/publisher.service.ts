import {
  Injectable,
  Logger,
} from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";
import { SocialTokenCryptoService } from "../common/social-token-crypto.service";

import {
  ScheduledPostStatus,
  PublishAttemptStatus,
  SocialPlatform,
  ContentStatus,
} from "../generated/prisma/enums";

import { FacebookConnectorService } from "./facebook-connector.service";
import { TelegramConnectorService } from "./telegram-connector.service";
import { RuntimeProfileService } from "./runtime-profile.service";
import { BrowserRuntimeBridgeService } from "./browser-runtime-bridge.service";

@Injectable()
export class PublisherService {

  private readonly logger =
    new Logger(PublisherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facebook: FacebookConnectorService,
    private readonly telegram: TelegramConnectorService,
    private readonly socialTokenCrypto:
      SocialTokenCryptoService,
    private readonly runtimeProfiles:
      RuntimeProfileService,
    private readonly browserRuntime:
      BrowserRuntimeBridgeService,
  ) {}

  private buildFacebookPostUrl(
    externalPostId?: string | null,
  ) {
    const cleanId =
      externalPostId?.trim();

    if (!cleanId) {
      return null;
    }

    const separatorIndex =
      cleanId.indexOf("_");

    if (separatorIndex < 0) {
      return null;
    }

    const pageId =
      cleanId.slice(0, separatorIndex);

    const postId =
      cleanId.slice(separatorIndex + 1);

    if (!pageId || !postId) {
      return null;
    }

    return `https://www.facebook.com/${pageId}/posts/${postId}`;
  }


  async run() {

    const diagnosticPost =
      await this.prisma.scheduledPost.findUnique({
        where: {
          id: "cmsdhf6fi0002p69kx0ef5b08",
        },
        select: {
          id: true,
          status: true,
          scheduledAt: true,
        },
      });

    this.logger.warn(
      [
        "Publisher diagnostic.",
        `Now: ${new Date().toISOString()}.`,
        `Post: ${JSON.stringify(diagnosticPost)}.`,
      ].join(" "),
    );

    const posts =
      await this.prisma.scheduledPost.findMany({
        where: {
          status: {
            in: [
              ScheduledPostStatus.SCHEDULED,
              ScheduledPostStatus.QUEUED,
            ],
          },
          scheduledAt: {
            lte: new Date(),
          },
        },
        include: {
          channel: {
            include: {
              socialChannelRuntimeProfile:
                true,
            },
          },
        },
      });

    this.logger.log(
      `Found ${posts.length} scheduled post(s).`,
    );

    let published = 0;

    for (const post of posts) {

      /*
       * Atomically claim this post before publishing.
       *
       * Multiple scheduler/manual runs may discover the same post,
       * but only one process can change an eligible status to
       * PUBLISHING.
       */
      const claimResult =
        await this.prisma.scheduledPost.updateMany({
          where: {
            id: post.id,
            status: {
              in: [
                ScheduledPostStatus.SCHEDULED,
                ScheduledPostStatus.QUEUED,
              ],
            },
          },
          data: {
            status:
              ScheduledPostStatus.PUBLISHING,
          },
        });

      if (claimResult.count !== 1) {
        this.logger.warn(
          [
            "Skipped post because it was already claimed.",
            `Post: ${post.id}.`,
            `Previous status: ${post.status}.`,
          ].join(" "),
        );

        continue;
      }

      this.logger.log(
        [
          "Publisher lock acquired.",
          `Post: ${post.id}.`,
          `Platform: ${post.platform}.`,
        ].join(" "),
      );

      const runtimeProfile =
        post.channel
          .socialChannelRuntimeProfile;

      const runtimeContext = {
        channelId:
          post.channel.id,
        channelName:
          post.channel.name,
        platform:
          post.platform,
        browserProfileId:
          runtimeProfile?.id ??
          null,
        browserProfileKey:
          runtimeProfile
            ?.browserProfileKey ??
          null,
        browserProfileName:
          runtimeProfile
            ?.browserProfileName ??
          null,
        locale:
          runtimeProfile?.locale ??
          null,
        timezone:
          runtimeProfile?.timezone ??
          post.timezone,
        proxyType:
          runtimeProfile
            ?.proxyType ??
          'DIRECT',
        proxyHostConfigured:
          Boolean(
            runtimeProfile
              ?.proxyHost,
          ),
        proxyPortConfigured:
          Boolean(
            runtimeProfile
              ?.proxyPort,
          ),
        proxyCredentialsConfigured:
          Boolean(
            runtimeProfile
              ?.proxyUsernameEncrypted ||
            runtimeProfile
              ?.proxyPasswordEncrypted,
          ),
        proxyCountry:
          runtimeProfile
            ?.proxyCountry ??
          null,
        lastKnownIp:
          runtimeProfile
            ?.lastKnownIp ??
          null,
      };

      const attempt =
        await this.prisma.publishAttempt.create({
          data: {
            scheduledPostId:
              post.id,
            attemptNumber:
              post.retryCount + 1,
            status:
              PublishAttemptStatus.PENDING,
            requestPayload: {
              runtime:
                runtimeContext,
              contentLength:
                post.content.length,
              mediaCount:
                post.mediaUrls.length,
              scheduledAt:
                post.scheduledAt
                  .toISOString(),
            },
          },
        });

      try {

        let result: any = null;

        if (
          post.platform ===
          SocialPlatform.FACEBOOK
        ) {

          const publishNetwork =
            await this.runtimeProfiles
              .getPublishNetwork(
                post.channel.id,
              );

          if (
            publishNetwork.proxyType ===
            'SOCKS5'
          ) {
            throw new Error(
              [
                'SOCKS5 publishing requires',
                'the Browser Runtime.',
                'Use DIRECT, HTTP or HTTPS',
                'for Facebook Native API publishing.',
              ].join(' '),
            );
          }

          const pageId =
            post.channel.externalId?.trim();

          const encryptedToken =
            post.channel
              .accessTokenEncrypted
              ?.trim();

          if (!pageId) {
            throw new Error(
              [
                `Facebook channel ${post.channel.id}`,
                `(${post.channel.name})`,
                "does not have a Page ID.",
              ].join(" "),
            );
          }

          if (!encryptedToken) {
            throw new Error(
              [
                `Facebook channel ${post.channel.id}`,
                `(${post.channel.name})`,
                "does not have an access token.",
              ].join(" "),
            );
          }

          if (
            post.channel.tokenExpiresAt &&
            post.channel.tokenExpiresAt <=
              new Date()
          ) {
            throw new Error(
              [
                `Facebook access token for`,
                `${post.channel.name}`,
                `expired at`,
                post.channel
                  .tokenExpiresAt
                  .toISOString(),
              ].join(" "),
            );
          }

          const accessToken =
            this.socialTokenCrypto.decrypt(
              encryptedToken,
            );

          if (
            runtimeContext.browserProfileKey
          ) {
            this.logger.log(
              [
                "Using Browser Runtime Facebook publisher.",
                "Profile:",
                runtimeContext.browserProfileKey,
              ].join(" "),
            );

            if (
              post.mediaUrls.length > 0
            ) {
              this.logger.warn(
                [
                  "Browser Runtime scheduled publishing",
                  "currently prepares text only.",
                  `Post: ${post.id}.`,
                  `Remote media count: ${post.mediaUrls.length}.`,
                ].join(" "),
              );
            }

            const prepareResult =
              await this.browserRuntime
                .prepareFacebookPostForChannel(
                  post.channel.id,
                  {
                    caption:
                      post.content,
                    imagePath:
                      null,
                  },
                );

            const prepared =
              prepareResult as {
                success?: boolean;
                readyForReview?: boolean;
                captionFilled?: boolean;
              };

            if (
              prepared.success === false ||
              prepared.readyForReview === false
            ) {
              throw new Error(
                "Facebook draft preparation failed.",
              );
            }

            this.logger.log(
              [
                "Facebook draft prepared.",
                `Post: ${post.id}.`,
                `Caption filled: ${
                  prepared.captionFilled !== false
                }.`,
              ].join(" "),
            );

            result =
              await this.browserRuntime
                .publishFacebookPost(
                  post.channel.id,
                  "PUBLISH",
                );

            const browserPublishResult =
              result as {
                success?: boolean;
                published?: boolean;
                verification?: {
                  status?: string;
                };
              };

            const verificationStatus =
              browserPublishResult
                .verification
                ?.status;

            const publishConfirmed =
              browserPublishResult
                .published === true &&
              (
                verificationStatus ===
                  "CONFIRMED" ||
                verificationStatus ===
                  "COMPOSER_CLOSED"
              );

            if (!publishConfirmed) {
              throw new Error(
                [
                  "Browser Runtime Facebook publishing",
                  "was not confirmed.",
                  `Verification: ${
                    verificationStatus ??
                    "UNKNOWN"
                  }.`,
                ].join(" "),
              );
            }

          } else {
            result =
              await this.facebook.publish({
                pageId,
                accessToken,
                message: post.content,
                mediaUrls:
                  post.mediaUrls,
                proxyUrl:
                  publishNetwork.proxyUrl,
              });
          }

        } else if (
          post.platform ===
          SocialPlatform.TELEGRAM
        ) {

          const chatId =
            post.channel.externalId?.trim();

          const encryptedToken =
            post.channel.accessTokenEncrypted?.trim();

          if (!chatId || !encryptedToken) {
            throw new Error(
              `Telegram credentials are incomplete for ${post.channel.name}.`,
            );
          }

          const botToken =
            this.socialTokenCrypto.decrypt(encryptedToken);

          result =
            await this.telegram.publish(
              post.content,
              post.mediaUrls,
              { botToken, chatId },
            );

        } else {

          throw new Error(
            `Unsupported social platform: ${post.platform}`,
          );

        }

        this.logger.log(
          [
            `Publish succeeded.`,
            `Post: ${post.id}.`,
            `Platform: ${post.platform}.`,
            `Runtime: ${
              runtimeContext
                .browserProfileKey ??
              'none'
            }.`,
            `Proxy: ${
              runtimeContext.proxyType
            }.`,
            `External ID: ${
              result?.postId ??
              result?.post_id ??
              result?.id ??
              result?.messageId ??
              result?.message_id ??
              "none"
            }.`,
          ].join(" "),
        );

        await this.prisma.publishAttempt.update({
          where: {
            id: attempt.id,
          },
          data: {
            status:
              PublishAttemptStatus.SUCCESS,
            responsePayload: result,
            completedAt:
              new Date(),
          },
        });

        await this.prisma.scheduledPost.update({
          where: {
            id: post.id,
          },
          data: {
            status:
              ScheduledPostStatus.PUBLISHED,
            publishedAt:
              new Date(),
            retryCount:
              post.retryCount + 1,
            externalPostId:
              result?.postId ??
              result?.post_id ??
              result?.id ??
              result?.messageId?.toString() ??
              result?.message_id?.toString() ??
              null,
            externalPostUrl:
              post.platform === SocialPlatform.FACEBOOK
                ? this.buildFacebookPostUrl(
                    result?.postId ??
                      result?.post_id ??
                      result?.id ??
                      null,
                  )
                : null,
          },
        });

        if (post.historyId) {
          await this.syncHistoryPublishedStatus(
            post.historyId,
          );
        }


        published++;

      } catch (e: any) {

        const errorMessage =
          e?.message ??
          "Unknown Error";

        const responseData =
          e?.response?.data ??
          e?.response ??
          e?.cause ??
          null;

        const errorDetails = {
          postId: post.id,
          platform: post.platform,
          channelId: post.channelId,
          channelName:
            post.channel?.name ??
            null,
          runtimeProfileKey:
            runtimeContext
              .browserProfileKey,
          proxyType:
            runtimeContext
              .proxyType,
          locale:
            runtimeContext.locale,
          timezone:
            runtimeContext.timezone,
          scheduledAt:
            post.scheduledAt?.toISOString?.() ??
            post.scheduledAt,
          mediaCount:
            post.mediaUrls?.length ?? 0,
          retryAttempt:
            post.retryCount + 1,
          message: errorMessage,
          name: e?.name ?? null,
          status:
            e?.status ??
            e?.statusCode ??
            e?.response?.status ??
            null,
          response: responseData,
        };

        this.logger.error(
          `Publish failed: ${JSON.stringify(errorDetails)}`,
          e?.stack,
        );

        await this.prisma.publishAttempt.update({
          where: {
            id: attempt.id,
          },
          data: {
            status:
              PublishAttemptStatus.FAILED,
            errorMessage,
            responsePayload:
              responseData
                ? JSON.parse(
                    JSON.stringify(responseData),
                  )
                : undefined,
            completedAt:
              new Date(),
          },
        });

        await this.prisma.scheduledPost.update({
          where: {
            id: post.id,
          },
          data: {
            status:
              ScheduledPostStatus.FAILED,
            retryCount:
              post.retryCount + 1,
            lastError:
              errorMessage,
          },
        });

      }

    }

    return {
      success: true,
      found: posts.length,
      published,
    };

  }


  private async syncHistoryPublishedStatus(
    historyId: string,
  ) {
    const linkedPosts =
      await this.prisma.scheduledPost.findMany({
        where: {
          historyId,
          status: {
            not: ScheduledPostStatus.CANCELLED,
          },
        },
        select: {
          id: true,
          platform: true,
          status: true,
        },
      });

    if (!linkedPosts.length) {
      return;
    }

    const allPublished =
      linkedPosts.every(
        (linkedPost) =>
          linkedPost.status ===
          ScheduledPostStatus.PUBLISHED,
      );

    if (!allPublished) {
      this.logger.log(
        [
          `History ${historyId} is not complete.`,
          linkedPosts
            .map(
              (linkedPost) =>
                `${linkedPost.platform}=${linkedPost.status}`,
            )
            .join(', '),
        ].join(' '),
      );

      return;
    }

    await this.prisma.generationHistory.update({
      where: {
        id: historyId,
      },
      data: {
        status:
          ContentStatus.PUBLISHED,
        publishedAt:
          new Date(),
        reviewedBy:
          'Atlas Publisher',
      },
    });

    this.logger.log(
      `History ${historyId} marked as published.`,
    );
  }


  private async publishTelegramDirectPhotoUrlIfPossible(post: any) {
    const channel = post.channel;

    if (!channel || channel.platform !== 'TELEGRAM') {
      return null;
    }

    const mediaUrls = Array.isArray(post.mediaUrls) ? post.mediaUrls : [];

    if (mediaUrls.length === 0) {
      return null;
    }

    const connector: any = this.telegram as any;

    if (typeof connector.publishPhotoUrlDirect !== 'function') {
      return null;
    }

    const chatId =
      channel.externalId ||
      (channel.username ? `@${channel.username.replace(/^@/, '')}` : null) ||
      process.env.TELEGRAM_CHAT_ID ||
      process.env.TELEGRAM_CHANNEL_ID;

    if (!chatId) {
      return null;
    }

    const tokenCandidate =
      channel.accessToken ||
      channel.botToken ||
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.TELEGRAM_TOKEN;

    if (!tokenCandidate) {
      return null;
    }

    return connector.publishPhotoUrlDirect({
      botToken: tokenCandidate,
      chatId,
      photoUrl: mediaUrls[0],
      caption: post.content || post.title || '',
    });
  }

}
