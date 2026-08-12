import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import OpenAI from 'openai';
import { AssetImageService } from '../asset-image/asset-image.service';
import { MSportsImageBrandingService } from './msports/msports-image-branding.service';
import { SportsNewsSettingsService } from './sports-news-settings.service';
import {
  SportsNewsSourceValidatorService,
  type SportsNewsFreshnessRules,
} from './sports-news-source-validator.service';
import { PrismaService } from '../database/prisma.service';
import {
  ScheduledPostStatus,
  SocialChannelStatus,
  SocialPlatform,
} from '../generated/prisma/enums';

type Edition = 'MORNING' | 'EVENING';

@Injectable()
export class SportsNewsAutomationService {
  private cleanPublishedContent(content: string): string {
    return (
      content
        // Remove Markdown heading markers but keep heading text.
        .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')

        // Remove Markdown bold / italic markers.
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/_(.*?)_/g, '$1')

        // Remove internal citation markers such as [1], [10][37], [3][20][30].
        .replace(/(?:\s*\[\d+\])+/g, '')

        // Remove common source-attribution wording from visible copy.
        .replace(
          /\b(?:according to|reported by|reports from|records show)\s+(?:Flashscore|Reuters|ESPN|BBC|Sky Sports|The New York Times|Yahoo Sports|Goal|Google News)[,:]?\s*/gi,
          '',
        )
        .replace(
          /(?:《纽约时报》|路透社|ESPN|BBC|天空体育|Flashscore|Goal)(?:报道|报道称|报道指出|分析称|记录显示)[，,:：]?\s*/g,
          '',
        )

        // Remove Markdown separators.
        .replace(/^[ \t]*---+[ \t]*$/gm, '')

        // Collapse excessive blank lines.
        .replace(/\n{3,}/g, '\n\n')

        // Clean stray spaces before punctuation.
        .replace(/[ \t]+([，。！？：；,.!?;:])/g, '$1')

        .trim()
    );
  }

  private readonly logger = new Logger(SportsNewsAutomationService.name);
  private readonly client: OpenAI | null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly assetImages: AssetImageService,
    private readonly msportsBranding: MSportsImageBrandingService,
    private readonly sportsNewsSettings: SportsNewsSettingsService,
    private readonly sportsNewsSourceValidator: SportsNewsSourceValidatorService,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  /*
   * Runtime scheduler:
   *
   * The cron expression only provides a lightweight one-minute
   * infrastructure tick. Actual publication time and timezone
   * are controlled entirely by Sports News Settings.
   *
   * This allows operators to change timezone, morningTime and
   * eveningTime from the frontend without redeploying Railway.
   */
  @Cron('0 * * * * *', {
    name: 'm-sports-news-runtime-scheduler',
    waitForCompletion: true,
  })
  async runScheduledEditions() {
    const settings = await this.sportsNewsSettings.get();

    if (!settings.enabled) {
      return;
    }

    const now = new Date();

    const localParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    const hour = localParts.find((part) => part.type === 'hour')?.value ?? '00';

    const minute =
      localParts.find((part) => part.type === 'minute')?.value ?? '00';

    const currentTime = `${hour}:${minute}`;

    if (settings.morningEnabled && currentTime === settings.morningTime) {
      await this.createEdition('MORNING');
    }

    if (settings.eveningEnabled && currentTime === settings.eveningTime) {
      await this.createEdition('EVENING');
    }
  }

  async createMorningEditionNow() {
    return this.createEdition('MORNING');
  }

  async createEveningEditionNow() {
    return this.createEdition('EVENING');
  }

  async getStatus() {
    const settings = await this.sportsNewsSettings.get();

    const channel = await this.resolveChannel(settings.telegramChannelId);

    return {
      enabled: settings.enabled,
      hasOpenAiKey: Boolean(this.config.get<string>('OPENAI_API_KEY')),
      configuredTelegramChannelId: settings.telegramChannelId ?? null,
      resolvedChannel: channel
        ? {
            id: channel.id,
            name: channel.name,
            username: channel.username,
            platform: channel.platform,
            status: channel.status,
          }
        : null,
      running: this.running,
      timezone: settings.timezone,
    };
  }

  private async createEdition(edition: Edition) {
    if (!this.client || this.running) {
      const reason = this.running
        ? 'Sports news generation is already running.'
        : 'OPENAI_API_KEY is unavailable; sports news was skipped.';

      this.logger.warn(reason);

      return {
        success: false,
        skipped: true,
        reason,
        edition,
      };
    }

    this.running = true;

    try {
      const settings = await this.sportsNewsSettings.get();

      if (!settings.enabled) {
        return {
          success: false,
          skipped: true,
          reason: 'Sports News is disabled in settings.',
          edition,
        };
      }

      const channel = await this.resolveChannel(settings.telegramChannelId);
      if (!channel) {
        const reason = 'No connected Sports News Telegram channel was found.';

        this.logger.warn(reason);

        return {
          success: false,
          skipped: true,
          reason,
          edition,
        };
      }

      const dateKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: settings.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const title = this.renderPostTitle(edition, dateKey, settings);

      const existing = await this.prisma.scheduledPost.findFirst({
        where: { channelId: channel.id, title },
      });
      if (existing) {
        if (settings.duplicateEditionPolicy === 'SKIP') {
          this.logger.log(`Sports news already exists: ${title}`);

          return {
            success: true,
            skipped: true,
            reason: 'Sports news already exists',
            edition,
            title,
            postId: existing.id,
            status: existing.status,
          };
        }

        if (settings.duplicateEditionPolicy === 'REPLACE') {
          await this.prisma.scheduledPost.update({
            where: {
              id: existing.id,
            },
            data: {
              title: `${existing.title} [REPLACED ${new Date().toISOString()}]`,
            },
          });

          this.logger.log(
            `Existing Sports News edition marked as replaced: ${existing.id}`,
          );
        }

        /*
         * ALLOW:
         * continue without changing the existing edition.
         */
      }

      const generatedNews = await this.generateNews(
        edition,
        dateKey,
        {
          timezone: settings.timezone,

          sameDaySourcesOnly:
            edition === 'MORNING'
              ? settings.morningSameDaySourcesOnly
              : settings.sameDaySourcesOnly,

          maxSourceAgeHours: settings.maxSourceAgeHours,
          requirePublishedAt: settings.requirePublishedAt,
          requireSourceUrl: settings.requireSourceUrl,
          minimumSources: settings.minimumSources,
          freshnessFallbackEnabled: settings.freshnessFallbackEnabled,
        },
        settings,
      );
      const content = this.cleanPublishedContent(generatedNews.content);

      let finalMediaUrl: string | null = null;

      if (settings.imageGenerationEnabled) {
        try {
          const image = await this.assetImages.generateAndSave({
            name: title,
            platform: 'Telegram',

            model:
              settings.imageModelOverrideEnabled &&
              settings.imageAiModel?.trim()
                ? settings.imageAiModel.trim()
                : undefined,

            size: settings.imageGenerationSize as
              '1024x1536' | '1024x1024' | '1536x1024',

            quality: settings.imageGenerationQuality as
              'low' | 'medium' | 'high',

            logoMode: 'NEVER',

            prompt: [
              settings.imagePrompt?.trim(),
              settings.imageVisualStyle?.trim(),

              edition === 'MORNING'
                ? settings.morningImagePrompt?.trim()
                : settings.eveningImagePrompt?.trim(),

              settings.visualDirectorEnabled
                ? generatedNews.visualDirection?.trim()
                : '',

              generatedNews.visualContext
                ? `Verified visual context: ${generatedNews.visualContext}`
                : '',

              settings.imageRulesEnabled
                ? settings.imageRulesPrompt?.trim()
                : '',

              settings.imageBrandRulesEnabled
                ? settings.imageBrandRulesPrompt?.trim()
                : '',

              settings.imagePhotographyPrompt?.trim(),
              settings.imageNegativePrompt?.trim(),
              settings.imageUpperSafeAreaPrompt?.trim(),
              settings.imageLowerSafeAreaPrompt?.trim(),
            ]
              .filter(Boolean)
              .join(' '),
          });

          finalMediaUrl = image.asset.url;

          const activeBrand = await this.prisma.brand.findFirst({
            where: {
              id: channel.brandId,
            },
            select: {
              primaryLogoAssetId: true,
            },
          });

          try {
            const branded = await this.msportsBranding.apply({
              imageUrl: image.asset.url,

              logoAssetId: settings.logoEnabled
                ? (settings.logoAssetId ??
                  activeBrand?.primaryLogoAssetId ??
                  null)
                : null,

              footerText: settings.brandFooterEnabled
                ? [
                    settings.brandFooterText,
                    settings.footerDateEnabled ? dateKey : '',
                  ]
                    .filter(Boolean)
                    .join(settings.footerDateSeparator)
                : '',

              qrLink: settings.qrEnabled ? settings.qrLink : null,

          footerLogoAssetId: settings.footerLogoEnabled
            ? settings.footerLogoAssetId
            : null,

          footerQrAssetId: settings.footerQrEnabled
            ? settings.footerQrAssetId
            : null,

          footerQrLink: settings.footerQrEnabled
            ? settings.footerQrLink
            : null,

          footerPlacement: settings.footerPlacement,

              edition,

              highlights: generatedNews.imageHighlights,

              branding: {
                mastheadBrandText: settings.mastheadBrandText,

                morningEditionZh: settings.morningEditionZh,

                eveningEditionZh: settings.eveningEditionZh,

                morningEditionEn: settings.morningEditionEn,

                eveningEditionEn: settings.eveningEditionEn,

                sectionLabel: settings.imageSectionLabel,

                morningAccentColor: settings.morningAccentColor,

                eveningAccentColor: settings.eveningAccentColor,

                morningSecondaryColor: settings.morningSecondaryColor,

                eveningSecondaryColor: settings.eveningSecondaryColor,

                mastheadPrimaryColor: settings.mastheadPrimaryColor,

                mastheadEnglishColor: settings.mastheadEnglishColor,

                headlinePrimaryColor: settings.headlinePrimaryColor,

                headlineSecondaryColor: settings.headlineSecondaryColor,

                panelBaseColor: settings.panelBaseColor,

                watermarkEnabled: settings.watermarkEnabled,

                watermarkScale: settings.watermarkScale,

                watermarkOpacity: settings.watermarkOpacity,

                watermarkPosition: settings.watermarkPosition,

                qrSizePercent: settings.qrSizePercent,

                qrMarginPercent: settings.qrMarginPercent,

                footerBackgroundColor: settings.footerBackgroundColor,

                footerSeparatorColor: settings.footerSeparatorColor,
              },

              layout: {
                enabled: settings.imageLayoutEnabled,

                mastheadScale: settings.mastheadScale,

                mastheadTopPercent: settings.mastheadTopPercent,

                panelWidthPercent: settings.highlightsPanelWidthPercent,

                panelHeightPercent: settings.highlightsPanelHeightPercent,

                panelTopPercent: settings.highlightsPanelTopPercent,

                panelOpacityStart: settings.highlightsPanelOpacityStart,

                panelOpacityMiddle: settings.highlightsPanelOpacityMiddle,

                panelOpacityEnd: settings.highlightsPanelOpacityEnd,

                panelRadius: settings.highlightsPanelRadius,

                heroHeadlineScale: settings.heroHeadlineScale,

                secondaryHeadlineScale: settings.secondaryHeadlineScale,

                story02PositionPercent: settings.story02PositionPercent,

                story03PositionPercent: settings.story03PositionPercent,

                footerHeightPercent: settings.footerHeightPercent,
              },
            });

            finalMediaUrl = branded.imageDataUrl;

            this.logger.log(
              [
                `M-Sports branding applied for ${title}.`,
                `logo=${branded.logoApplied}`,
                `footer=${branded.footerApplied}`,
                `qr=${branded.qrApplied}`,
              ].join(' '),
            );
          } catch (error) {
            const message =
              `M-Sports branding failed for ${title}. ` +
              `${
                error instanceof Error
                  ? error.message
                  : 'Unknown branding error'
              }`;

            if (settings.brandingFailurePolicy === 'BLOCK') {
              throw new Error(message);
            }

            this.logger.warn(
              `${message} Using the newly generated image without deterministic branding.`,
            );
          }
        } catch (error) {
          const message =
            `M-Sports image generation failed for ${title}. ` +
            `${
              error instanceof Error
                ? error.message
                : 'Unknown image generation error'
            }`;

          if (settings.imageFailurePolicy === 'BLOCK') {
            throw new Error(message);
          }

          this.logger.warn(`${message} Continuing with text-only publication.`);

          finalMediaUrl = null;
        }
      } else {
        this.logger.log(
          `Image generation disabled for ${title}; publishing text only.`,
        );
      }

      const post = await this.prisma.scheduledPost.create({
        data: {
          brandId: channel.brandId,
          channelId: channel.id,
          platform: SocialPlatform.TELEGRAM,
          title,
          content,
          mediaUrls: finalMediaUrl ? [finalMediaUrl] : [],
          scheduledAt: new Date(),
          timezone: settings.timezone,
          status: this.resolveQueueStatus(settings.queueStatusOnCreate),
        },
      });

      this.logger.log(`Queued ${title} for ${channel.name}.`);

      return {
        success: true,
        skipped: false,
        edition,
        title,
        postId: post.id,
        status: post.status,
        channelId: channel.id,
        channelName: channel.name,
        mediaUrls: post.mediaUrls,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Sports news generation failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        success: false,
        skipped: false,
        edition,
        error: message,
      };
    } finally {
      this.running = false;
    }
  }

  private renderPostTitle(
    edition: Edition,
    dateKey: string,
    settings: Awaited<ReturnType<SportsNewsSettingsService['get']>>,
  ): string {
    const template =
      edition === 'MORNING'
        ? settings.morningPostTitleTemplate
        : settings.eveningPostTitleTemplate;

    return template
      .replaceAll('{date}', dateKey)
      .replaceAll('{edition}', edition)
      .trim();
  }

  private resolveQueueStatus(value: string): ScheduledPostStatus {
    const normalized = value.trim().toUpperCase();

    switch (normalized) {
      case 'DRAFT':
        return ScheduledPostStatus.DRAFT;

      case 'SCHEDULED':
        return ScheduledPostStatus.SCHEDULED;

      case 'QUEUED':
        return ScheduledPostStatus.QUEUED;

      default:
        throw new Error(`Unsupported Sports News queue status: ${value}`);
    }
  }

  private async resolveChannel(settingsChannelId?: string | null) {
    const configuredId = settingsChannelId?.trim();
    const connectedWhere = {
      platform: SocialPlatform.TELEGRAM,
      status: SocialChannelStatus.CONNECTED,
    } as const;

    if (configuredId) {
      return this.prisma.socialChannel.findFirst({
        where: { id: configuredId, ...connectedWhere },
      });
    }

    const channels = await this.prisma.socialChannel.findMany({
      where: connectedWhere,
      orderBy: { updatedAt: 'desc' },
    });
    const named = channels.find((channel) =>
      /sports|sport|体育|新聞|新闻/i.test(
        `${channel.name} ${channel.username ?? ''}`,
      ),
    );

    return named ?? (channels.length === 1 ? channels[0] : null);
  }

  private async generateNews(
    edition: Edition,
    dateKey: string,
    freshness: SportsNewsFreshnessRules,
    settings: Awaited<ReturnType<SportsNewsSettingsService['get']>>,
  ) {
    const editionInstruction =
      edition === 'MORNING'
        ? settings.morningPrompt?.trim() || ''
        : settings.eveningPrompt?.trim() || '';

    const response = await this.client!.responses.create({
      model: settings.newsAiModel.trim(),
      tools: settings.newsWebSearchEnabled
        ? [{ type: 'web_search' as const }]
        : [],
      input: [
        settings.systemPrompt?.trim(),

        `Publication date in Malaysia is ${dateKey}.`,
        `Publication timezone is ${freshness.timezone}.`,

        editionInstruction,

        settings.customInstructions?.trim(),

        `Return exactly ${settings.storyMinimum} to ${settings.storyMaximum} verified sports stories.`,

        settings.sportsPriority?.trim()
          ? `Sports priority: ${settings.sportsPriority}.`
          : '',

        `Same-day sources only: ${
          freshness.sameDaySourcesOnly ? 'YES' : 'NO'
        }.`,

        `Maximum source age: ${freshness.maxSourceAgeHours} hours.`,

        `Published date required: ${
          freshness.requirePublishedAt ? 'YES' : 'NO'
        }.`,

        `Source URL required internally: ${
          freshness.requireSourceUrl ? 'YES' : 'NO'
        }.`,

        `Minimum verified sources: ${freshness.minimumSources}.`,

        `Older-news fallback allowed: ${
          freshness.freshnessFallbackEnabled ? 'YES' : 'NO'
        }.`,

        settings.verificationInstructions?.trim(),

        settings.imageHeadlineInstructions?.trim(),

        settings.visibleCopyInstructions?.trim(),

        [
          'Return JSON only.',
          'Do not return Markdown.',
          'Required JSON shape:',
          '{"stories":[{"headlineZh":"","headlineEn":"","imageHeadlineZh":"","imageHeadlineEn":"","summaryZh":"","summaryEn":"","eventStatus":"COMPLETED|UPCOMING|DEVELOPMENT","eventTime":null,"finalScore":null,"sources":[{"title":"","url":"","publishedAt":"","sourceName":""}]}]}',
        ].join('\n'),
      ]
        .filter(Boolean)
        .join('\n'),
    });

    const raw = response.output_text?.trim();

    if (!raw) {
      throw new Error('The news model returned empty structured content.');
    }

    let parsed: {
      stories?: Array<{
        headlineZh?: string;
        headlineEn?: string;
        imageHeadlineZh?: string;
        imageHeadlineEn?: string;
        summaryZh?: string;
        summaryEn?: string;
        eventStatus?: string;
        eventTime?: string | null;
        finalScore?: string | null;
        sources?: Array<{
          title?: string;
          url?: string | null;
          publishedAt?: string | null;
          sourceName?: string | null;
        }>;
      }>;
    };

    try {
      parsed = JSON.parse(
        raw
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/, ''),
      );
    } catch {
      throw new Error(
        'The news model returned invalid JSON and publication was blocked.',
      );
    }

    const stories = Array.isArray(parsed.stories) ? parsed.stories : [];

    if (stories.length < settings.storyMinimum) {
      throw new Error(
        `Only ${stories.length} structured sports story/stories returned. Minimum ${settings.storyMinimum} required. Publication blocked.`,
      );
    }

    const acceptedStories: typeof stories = [];

    const acceptedSources: Array<{
      title: string;
      url?: string | null;
      publishedAt?: string | Date | null;
      sourceName?: string | null;
    }> = [];

    /*
     * Validate freshness per story without applying the global
     * minimumSources requirement to every individual story.
     *
     * A story needs at least one fresh, verifiable source.
     * The configured minimumSources requirement is enforced
     * across the complete edition after story validation.
     */
    const perStoryFreshness: SportsNewsFreshnessRules = {
      ...freshness,
      minimumSources: 1,
      freshnessFallbackEnabled: false,
    };

    for (const story of stories.slice(0, settings.storyMaximum)) {
      const sources = Array.isArray(story.sources)
        ? story.sources.map((source) => ({
            title: source.title?.trim() || 'Untitled source',
            url: source.url ?? null,
            publishedAt: source.publishedAt ?? null,
            sourceName: source.sourceName ?? null,
          }))
        : [];

      const storyName =
        story.headlineEn?.trim() ||
        story.headlineZh?.trim() ||
        'Unknown sports story';

      try {
        const validation = this.sportsNewsSourceValidator.validate(
          sources,
          perStoryFreshness,
        );

        if (!validation.enoughSources || validation.accepted.length < 1) {
          this.logger.warn(
            `Sports story rejected because no fresh verified source remained: "${storyName}".`,
          );
          continue;
        }

        acceptedSources.push(...validation.accepted);
      } catch (error) {
        const sourceDiagnostics = sources.map((source) => ({
          sourceName: source.sourceName,
          publishedAt: source.publishedAt,
          hasUrl: Boolean(source.url?.trim()),
          title: source.title,
        }));

        const rejectionMessage =
          `Sports story rejected by freshness validation: "${storyName}". ` +
          `sources=${JSON.stringify(sourceDiagnostics)}. ` +
          `${
            error instanceof Error ? error.message : 'Unknown validation error'
          }`;

        if (settings.invalidStoryPolicy === 'BLOCK') {
          throw new Error(rejectionMessage);
        }

        this.logger.warn(rejectionMessage);

        continue;
      }

      if (
        settings.completedEventPolicy === 'REQUIRE_FINAL_SCORE' &&
        settings.completedScoreRequired &&
        story.eventStatus === 'COMPLETED' &&
        !story.finalScore?.trim()
      ) {
        const message = `Completed sports story rejected because finalScore is missing: "${storyName}".`;

        if (settings.invalidStoryPolicy === 'BLOCK') {
          throw new Error(message);
        }

        this.logger.warn(message);
        continue;
      }

      if (
        story.eventStatus === 'UPCOMING' &&
        settings.upcomingEventPolicy === 'BLOCK'
      ) {
        const message = `Upcoming sports story blocked by Settings: "${storyName}".`;

        if (settings.invalidStoryPolicy === 'BLOCK') {
          throw new Error(message);
        }

        this.logger.warn(message);
        continue;
      }

      if (
        story.eventStatus === 'DEVELOPMENT' &&
        settings.developmentStoryPolicy === 'BLOCK'
      ) {
        const message = `Development sports story blocked by Settings: "${storyName}".`;

        if (settings.invalidStoryPolicy === 'BLOCK') {
          throw new Error(message);
        }

        this.logger.warn(message);
        continue;
      }

      acceptedStories.push(story);
    }

    const requiredStoryCount = Math.max(
      settings.storyMinimum,
      settings.minimumStoriesPerEdition,
    );

    if (acceptedStories.length < requiredStoryCount) {
      throw new Error(
        `Only ${acceptedStories.length} sports stories passed validation. Minimum ${requiredStoryCount} required. Publication blocked.`,
      );
    }

    /*
     * Enforce the configured minimum source count across the
     * complete edition rather than independently for each story.
     *
     * Duplicate URLs count only once.
     */
    const editionAcceptedSources = settings.sourceDeduplicationEnabled
      ? Array.from(
          new Map(
            acceptedSources.map((source) => [
              source.url?.trim() ||
                `${source.sourceName ?? ''}:${source.title}:${source.publishedAt ?? ''}`,
              source,
            ]),
          ).values(),
        )
      : acceptedSources;

    const requiredSourceCount = Math.max(1, freshness.minimumSources);

    if (editionAcceptedSources.length < requiredSourceCount) {
      throw new Error(
        `Sports edition has ${editionAcceptedSources.length} unique fresh verified source(s). ` +
          `Minimum ${requiredSourceCount} required. Publication blocked.`,
      );
    }

    this.logger.log(
      `Sports edition verified: ${acceptedStories.length} stories, ` +
        `${editionAcceptedSources.length} unique fresh source(s).`,
    );

    const lines: string[] = [
      edition === 'MORNING'
        ? settings.telegramMorningHeader
        : settings.telegramEveningHeader,
      '',
      settings.telegramSectionLabel,
      '',
    ];

    acceptedStories.forEach((story, index) => {
      const headlineZh =
        this.cleanSportsVisibleText(story.headlineZh) || '体育焦点';

      const headlineEn =
        this.cleanSportsVisibleText(story.headlineEn) || 'Sports Update';

      lines.push(`${index + 1}. ${headlineZh}｜${headlineEn}`);

      const summaryZh = this.cleanSportsVisibleText(story.summaryZh);
      const summaryEn = this.cleanSportsVisibleText(story.summaryEn);

      const scoreSuffix =
        story.eventStatus === 'COMPLETED' && story.finalScore?.trim()
          ? ` 比分：${story.finalScore.trim()}`
          : '';

      lines.push(`${summaryZh}${scoreSuffix}｜${summaryEn}`.trim());

      lines.push('');
    });

    const cleanImageHeadline = (
      preferred: string | undefined,
      fallback: string | undefined,
      maxLength: number,
    ) => {
      const selected = this.cleanSportsVisibleText(
        preferred || fallback || '',
      ).replace(/\s+/g, ' ');

      if (!selected) {
        return '';
      }

      /*
       * imageHeadline* should already be concise because
       * the news model is explicitly instructed to produce
       * display-ready headlines.
       *
       * This hard limit is only a final layout safeguard.
       */
      if (selected.length <= maxLength) {
        return selected;
      }

      return selected.slice(0, maxLength).trim();
    };

    const imageHighlights = acceptedStories.slice(0, 3).map((story) => ({
      zh:
        cleanImageHeadline(story.imageHeadlineZh, story.headlineZh, 22) ||
        '今日体育焦点',

      en:
        cleanImageHeadline(story.imageHeadlineEn, story.headlineEn, 46) ||
        'Sports Update',
    }));

    const parseSportKeywords = (value: string | null | undefined) =>
      (value || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);

    const matchesSportKeywords = (source: string, keywords: string[]) =>
      keywords.some((keyword) => source.includes(keyword));

    const detectSport = (value: string): string => {
      const source = value.toLowerCase();

      const rules = [
        {
          sport: 'football',
          keywords: parseSportKeywords(settings.footballKeywords),
        },
        {
          sport: 'basketball',
          keywords: parseSportKeywords(settings.basketballKeywords),
        },
        {
          sport: 'motorsport',
          keywords: parseSportKeywords(settings.motorsportKeywords),
        },
        {
          sport: 'motorcycle racing',
          keywords: parseSportKeywords(settings.motorcycleKeywords),
        },
        {
          sport: 'tennis',
          keywords: parseSportKeywords(settings.tennisKeywords),
        },
        {
          sport: 'badminton',
          keywords: parseSportKeywords(settings.badmintonKeywords),
        },
        {
          sport: 'baseball',
          keywords: parseSportKeywords(settings.baseballKeywords),
        },
        {
          sport: 'combat sports',
          keywords: parseSportKeywords(settings.combatKeywords),
        },
      ];

      for (const rule of rules) {
        if (matchesSportKeywords(source, rule.keywords)) {
          return rule.sport;
        }
      }

      return 'sports';
    };

    const visualStories = acceptedStories.slice(0, 3).map((story, index) => {
      const headline =
        story.headlineEn?.trim() || story.headlineZh?.trim() || '';

      const summary = story.summaryEn?.trim() || story.summaryZh?.trim() || '';

      const combined = `${headline} ${summary}`;

      return {
        priority: index + 1,
        sport: detectSport(combined),
        eventStatus: story.eventStatus || 'DEVELOPMENT',
        headline,
        summary,
      };
    });

    const uniqueSports = Array.from(
      new Set(visualStories.map((story) => story.sport)),
    );

    const heroStory = visualStories[0];

    const visualMode =
      uniqueSports.length === 1
        ? 'SINGLE_SPORT_EDITORIAL_MONTAGE'
        : 'MULTI_SPORT_EDITORIAL_MONTAGE';

    const heroEmotion =
      heroStory?.eventStatus === 'COMPLETED'
        ? settings.completedEventVisualPrompt?.trim() || ''
        : heroStory?.eventStatus === 'UPCOMING'
          ? settings.upcomingEventVisualPrompt?.trim() || ''
          : settings.developmentVisualPrompt?.trim() || '';

    const visualDirection = settings.visualDirectorEnabled
      ? [
          settings.visualDirectorPrompt?.trim(),

          `VISUAL MODE: ${visualMode}.`,

          heroStory?.sport ? `HERO SPORT: ${heroStory.sport}.` : '',

          heroEmotion,

          `Story 01 visual weight: ${settings.heroStoryWeight}%.`,

          uniqueSports.length === 1
            ? settings.singleSportVisualPrompt?.trim()
            : settings.multiSportVisualPrompt?.trim(),

          edition === 'MORNING'
            ? settings.morningVisualDirection?.trim()
            : settings.eveningVisualDirection?.trim(),

          ...visualStories.map(
            (story) =>
              `STORY ${story.priority}: sport=${story.sport}; status=${story.eventStatus}; verified context=${story.headline} — ${story.summary}`,
          ),
        ]
          .filter(Boolean)
          .join(' ')
      : '';

    const visualContext = visualStories
      .map((story) => `${story.headline} — ${story.summary}`)
      .filter(Boolean)
      .join(' | ');

    return {
      content: this.compactTelegramCaption(lines.join('\n'), edition, settings),
      imageHighlights,
      visualContext,
      visualDirection,
    };
  }

  private cleanSportsVisibleText(value: string | undefined | null): string {
    return (
      (value || '')
        // Markdown headings / blockquotes.
        .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
        .replace(/^[ \t]*>{1,3}[ \t]*/gm, '')

        // Markdown separators.
        .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')

        // Markdown emphasis.
        .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
        .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')

        // Numeric citation markers: [1], [2,3], [1-3], 【1】.
        .replace(/\[(?:\d+[\s,;–—-]*)+\]/g, '')
        .replace(/【\s*\d+(?:\s*[-–—,]\s*\d+)*\s*】/g, '')

        // Markdown links: [label](url) -> label.
        .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')

        // Bare markdown control characters left behind.
        .replace(/^[ \t]*[`*_~]+[ \t]*/gm, '')
        .replace(/[ \t]+[`*_~]+[ \t]*$/gm, '')

        // Normalise spacing.
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  }

  private compactTelegramCaption(
    content: string,
    edition: 'MORNING' | 'EVENING',
    settings: Awaited<ReturnType<SportsNewsSettingsService['get']>>,
  ): string {
    const sourceLine = new RegExp('^来源\\s*/\\s*Source\\s*:', 'i');
    const numberedLine = new RegExp('^[0-9１-９]\\s*[️⃣.)、-]?');
    const numberedEmojiLine = new RegExp('^[0-9]\\ufe0f?\\u20e3');

    const normalised = (content || '')
      .replace(new RegExp('\\\\\\n', 'g'), '\n')
      .replace(new RegExp('<[^>]+>', 'g'), '')
      .replace(
        new RegExp('https?://(?!rebrand\\.ly/mgmbetae0dcf)\\S+', 'g'),
        '',
      )
      .replace(new RegExp('\\*\\*', 'g'), '')
      .replace(
        new RegExp('Atlas Sports News', 'gi'),
        settings.mastheadBrandText?.trim() || '',
      )
      .replace(
        new RegExp('Atlas News', 'gi'),
        settings.mastheadBrandText?.trim() || '',
      )
      .replace(new RegExp('[ \\t]+\\n', 'g'), '\n')
      .replace(new RegExp('\\n{3,}', 'g'), '\n\n')
      .trim();

    const lines = normalised
      .split(new RegExp('\\n+'))
      .map((line) => line.trim())
      .filter(Boolean);

    type StoryBlock = {
      title: string;
      summary: string[];
    };

    const stories: StoryBlock[] = [];

    let currentStory: StoryBlock | null = null;

    for (const line of lines) {
      if (sourceLine.test(line)) {
        continue;
      }

      const isItemTitle =
        numberedLine.test(line) || numberedEmojiLine.test(line);

      if (isItemTitle) {
        if (stories.length >= 3) {
          break;
        }

        currentStory = {
          title: line
            .replace(new RegExp('来源\\s*/\\s*Source.*$', 'i'), '')
            .trim(),
          summary: [],
        };

        stories.push(currentStory);
        continue;
      }

      if (currentStory && stories.length <= 3) {
        const cleanedLine = line
          .replace(new RegExp('来源\\s*/\\s*Source.*$', 'i'), '')
          .replace(new RegExp('Read more.*$', 'i'), '')
          .trim();

        if (cleanedLine) {
          currentStory.summary.push(cleanedLine);
        }
      }
    }

    const cleanCompact = (value: string, maxLength: number) => {
      const compact = value.replace(/[ \t]+/g, ' ').trim();

      if (!compact || maxLength <= 0) {
        return '';
      }

      if (compact.length <= maxLength) {
        return compact;
      }

      /*
       * Sentence-safe compression.
       *
       * Prefer a complete sentence. Never return a mechanically
       * sliced English or Chinese sentence such as:
       * "Malaysia time on"
       */
      const sentenceMatches =
        compact.match(/[^。！？.!?]+[。！？.!?]+|[^。！？.!?]+$/g) || [];

      const completeSentences: string[] = [];
      let currentLength = 0;

      for (const sentence of sentenceMatches) {
        const cleanSentence = sentence.trim();

        if (!cleanSentence) {
          continue;
        }

        const nextLength =
          currentLength +
          cleanSentence.length +
          (completeSentences.length > 0 ? 1 : 0);

        if (nextLength > maxLength) {
          break;
        }

        completeSentences.push(cleanSentence);
        currentLength = nextLength;
      }

      if (completeSentences.length > 0) {
        return completeSentences.join(' ');
      }

      /*
       * If the first sentence itself is too long, reduce it to a
       * complete clause instead of chopping at an arbitrary index.
       */
      const firstSentence = sentenceMatches[0]?.trim() || compact;

      const clauses = firstSentence
        .split(/(?<=[,，;；:：])/)
        .map((part) => part.trim())
        .filter(Boolean);

      const completeClauses: string[] = [];
      let clauseLength = 0;

      for (const clause of clauses) {
        const nextLength =
          clauseLength + clause.length + (completeClauses.length > 0 ? 1 : 0);

        if (nextLength > maxLength) {
          break;
        }

        completeClauses.push(clause);
        clauseLength = nextLength;
      }

      if (completeClauses.length > 0) {
        return completeClauses.join(' ');
      }

      /*
       * Last resort: omit the summary.
       * Title + other language + CTA are preferable to broken prose.
       */
      return '';
    };

    const compactBilingualSummary = (
      value: string,
      zhMax: number,
      enMax: number,
    ) => {
      const parts = value
        .split('｜')
        .map((part) => part.trim())
        .filter(Boolean);

      if (parts.length >= 2) {
        const zh = cleanCompact(parts[0], zhMax);
        const en = cleanCompact(parts.slice(1).join('｜'), enMax);

        return [zh, en].filter(Boolean).join('｜');
      }

      return cleanCompact(value, zhMax + enMax);
    };

    const header =
      edition === 'MORNING'
        ? settings.telegramMorningHeader
        : settings.telegramEveningHeader;

    const cta = settings.telegramCtaEnabled
      ? [settings.telegramCtaText?.trim(), settings.telegramCtaUrl?.trim()]
          .filter(Boolean)
          .join('\n')
      : '';

    const targetLength = settings.telegramCaptionTarget;

    const summaryBudgets = settings.telegramShowSummaries
      ? [
          {
            zh: settings.telegramSummaryZhLong,
            en: settings.telegramSummaryEnLong,
          },
          {
            zh: settings.telegramSummaryZhMedium,
            en: settings.telegramSummaryEnMedium,
          },
          {
            zh: settings.telegramSummaryZhShort,
            en: settings.telegramSummaryEnShort,
          },
          {
            zh: settings.telegramSummaryZhCompact,
            en: settings.telegramSummaryEnCompact,
          },
          { zh: 0, en: 0 },
        ]
      : [{ zh: 0, en: 0 }];

    const buildCaption = (zhMax: number, enMax: number) => {
      const output: string[] = [header, '', settings.telegramSectionLabel];

      stories.slice(0, settings.storyMinimum).forEach((story) => {
        output.push('');
        output.push(story.title);

        if (zhMax <= 0 || enMax <= 0) {
          return;
        }

        const summary = story.summary.join(' ').trim();

        if (!summary) {
          return;
        }

        const compactSummary = compactBilingualSummary(summary, zhMax, enMax);

        if (compactSummary) {
          output.push(`   ${compactSummary}`);
        }
      });

      const body = output.join('\n').trim();

      return cta ? `${body}\n\n${cta}` : body;
    };

    for (const budget of summaryBudgets) {
      const candidate = buildCaption(budget.zh, budget.en);

      if (candidate.length <= targetLength) {
        return candidate;
      }
    }

    /*
     * Final safety fallback:
     * Never remove story titles or CTA.
     */
    return buildCaption(0, 0);
  }

  async forceCreateMorningEditionNow() {
    return this.forceCreateEditionNow('MORNING');
  }

  async forceCreateEveningEditionNow() {
    return this.forceCreateEditionNow('EVENING');
  }

  private async forceCreateEditionNow(edition: Edition) {
    const settings = await this.sportsNewsSettings.get();

    if (!settings.forceRunEnabled) {
      return {
        success: false,
        skipped: true,
        edition,
        reason: 'Force Run is disabled in Sports News Settings.',
      };
    }

    if (edition === 'MORNING' && !settings.forceMorningEnabled) {
      return {
        success: false,
        skipped: true,
        edition,
        reason: 'Force Morning is disabled in Sports News Settings.',
      };
    }

    if (edition === 'EVENING' && !settings.forceEveningEnabled) {
      return {
        success: false,
        skipped: true,
        edition,
        reason: 'Force Evening is disabled in Sports News Settings.',
      };
    }

    if (settings.forceRunExistingPolicy === 'MARK_OLD') {
      await this.markTodayEditionAsOld(edition, settings);
    }

    if (settings.forceRunExistingPolicy === 'DELETE') {
      await this.deleteTodayEdition(edition, settings);
    }

    return this.createEdition(edition);
  }

  private async markTodayEditionAsOld(
    edition: Edition,
    settings: Awaited<ReturnType<SportsNewsSettingsService['get']>>,
  ) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: settings.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const dateKey = formatter.format(new Date());

    const title = this.renderPostTitle(edition, dateKey, settings);

    const posts = await this.prisma.scheduledPost.findMany({
      where: {
        title,
        platform: SocialPlatform.TELEGRAM,
      },
      select: {
        id: true,
        title: true,
        status: true,
      },
    });

    for (const post of posts) {
      await this.prisma.scheduledPost.update({
        where: {
          id: post.id,
        },
        data: {
          title: `${post.title} [OLD ${new Date().toISOString()}]`,
        },
      });
    }

    return posts.length;
  }

  private async deleteTodayEdition(
    edition: Edition,
    settings: Awaited<ReturnType<SportsNewsSettingsService['get']>>,
  ) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: settings.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const dateKey = formatter.format(new Date());

    const title = this.renderPostTitle(edition, dateKey, settings);

    const result = await this.prisma.scheduledPost.deleteMany({
      where: {
        title,
        platform: SocialPlatform.TELEGRAM,
      },
    });

    return result.count;
  }
}
