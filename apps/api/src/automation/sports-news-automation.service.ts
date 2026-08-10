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

const CTA_URL = 'https://rebrand.ly/mgmbetae0dcf';
const SPORTS_NEWS_IMAGE_RULES = [
  'Do not create a fake MGM logo, fake crest, fake crown, or fake monogram.',
  'The real brand logo will be composited after image generation.',
  'ABSOLUTE IMAGE TEXT RULES:',
  'This is a 满贯门 branded sports news image.',
  'The exact main title text on the image must be: 满贯门 Sports News.',
  'The image must not show the title as 满贯门 Sports News alone.',
  'If the words Sports News appear, they must appear together with 满贯门 on the same line: 满贯门 Sports News.',
  'The image must include the subtitle: 体育焦点 / Sports Focus.',
  'Do not draw or invent any MGM logo. The real 满贯门 logo will be composited after image generation.',
  'The image footer must include exactly: mgmbetmyr.com.',
  'Do not include https://rebrand.ly/mgmbetae0dcf in the image.',
  'Do not include Atlas, Atlas Sports News, Atlas News, MGM News, or plain 满贯门 Sports News as a standalone title.',
  'Use only these visible text elements: 满贯门 Sports News and 体育焦点 / Sports Focus. Do not add website text unless Atlas post-processing adds it.',
  'Keep the design premium, clean, cinematic, sports-focused, Malaysian audience, not overcrowded.',
  'Place the logo and mgmbetmyr.com in the bottom footer area.',
].join('\\n');

const SPORTS_NEWS_IMAGE_BRAND_RULES = [
  'Use M-Sports / 满贯门体育新闻 as the only visible news brand title in the image.',
  'Do not write or show Atlas, Atlas Sports News, Atlas News, or MGM News.',
  'Place a small clean 满贯门 / MGM logo in the image footer.',
  'Include a small clean footer link: mgmbetmyr.com',
  'Keep the image clean, premium, readable, and not overcrowded.',
].join('\n');

