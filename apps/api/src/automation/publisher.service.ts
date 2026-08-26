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
import {
  resolvePublisherRetryDecision,
  type SportsNewsRetryPolicy,
} from "./publisher-retry-policy";
import { resolvePublisherChannelIds } from "./publisher-scope";
import {
  resolveFacebookPostUrl,
  resolvePublishExternalId,
} from "./publisher-result";

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

  async run() {
    const allowedChannelIds =
      resolvePublisherChannelIds(
        process.env.AUTOMATION_PUBLISHER_CHANNEL_IDS,
      );

    if (allowedChannelIds) {
      this.logger.log(
        allowedChannelIds.length > 0
          ? `Publisher channel allowlist is active for ${allowedChannelIds.length} channel(s).`
          : "Publisher channel allowlist is empty; no posts will be selected.",
      );
    }

    const posts =
      await this.prisma.scheduledPost.findMany({
        where: {
          channel: {
            hiddenAt: null,
          },
          ...(allowedChannelIds
            ? {
                channelId: {
                  in: allowedChannelIds,
                },
              }
            : {}),
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
    let blocked = 0;

    for (const post of posts) {

      /*
       * FACEBOOK_BROWSER_SAFETY_GATE_V1
       *
       * Do this BEFORE changing the post to PUBLISHING.
       *
       * If Facebook identity is unhealthy, the post
       * remains QUEUED/SCHEDULED and can automatically
       * continue on a later scheduler run after the
       * Browser Account is repaired.
       */
      let facebookSafetyGate:
        Awaited<
          ReturnType<
            RuntimeProfileService[
              "getBrowserPublishingSafety"
            ]
          >
        > | null =
        null;

      let facebookPublishNetwork:
        Awaited<
          ReturnType<
            RuntimeProfileService[
              "getPublishNetwork"
            ]
          >
        > | null =
        null;

      let usedFacebookBrowserRuntime =
        false;

      if (
        post.platform ===
        SocialPlatform.FACEBOOK
      ) {
        try {
          const configuredPublishingPreference =
            String(
              post.channel
                .publishingPreference ||
              'AUTOMATIC',
            ).toUpperCase();

          const publishingPreference =
            configuredPublishingPreference ===
            'NATIVE_API'
              ? 'NATIVE_API'
              : 'BROWSER_RUNTIME';

          const nativeApiOnly =
            publishingPreference ===
            'NATIVE_API';

          if (nativeApiOnly) {
            facebookPublishNetwork =
              await this.runtimeProfiles
                .getPublishNetwork(
                  post.channel.id,
                  {
                    nativeApiOnly:
                      true,
                  },
                );
          } else {
            const liveLogin =
              await this.browserRuntime
                .preflightFacebookLoginForChannel(
                  post.channel.id,
                );

            if (!liveLogin.ready) {
              blocked += 1;

              const blockMessage =
                [
                  liveLogin.message,
                  `Channel: ${post.channel.name}.`,
                  'Post remains queued until the Cloud Browser login is ready.',
                ]
                  .join(' ')
                  .slice(0, 1000);

              this.logger.warn(
                [
                  'Facebook live login preflight blocked publish.',
                  `Post: ${post.id}.`,
                  `Channel: ${post.channel.id}.`,
                  `Profile: ${liveLogin.browserProfileKey}.`,
                  blockMessage,
                ].join(' '),
              );

              await this.prisma
                .scheduledPost
                .updateMany({
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
                    lastError:
                      blockMessage,
                  },
                });

              continue;
            }

            facebookSafetyGate =
              await this.runtimeProfiles
                .getBrowserPublishingSafety(
                  post.channel.id,
                );

            const browserUnavailable =
              !facebookSafetyGate
                .hasLinkedAccounts ||
              !facebookSafetyGate
                .allowed ||
              !facebookSafetyGate
                .selected;

            if (browserUnavailable) {
            blocked += 1;

            const candidateSummary =
              facebookSafetyGate
                .candidates
                .map(
                  (candidate) =>
                    [
                      candidate
                        .displayName,
                      `login=${candidate.loginStatus}`,
                      `cookie=${candidate.cookieStatus}`,
                    ].join(" "),
                )
                .join("; ");

            const blockMessage =
              [
                "Facebook publishing is waiting for a ready Browser Account.",
                `Channel: ${post.channel.name}.`,
                candidateSummary
                  ? `Accounts: ${candidateSummary}.`
                  : "No ready Browser Account is available.",
              ]
                .join(" ")
                .slice(
                  0,
                  1000,
                );

            this.logger.warn(
              [
                "Facebook Safety Gate blocked publish.",
                `Post: ${post.id}.`,
                `Channel: ${post.channel.id}.`,
                `Reason: ${facebookSafetyGate.reason}.`,
                blockMessage,
              ].join(" "),
            );

            await this.prisma
              .scheduledPost
              .updateMany({
                where: {
                  id:
                    post.id,

                  status: {
                    in: [
                      ScheduledPostStatus.SCHEDULED,
                      ScheduledPostStatus.QUEUED,
                    ],
                  },
                },

                data: {
                  lastError:
                    blockMessage,
                },
              });

              continue;
            }

            facebookPublishNetwork =
              await this.runtimeProfiles
                .getPublishNetwork(
                  post.channel.id,
                );

            if (
              facebookSafetyGate
                .hasLinkedAccounts &&
              facebookSafetyGate
                .selected
            ) {
              this.logger.log(
                [
                  "Facebook Safety Gate passed.",
                  `Post: ${post.id}.`,
                  `Browser Account: ${facebookSafetyGate.selected.displayName}.`,
                  `Profile: ${facebookSafetyGate.selected.browserProfileKey}.`,
                ].join(" "),
              );
            }
          }
        } catch (error) {
          blocked += 1;

          const message =
            (
              error instanceof Error
                ? error.message
                : "Unable to evaluate Facebook Browser Account safety."
            ).slice(
              0,
              1000,
            );

          this.logger.warn(
            [
              "Facebook Safety Gate could not complete.",
              `Post: ${post.id}.`,
              `Reason: ${message}`,
              "Post remains queued.",
            ].join(" "),
          );

          await this.prisma
            .scheduledPost
            .updateMany({
              where: {
                id:
                  post.id,

                status: {
                  in: [
                    ScheduledPostStatus.SCHEDULED,
                    ScheduledPostStatus.QUEUED,
                  ],
                },
              },

              data: {
                lastError:
                  `Facebook publishing paused: ${message}`,
              },
            });

          continue;
        }
      }


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
            lastError:
              null,
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

        browserAccountId:
          facebookSafetyGate
            ?.selected
            ?.id ??
          facebookPublishNetwork
            ?.browserAccountId ??
          null,

        browserSafetyReason:
          facebookSafetyGate
            ?.reason ??
          null,

        browserProfileId:
          runtimeProfile?.id ??
          null,

        browserProfileKey:
          facebookPublishNetwork
            ?.browserProfileKey ??
          runtimeProfile
            ?.browserProfileKey ??
          null,

        browserProfileName:
          facebookSafetyGate
            ?.selected
            ?.browserProfileName ??
          runtimeProfile
            ?.browserProfileName ??
          null,

        locale:
          facebookPublishNetwork
            ?.locale ??
          runtimeProfile?.locale ??
          null,

        timezone:
          facebookPublishNetwork
            ?.timezone ??
          runtimeProfile
            ?.timezone ??
          post.timezone,

        proxyType:
          facebookPublishNetwork
            ?.proxyType ??
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
          facebookSafetyGate
            ?.selected
            ?.proxyCountry ??
          runtimeProfile
            ?.proxyCountry ??
          null,

        lastKnownIp:
          facebookSafetyGate
            ?.selected
            ?.lastKnownIp ??
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
            facebookPublishNetwork ??
            await this.runtimeProfiles
              .getPublishNetwork(
                post.channel.id,
              );

          usedFacebookBrowserRuntime =
            Boolean(
              publishNetwork
                .browserProfileKey,
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

          if (
            publishNetwork.browserProfileKey
          ) {
            this.logger.log(
              [
                "Using Browser Runtime Facebook publisher.",
                "Profile:",
                publishNetwork.browserProfileKey,
              ].join(" "),
            );

            if (post.mediaUrls.length > 0) {
              this.logger.log(
                [
                  'Browser Runtime scheduled publishing',
                  'will attach remote images.',
                  `Post: ${post.id}.`,
                  `Remote media count: ${post.mediaUrls.length}.`,
                ].join(" "),
              );
            }

            const prepareResult =
              await this.browserRuntime.prepareFacebookPostForChannel(
                post.channel.id,
                {
                  caption: post.content,
                  imagePath: null,
                  imageUrl: post.mediaUrls[0] ?? null,
                  imageUrls: post.mediaUrls,
                },
              );

            const prepared = prepareResult as {
              success?: boolean;
              readyForReview?: boolean;
              captionFilled?: boolean;
              imageAttached?: boolean;
              attachedMediaCount?: number;
            };

            if (
              prepared.success === false ||
              prepared.readyForReview === false ||
              (post.mediaUrls.length > 0 &&
                (prepared.imageAttached !== true ||
                  prepared.attachedMediaCount !== post.mediaUrls.length))
            ) {
              throw new Error(
                post.mediaUrls.length > 0
                  ? [
                      'Facebook draft preparation failed:',
                      `expected ${post.mediaUrls.length} image(s),`,
                      `attached ${prepared.attachedMediaCount ?? 0}.`,
                    ].join(' ')
                  : 'Facebook draft preparation failed.',
              );
            }

            this.logger.log(
              [
                "Facebook draft prepared.",
                `Post: ${post.id}.`,
                `Caption filled: ${prepared.captionFilled !== false}.`,
                `Images attached: ${prepared.attachedMediaCount ?? 0}.`,
              ].join(' '),
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
            if (!encryptedToken) {
              throw new Error(
                [
                  `Facebook channel ${post.channel.id}`,
                  `(${post.channel.name})`,
                  "does not have an access token for Native API publishing.",
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

        const externalPostId =
          resolvePublishExternalId(
            result,
          );

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
              externalPostId,
            externalPostUrl:
              post.platform === SocialPlatform.FACEBOOK
                ? resolveFacebookPostUrl(
                    result,
                    externalPostId,
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

        const failedAttemptCount =
          post.retryCount + 1;

        const retryDecision =
          resolvePublisherRetryDecision({
            policy:
              this.readSportsNewsRetryPolicy(
                post.brandRenderingSettings,
              ),
            failedAttemptCount,
            failedAt:
              new Date(),
            usedBrowserRuntime:
              usedFacebookBrowserRuntime,
          });

        if (usedFacebookBrowserRuntime) {
          this.logger.warn(
            [
              `Browser Runtime publish failed for post ${post.id}.`,
              "Automatic retry is suppressed; the post remains FAILED until an explicit retry.",
            ].join(" "),
          );
        }

        await this.prisma.scheduledPost.update({
          where: {
            id: post.id,
          },
          data: {
            status:
              retryDecision.shouldRetry
                ? ScheduledPostStatus.SCHEDULED
                : ScheduledPostStatus.FAILED,
            retryCount:
              failedAttemptCount,
            lastError:
              errorMessage,
            ...(retryDecision.scheduledAt
              ? {
                  scheduledAt:
                    retryDecision.scheduledAt,
                }
              : {}),
          },
        });

        if (retryDecision.scheduledAt) {
          this.logger.warn(
            [
              `Publish retry scheduled for post ${post.id}.`,
              `Attempt: ${failedAttemptCount}.`,
              `Next run: ${retryDecision.scheduledAt.toISOString()}.`,
            ].join(" "),
          );
        }

      }

    }

    return {
      success: true,
      found: posts.length,
      published,
      blocked,
    };

  }


  private readSportsNewsRetryPolicy(
    value: unknown,
  ): SportsNewsRetryPolicy | null {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return null;
    }

    const sportsNews =
      (value as Record<string, unknown>)
        .sportsNews;

    if (
      !sportsNews ||
      typeof sportsNews !== "object" ||
      Array.isArray(sportsNews)
    ) {
      return null;
    }

    const policy =
      sportsNews as Record<string, unknown>;

    if (
      typeof policy.publishRetryEnabled !==
        "boolean" ||
      typeof policy.publishRetryLimit !==
        "number" ||
      typeof policy.publishRetryDelayMinutes !==
        "number"
    ) {
      return null;
    }

    return {
      publishRetryEnabled:
        policy.publishRetryEnabled,
      publishRetryLimit:
        policy.publishRetryLimit,
      publishRetryDelayMinutes:
        policy.publishRetryDelayMinutes,
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
