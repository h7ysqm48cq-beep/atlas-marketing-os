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

      const generatedContent = await this.generateNews(edition, dateKey, {
        timezone: settings.timezone,
        sameDaySourcesOnly: settings.sameDaySourcesOnly,
        maxSourceAgeHours: settings.maxSourceAgeHours,
        requirePublishedAt: settings.requirePublishedAt,
        requireSourceUrl: settings.requireSourceUrl,
        minimumSources: settings.minimumSources,
        freshnessFallbackEnabled: settings.freshnessFallbackEnabled,
      });
      const content = this.cleanPublishedContent(generatedContent);
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
          'Football should be the main visual focus, with subtle basketball and motorsport context only when relevant.',
          'Photorealistic, cinematic, clean editorial layout.',
          'Do not imitate real athlete faces.',
          'Do not use league logos or team logos.',
          'Do not generate any MGM logo, QR code, website URL or footer branding.',
          'Do not display any date, year, month, weekday, clock, weather, temperature or calendar information.',
          'All factual date information will be added later by deterministic post-processing.',
          'Keep the lower edge visually clean for real post-processing branding.',
          edition === 'MORNING'
            ? 'Use concise visible edition wording: M-Sports / 满贯门体育早报.'
            : 'Use concise visible edition wording: M-Sports / 满贯门体育晚报.',
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
        '{"stories":[{"headlineZh":"","headlineEn":"","summaryZh":"","summaryEn":"","eventStatus":"COMPLETED|UPCOMING|DEVELOPMENT","eventTime":null,"finalScore":null,"sources":[{"title":"","url":"","publishedAt":"","sourceName":""}]}]}',

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

    for (const story of stories.slice(0, 5)) {
      const sources = Array.isArray(story.sources)
        ? story.sources.map((source) => ({
            title: source.title?.trim() || 'Untitled source',
            url: source.url ?? null,
            publishedAt: source.publishedAt ?? null,
            sourceName: source.sourceName ?? null,
          }))
        : [];

      try {
        this.sportsNewsSourceValidator.validate(sources, freshness);
      } catch (error) {
        const storyName =
          story.headlineEn?.trim() ||
          story.headlineZh?.trim() ||
          'Unknown sports story';

        const sourceDiagnostics = sources.map((source) => ({
          sourceName: source.sourceName,
          publishedAt: source.publishedAt,
          hasUrl: Boolean(source.url?.trim()),
          title: source.title,
        }));

        this.logger.error(
          `Freshness validation rejected "${storyName}". ` +
            `sources=${JSON.stringify(sourceDiagnostics)}. ` +
            `${
              error instanceof Error
                ? error.message
                : 'Unknown validation error'
            }`,
        );

        throw error;
      }

      if (story.eventStatus === 'COMPLETED' && !story.finalScore?.trim()) {
        throw new Error(
          `Completed event "${story.headlineEn || story.headlineZh || 'Unknown'}" has no verified finalScore. Publication blocked.`,
        );
      }

      acceptedStories.push(story);
    }

    if (acceptedStories.length < 3) {
      throw new Error(
        'Fewer than 3 stories passed freshness validation. Publication blocked.',
      );
    }

    const lines: string[] = [
      'M-Sports / 满贯门体育新闻｜体育焦点 / Sports Focus',
      '',
    ];

    acceptedStories.forEach((story, index) => {
      const headlineZh = story.headlineZh?.trim() || '体育焦点';
      const headlineEn = story.headlineEn?.trim() || 'Sports Update';

      lines.push(`${index + 1}. ${headlineZh}｜${headlineEn}`);

      const summaryZh = story.summaryZh?.trim() || '';
      const summaryEn = story.summaryEn?.trim() || '';

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

    return this.compactTelegramCaption(lines.join('\n'));
  }

  private compactTelegramCaption(content: string): string {
    const sourceLine = new RegExp('^来源\\s*/\\s*Source\\s*:', 'i');
    const numberedLine = new RegExp('^[0-9１-９]\\s*[️⃣.)、-]?');
    const numberedEmojiLine = new RegExp('^[0-9]\\ufe0f?\\u20e3');

    const normalised = (content || '')
      .replace(new RegExp('\\\\n', 'g'), '\n')
      .replace(new RegExp('<[^>]+>', 'g'), '')
      .replace(
        new RegExp(
          '\$begin:math:display$\(\[\^\\$end:math:display$]+)\\]\$begin:math:text$https\?\:\/\/\[\^\\\\s\)\]\+\\$end:math:text$',
          'g',
        ),
        '$1',
      )
      .replace(
        new RegExp(
          '\\(\$begin:math:display$\[\^\\$end:math:display$]+\\]',
          'g',
        ),
        '',
      )
      .replace(
        new RegExp('\$begin:math:display$\[\^\\$end:math:display$]+\\]', 'g'),
        '',
      )
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

    const finalLines: string[] = [
      'M-Sports / 满贯门体育新闻｜体育焦点 / Sports Focus',
    ];
    let itemCount = 0;

    for (const line of lines) {
      if (sourceLine.test(line)) {
        continue;
      }

      if (line.includes('rebrand.ly/mgmbetae0dcf')) {
        continue;
      }

      if (
        line.includes('M-Sports / 满贯门体育新闻') ||
        line.includes('体育焦点') ||
        line.includes('Sports Focus') ||
        line.toLowerCase().includes('malaysia sports focus')
      ) {
        continue;
      }

      const isItemTitle =
        numberedLine.test(line) || numberedEmojiLine.test(line);

      if (isItemTitle) {
        itemCount += 1;

        if (itemCount > 3) {
          break;
        }

        finalLines.push('');
        finalLines.push(
          line.replace(new RegExp('来源\\s*/\\s*Source.*$', 'i'), '').trim(),
        );

        continue;
      }

      if (itemCount > 0 && itemCount <= 3) {
        const cleanedLine = line
          .replace(new RegExp('来源\\s*/\\s*Source.*$', 'i'), '')
          .replace(new RegExp('Read more.*$', 'i'), '')
          .trim();

        if (cleanedLine) {
          finalLines.push(cleanedLine);
        }
      }
    }

    let compact = finalLines
      .join('\n')
      .replace(new RegExp('\\n{3,}', 'g'), '\n\n')
      .replace(new RegExp('[ \\t]+', 'g'), ' ')
      .trim();

    if (compact.length > 680) {
      compact = compact.slice(0, 670).trim();
      compact = compact.replace(new RegExp('[，,;；:：\\-–—\\s]+$'), '');
      compact += '…';
    }

    return `${compact}\n\n立即查看今日体育焦点，加入满贯门 / Follow today’s sports focus with 满贯门\n${CTA_URL}`;
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