const TIMEZONE = 'Asia/Kuala_Lumpur';

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

  @Cron('0 9 * * *', {
    name: 'm-sports-news-morning',
    timeZone: TIMEZONE,
    waitForCompletion: true,
  })
  async createMorningEdition() {
    await this.createEdition('MORNING');
  }

  @Cron('0 20 * * *', {
    name: 'm-sports-news-evening',
    timeZone: TIMEZONE,
    waitForCompletion: true,
  })
  async createEveningEdition() {
    await this.createEdition('EVENING');
  }

  async createMorningEditionNow() {
    return this.createEdition('MORNING');
  }

  async createEveningEditionNow() {
    return this.createEdition('EVENING');
  }

  async getStatus() {
    const channel = await this.resolveChannel();

    return {
      enabled: this.config.get<string>('SPORTS_NEWS_ENABLED') === 'true',
      hasOpenAiKey: Boolean(this.config.get<string>('OPENAI_API_KEY')),
      configuredTelegramChannelId:
        this.config.get<string>('SPORTS_NEWS_TELEGRAM_CHANNEL_ID') ?? null,
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
      timezone: TIMEZONE,
    };
  }

  private async createEdition(edition: Edition) {
    if (this.config.get<string>('SPORTS_NEWS_ENABLED') !== 'true') {
      return {
        success: false,
        skipped: true,
        reason: 'SPORTS_NEWS_ENABLED is not true',
        edition,
      };
    }

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
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const title =
        edition === 'MORNING'
          ? `满贯门体育早报 | M-Sports Morning ${dateKey}`
          : `满贯门体育晚报 | M-Sports Evening ${dateKey}`;

      const existing = await this.prisma.scheduledPost.findFirst({
        where: { channelId: channel.id, title },
      });
      if (existing) {
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

      const generatedNews = await this.generateNews(edition, dateKey, {
        timezone: settings.timezone,

        /*
         * Morning editions use a rolling freshness window.
         *
         * Example:
         * 10 Aug 09:00 MYT may legitimately report an important
         * verified result published late on 9 Aug.
         *
         * Evening editions remain strict same-calendar-day when
         * sameDaySourcesOnly is enabled in Settings.
         */
        sameDaySourcesOnly:
          edition === 'MORNING' ? false : settings.sameDaySourcesOnly,

        maxSourceAgeHours: settings.maxSourceAgeHours,
        requirePublishedAt: settings.requirePublishedAt,
        requireSourceUrl: settings.requireSourceUrl,
        minimumSources: settings.minimumSources,
        freshnessFallbackEnabled: settings.freshnessFallbackEnabled,
      });
      const content = this.cleanPublishedContent(generatedNews.content);

      const image = await this.assetImages.generateAndSave({
        name: title,
        platform: 'Telegram',
        size: '1024x1536',
        quality: 'medium',
        logoMode: 'NEVER',
        prompt: [
          'Premium editorial M-Sports / 满贯门体育新闻 poster for a Malaysian audience.',
          edition === 'MORNING'
            ? 'Fresh energetic morning sports atmosphere.'
            : 'Dramatic evening stadium atmosphere.',
          'Use the verified daily sports context below only to guide the visual scene and sport selection.',
          `Verified visual context: ${
            generatedNews.visualContext ||
            'General current sports editorial atmosphere.'
          }`,
          'If the verified context includes football, basketball, motorsport, badminton, tennis or another sport, reflect those sports visually where composition allows.',
          'Do not invent unrelated sports merely to fill the composition.',
          'The visual scene should clearly feel connected to today’s verified sports stories.',
          'Photorealistic, cinematic, clean editorial layout.',
          'Do not imitate real athlete faces.',
          'Do not use league logos or team logos.',
          'Do not render sports headlines, scores, results, fixtures or factual story text.',
          'The verified sports highlights will be added later by deterministic post-processing.',
          'Compose the image like a premium sports editorial cover with one dominant hero sports visual.',
          'Keep the upper-left area moderately clean for a compact deterministic masthead.',
          'Keep the lower 30 percent visually calmer for deterministic editorial story overlays.',
          'Do not draw any panel, card, box, banner, rectangle, text container, glass surface, translucent surface or UI element anywhere in the image.',
          'Do not pre-design a placeholder for headlines.',
          'Do not place critical faces, balls, trophies or key action details inside the lower editorial text zone.',
          'All story hierarchy and editorial labels will be added later by deterministic Sharp/SVG post-processing.',
          'Do not generate any MGM logo, M logo, QR code, website URL or footer branding.',
          'Do not display any date, year, month, weekday, clock, weather, temperature or calendar information.',
          'All factual date information and branding will be added later by deterministic post-processing.',
          'Keep the lower edge visually clean for real post-processing branding.',
          'Do not render M-Sports, 满贯门体育早报 or 满贯门体育晚报 as visible text.',
          'The masthead and edition title will be added later by deterministic post-processing.',
          'Vertical 4:5 social-media composition.',
        ].join(' '),
      });

      const activeBrand = await this.prisma.brand.findFirst({
        where: {
          id: channel.brandId,
        },
        select: {
          primaryLogoAssetId: true,
        },
      });

      let finalMediaUrl = image.asset.url;

      try {
        const branded = await this.msportsBranding.apply({
          imageUrl: image.asset.url,
          logoAssetId: activeBrand?.primaryLogoAssetId ?? null,
          footerText: `满贯门 mgmbetmyr.com  •  ${dateKey}`,
          qrLink: 'https:' + '//' + 'mgmbetmyr.com',
          edition,
          highlights: generatedNews.imageHighlights,
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
        /*
         * Do not reuse any historical image.
         * If branding fails, use only the newly generated
         * image from this exact run.
         */
        this.logger.warn(
          `M-Sports branding failed for ${title}. ` +
            `Using this run's newly generated image only. ` +
            `${
              error instanceof Error ? error.message : 'Unknown branding error'
            }`,
        );
      }

      const post = await this.prisma.scheduledPost.create({
        data: {
          brandId: channel.brandId,
          channelId: channel.id,
          platform: SocialPlatform.TELEGRAM,
          title,
          content,
          mediaUrls: [finalMediaUrl],
          scheduledAt: new Date(),
          timezone: TIMEZONE,
          status: ScheduledPostStatus.QUEUED,
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

  private async resolveChannel(settingsChannelId?: string | null) {
    const configuredId =
      settingsChannelId?.trim() ||
      this.config.get<string>('SPORTS_NEWS_TELEGRAM_CHANNEL_ID')?.trim();
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
  ) {
    const editionInstruction =
      edition === 'MORNING'
        ? [
            'This is the MORNING edition.',
            'Prioritise verified results and developments from the previous 24 hours.',
          ].join('\n')
        : [
            'This is the EVENING edition.',
            'Prioritise developments since the morning edition.',
          ].join('\n');

    const response = await this.client!.responses.create({
      model: this.config.get<string>('OPENAI_MODEL') || 'gpt-5.5',
      tools: [{ type: 'web_search' }],
      input: [
        'You are the verification editor for M-Sports / 满贯门体育新闻.',
        `Publication date in Malaysia is ${dateKey}.`,
        `Publication timezone is ${freshness.timezone}.`,
        editionInstruction,

        'Return JSON only. Do not return markdown.',
        'The JSON shape must be:',
        '{"stories":[{"headlineZh":"","headlineEn":"","imageHeadlineZh":"","imageHeadlineEn":"","summaryZh":"","summaryEn":"","eventStatus":"COMPLETED|UPCOMING|DEVELOPMENT","eventTime":null,"finalScore":null,"sources":[{"title":"","url":"","publishedAt":"","sourceName":""}]}]}',

        'FRESHNESS RULES:',
        `Same-day sources only: ${freshness.sameDaySourcesOnly ? 'YES' : 'NO'}.`,
        `Maximum source age: ${freshness.maxSourceAgeHours} hours.`,
        `Published date required: ${freshness.requirePublishedAt ? 'YES' : 'NO'}.`,
        `Source URL required internally: ${freshness.requireSourceUrl ? 'YES' : 'NO'}.`,
        `Minimum verified sources: ${freshness.minimumSources}.`,
        `Older-news fallback allowed: ${
          freshness.freshnessFallbackEnabled ? 'YES' : 'NO'
        }.`,

        'MANDATORY VERIFICATION:',
        'Every story must contain its own sources array.',
        'Use independently verifiable current sources.',
        'Do not use a stale fixture preview after a match has already finished.',
        'If the match is finished, eventStatus must be COMPLETED and finalScore must contain the verified final score.',
        'If the match has not started, eventStatus must be UPCOMING and eventTime should contain the verified scheduled time when available.',
        'For transfers, injuries, announcements or other non-match items, use DEVELOPMENT.',
        'If status or timing cannot be confidently verified, exclude the story.',
        'Never invent publishedAt, URL, eventTime or finalScore.',
        'Use exactly 3 to 5 stories.',
        'Prioritise football, then basketball, Formula 1, badminton, tennis and major sports.',

        'IMAGE HEADLINE RULES:',
        'For every story, also return imageHeadlineZh and imageHeadlineEn.',
        'These are short image-display versions of the same verified headline, not separate stories.',
        'imageHeadlineZh should normally be 8 to 16 Chinese characters where practical.',
        'imageHeadlineEn should normally be 4 to 7 short English words where practical.',
        'Keep the same factual meaning and event status as headlineZh/headlineEn.',
        'Do not add a score, location, opponent, player, competition or claim that is not already verified in that story.',
        'Do not use ellipsis in imageHeadlineZh or imageHeadlineEn.',
        'Do not write clickbait.',
        'Do not change an UPCOMING event into a completed result or a COMPLETED event into a preview.',

        'VISIBLE COPY CLEANLINESS:',
        'All headlineZh, headlineEn, imageHeadlineZh, imageHeadlineEn, summaryZh and summaryEn values must contain plain text only.',
        'Never include Markdown headings such as #, ## or ###.',
        'Never include blockquote markers such as > or >>.',
        'Never include Markdown emphasis markers such as *, **, *** or _.',
        'Never include citation markers such as [1], [2], [3], 【1】 or source-reference numbers.',
        'Never include markdown links.',
        'Never include horizontal separators such as --- or ***.',
        'Do not mention source names or citation numbers inside visible story text.',
      ].join('\n'),
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

    if (stories.length < 3) {
      throw new Error(
        `Only ${stories.length} structured sports story/stories returned. Publication blocked.`,
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

    for (const story of stories.slice(0, 5)) {
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

        this.logger.warn(
          `Sports story rejected by freshness validation: "${storyName}". ` +
            `sources=${JSON.stringify(sourceDiagnostics)}. ` +
            `${
              error instanceof Error
                ? error.message
                : 'Unknown validation error'
            }`,
        );

        continue;
      }

      if (story.eventStatus === 'COMPLETED' && !story.finalScore?.trim()) {
        this.logger.warn(
          `Completed sports story rejected because finalScore is missing: "${storyName}".`,
        );

        continue;
      }

      acceptedStories.push(story);
    }

    if (acceptedStories.length < 3) {
      throw new Error(
        `Only ${acceptedStories.length} sports stories passed freshness validation. Minimum 3 required. Publication blocked.`,
      );
    }

    /*
     * Enforce the configured minimum source count across the
     * complete edition rather than independently for each story.
     *
     * Duplicate URLs count only once.
     */
    const uniqueAcceptedSources = Array.from(
      new Map(
        acceptedSources.map((source) => [
          source.url?.trim() ||
            `${source.sourceName ?? ''}:${source.title}:${source.publishedAt ?? ''}`,
          source,
        ]),
      ).values(),
    );

    const requiredSourceCount = Math.max(1, freshness.minimumSources);

    if (uniqueAcceptedSources.length < requiredSourceCount) {
      throw new Error(
        `Sports edition has ${uniqueAcceptedSources.length} unique fresh verified source(s). ` +
          `Minimum ${requiredSourceCount} required. Publication blocked.`,
      );
    }

    this.logger.log(
      `Sports edition verified: ${acceptedStories.length} stories, ` +
        `${uniqueAcceptedSources.length} unique fresh source(s).`,
    );

    const lines: string[] = [
      edition === 'MORNING'
        ? '⚡ 满贯门体育早报 | M-Sports Morning'
        : '🌙 满贯门体育晚报 | M-Sports Evening',
      '',
      '🔥 今日焦点 | Top Stories',
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

    lines.push(
      '立即查看今日体育焦点，加入满贯门 / Follow today’s sports focus with 满贯门',
    );

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

    const visualContext = acceptedStories
      .slice(0, 3)
      .map((story) => {
        const headline =
          story.headlineEn?.trim() || story.headlineZh?.trim() || '';

        const summary =
          story.summaryEn?.trim() || story.summaryZh?.trim() || '';

        return [headline, summary].filter(Boolean).join(' — ');
      })
      .filter(Boolean)
      .join(' | ');

    return {
      content: this.compactTelegramCaption(lines.join('\n'), edition),
      imageHighlights,
      visualContext,
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
        'M-Sports / 满贯门体育新闻',
      )
      .replace(new RegExp('Atlas News', 'gi'), 'M-Sports / 满贯门体育新闻')
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

      if (line.includes('rebrand.ly/mgmbetae0dcf')) {
        continue;
      }

      if (
        line.includes('M-Sports / 满贯门体育新闻') ||
        line.includes('⚡ 满贯门体育早报') ||
        line.includes('🌙 满贯门体育晚报') ||
        line === '🔥 今日焦点 | Top Stories' ||
        line.includes('体育焦点') ||
        line.includes('Sports Focus') ||
        line.toLowerCase().includes('malaysia sports focus')
      ) {
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

      if (compact.length <= maxLength) {
        return compact;
      }

      const sliced = compact.slice(0, maxLength);

      const punctuationIndex = Math.max(
        sliced.lastIndexOf('。'),
        sliced.lastIndexOf('！'),
        sliced.lastIndexOf('？'),
        sliced.lastIndexOf('.'),
        sliced.lastIndexOf('!'),
        sliced.lastIndexOf('?'),
        sliced.lastIndexOf(','),
        sliced.lastIndexOf('，'),
        sliced.lastIndexOf(' '),
      );

      if (punctuationIndex >= Math.round(maxLength * 0.62)) {
        return sliced.slice(0, punctuationIndex + 1).trim();
      }

      return sliced.trim();
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
        ? '⚡ 满贯门体育早报 | M-Sports Morning'
        : '🌙 满贯门体育晚报 | M-Sports Evening';

    const cta =
      `立即查看今日体育焦点，加入满贯门 / ` +
      `Follow today’s sports focus with 满贯门\n` +
      CTA_URL;

    /*
     * The Telegram photo publisher works with a ~1000 character
     * budget. Keep a safety margin so all three story titles and
     * the CTA always survive.
     */
    const targetLength = 940;

    const summaryBudgets = [
      { zh: 72, en: 112 },
      { zh: 58, en: 88 },
      { zh: 46, en: 68 },
      { zh: 34, en: 52 },
      { zh: 0, en: 0 },
    ];

    const buildCaption = (zhMax: number, enMax: number) => {
      const output: string[] = [header, '', '🔥 今日焦点 | Top Stories'];

      stories.slice(0, 3).forEach((story) => {
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

      return `${output.join('\n').trim()}\n\n${cta}`;
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
    await this.markTodayEditionAsOld('MORNING');

    return this.createEdition('MORNING');
  }

  async forceCreateEveningEditionNow() {
    await this.markTodayEditionAsOld('EVENING');

    return this.createEdition('EVENING');
  }

  private async markTodayEditionAsOld(edition: 'MORNING' | 'EVENING') {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const dateKey = formatter.format(new Date());

    const title =
      edition === 'MORNING'
        ? `满贯门体育早报 | M-Sports Morning ${dateKey}`
        : `满贯门体育晚报 | M-Sports Evening ${dateKey}`;

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

  private async applyMNewsWatermark(imageUrl: string): Promise<string> {
    // TODO:
    // Atlas watermark stage.
    //
    // Do not ask AI to draw the MGM / 满贯门 logo.
    // The real logo should be overlaid here after image generation.
    //
    // Expected final overlay:
    // - Real 满贯门 / MGM logo watermark
    // - Top-left or bottom-right placement
    // - Small, premium, not too large
    // - No fake AI-generated logo
    //
    // For now, return the original URL until the real logo asset path/URL
    // is connected to this processor.
    return imageUrl;
  }
}
