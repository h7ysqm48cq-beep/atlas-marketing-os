import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import OpenAI from 'openai';
import { AssetImageService } from '../asset-image/asset-image.service';
import { PrismaService } from '../database/prisma.service';
import {
  ScheduledPostStatus,
  SocialChannelStatus,
  SocialPlatform,
} from '../generated/prisma/enums';

const CTA_URL = 'https://rebrand.ly/mgmbetae0dcf';
const SPORTS_NEWS_IMAGE_RULES = [
  'FINAL SPORTS NEWS IMAGE RULES:',
  'The image must show 满贯门 M-News as the main visible news title.',
  'The image must show 体育焦点 / Sports Focus as a small subtitle.',
  'The image must include the MGM gold logo clearly but not too large.',
  'The image footer must include mgmbetmyr.com.',
  'The image must not include https://rebrand.ly/mgmbetae0dcf.',
  'The image must not show Atlas, Atlas Sports News, Atlas News, MGM News, or generic Sports News as the main title.',
  'Use very little text on the image only: 满贯门 M-News, 体育焦点 / Sports Focus, mgmbetmyr.com.',
  'Keep the visual premium, clean, modern, sports-focused, and easy to read.',
].join('\\n');

const SPORTS_NEWS_IMAGE_BRAND_RULES = [
  'Use 满贯门 M-News as the only visible news brand title in the image.',
  'Do not write or show Atlas, Atlas Sports News, Atlas News, or MGM News.',
  'Place a small clean 满贯门 / MGM logo in the image footer.',
  'Include a small clean footer link: mgmbetmyr.com',
  'Keep the image clean, premium, readable, and not overcrowded.',
].join('\n');

const TIMEZONE = 'Asia/Kuala_Lumpur';

type Edition = 'MORNING' | 'EVENING';

@Injectable()
export class SportsNewsAutomationService {
  private readonly logger = new Logger(SportsNewsAutomationService.name);
  private readonly client: OpenAI | null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly assetImages: AssetImageService,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  @Cron('0 9 * * *', {
    name: 'atlas-sports-news-morning',
    timeZone: TIMEZONE,
    waitForCompletion: true,
  })
  async createMorningEdition() {
    await this.createEdition('MORNING');
  }

  @Cron('0 20 * * *', {
    name: 'atlas-sports-news-evening',
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
      enabled:
        this.config.get<string>('SPORTS_NEWS_ENABLED') === 'true',
      hasOpenAiKey: Boolean(
        this.config.get<string>('OPENAI_API_KEY'),
      ),
      configuredTelegramChannelId:
        this.config.get<string>(
          'SPORTS_NEWS_TELEGRAM_CHANNEL_ID',
        ) ?? null,
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
      const channel = await this.resolveChannel();
      if (!channel) {
        const reason =
          'No connected Sports News Telegram channel was found.';

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
      const title = `满贯门 M-News ${edition} ${dateKey}`;

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

      const content = await this.generateNews(edition, dateKey);
      const image = await this.assetImages.generateAndSave({
        name: title,
        platform: 'Telegram',
        size: '1536x1024',
        quality: 'medium',
        logoMode: 'AUTO',
        prompt: [
          'Premium editorial sports news cover for a Malaysian audience.',
          edition === 'MORNING'
            ? 'Fresh energetic morning atmosphere.'
            : 'Dramatic evening stadium atmosphere.',
          'Blend football as the main focus with subtle basketball and motorsport cues.',
          'Photorealistic, dynamic, clean layout, no real athlete likeness, no league logos,',
          'no brand logos, no betting imagery, no scores, no text except a small neutral SPORTS NEWS title area.',
          'Landscape 3:2 composition suitable for Telegram.',
        ].join(' '),
      });

      const post = await this.prisma.scheduledPost.create({
        data: {
          brandId: channel.brandId,
          channelId: channel.id,
          platform: SocialPlatform.TELEGRAM,
          title,
          content,
          mediaUrls: [image.asset.url],
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
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error';

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

  private async resolveChannel() {
    const configuredId = this.config.get<string>('SPORTS_NEWS_TELEGRAM_CHANNEL_ID')?.trim();
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
      /sports|sport|体育|新聞|新闻/i.test(`${channel.name} ${channel.username ?? ''}`),
    );

    return named ?? (channels.length === 1 ? channels[0] : null);
  }

  private async generateNews(edition: Edition, dateKey: string) {
    const response = await this.client!.responses.create({
      model: this.config.get<string>('OPENAI_MODEL') || 'gpt-5.5',
      tools: [{ type: 'web_search' }],
      input: [
        `Today is ${dateKey} in Malaysia.`,
        edition === 'MORNING'
          ? 'Find the most important verified sports developments from the previous 24 hours.'
          : 'Find important verified sports developments since this morning and avoid repeating routine earlier stories.',
        'Prioritise football, then basketball, Formula 1 and other major sports.',
        'The news brand name must be 满贯门 M-News.',
        'Use 满贯门 M-News as the only visible news brand name.',
        'Do not write or show Atlas, Atlas Sports News, Atlas News, or MGM News.',
        'The Telegram post must be image plus caption in one message, so keep the full caption under 900 Unicode characters.',
        'Use short conversion-focused sports media copy, not a long report.',
        'Tone: premium, sharp, Malaysian Chinese audience, sports fan community, soft conversion, no hard selling.',
        'Use bilingual Chinese and English, but keep it compact.',
        'Use 3 to 5 top items only.',
        'Each item must have a short bilingual headline and one short bilingual sentence.',
        'For sources, do not output raw long URLs.',
        'Do not include source URLs inside the caption body.',
        'Do not use markdown links.',
        'Do not use HTML tags or markdown bold. Do not use Telegram HTML tags such as <b> or <a>.',
        'Final CTA must be plain text and include this raw URL exactly: https://rebrand.ly/mgmbetae0dcf.',
        'The final line must invite users to follow the latest sports focus through the CTA link.',
        'The digest must be bilingual: Chinese first, then English, or Chinese and English together in each item.',
        'Use 满贯门 M-News as the only visible news brand name.',
        'Do not write or show Atlas, Atlas Sports News, Atlas News, or MGM News.',
        'Keep the digest clean and compact for Telegram.',
        'Each item should be concise and readable, not overly long.',
        'Do not include source URLs inside the caption body.',
        'Do not output raw long URLs inside each item.',
        'Do not duplicate links.',
        'Do not use markdown links.',
        'Do not wrap source URLs in parentheses.',
        'Only the final line may be a raw URL, and it must be exactly https://rebrand.ly/mgmbetae0dcf.',
        'Do not write or show Atlas, Atlas Sports News, Atlas News, or MGM News.',
        'The digest must be bilingual: Chinese first, then English, or Chinese and English together in each item.',
        'Every headline must include both Chinese and English.',
        'Every item summary must include Chinese and English.',
        `The final line must be exactly ${CTA_URL} and nothing may appear after it.`,
        'Write one Telegram-ready bilingual digest for Malaysian readers, Chinese first and English second.',
        'FINAL TELEGRAM CAPTION RULES:',
        'The final caption must be plain text only.',
        'Do not include source links or source URLs in the final caption.',
        'Do not include HTML tags such as <b>, </b>, <a>, or </a>.',
        'Do not include markdown links.',
        'Keep the final caption short, clean, and conversion-focused.',

        'Use 满贯门 M-News as the only visible news brand name.',
        'Do not write or show Atlas, Atlas Sports News, Atlas News, or MGM News.',
        'The Telegram post should be image plus caption in one message whenever possible.',
        'Keep the full caption compact and Telegram-friendly.',
        'Use bilingual Chinese and English, compact and readable.',
        'Use conversion-focused sports media copy: lead users to click, follow, and join, but do not hard sell.',
        'Tone: premium, sharp, exciting, Malaysian Chinese sports community.',
        'Use 3 to 5 top items only.',
        'Each item must have a short bilingual headline and one short bilingual summary sentence.',
        'Do not output raw long source URLs inside news items.',
        'For each source, use short source text only: 来源 / Source: Read more.',
        'Do not use markdown links.',
        'Do not use HTML tags or markdown bold.',
        'The final CTA must include this raw URL exactly: https://rebrand.ly/mgmbetae0dcf',
        'The final CTA must encourage users to join/follow for more sports focus.',
        'Use 5 to 8 concise items, ordered by importance. Each item needs a headline, 1 to 2 short summary sentences and a direct source URL.',
        'Use only established reliable sources, verify event timing, remove rumours and duplicates, and never invent facts or URLs.',
        'Keep the complete post under 3500 Unicode characters.',
        `The final line must be exactly ${CTA_URL} and nothing may appear after it.`,
      ].join('\n'),
    });

    const text = response.output_text?.trim();
    if (!text) {
      throw new Error('The news model returned empty content.');
    }

    const withoutTrailingCta = text
      .replace(new RegExp(`\\s*${CTA_URL.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`), '')
      .trim();
    return this.compactTelegramCaption(withoutTrailingCta);
  }
  private compactTelegramCaption(content: string): string {
    const sourceLine = new RegExp('^来源\\s*/\\s*Source\\s*:', 'i');
    const numberedLine = new RegExp('^[0-9１-９]\\s*[️⃣.)、-]?');
    const numberedEmojiLine = new RegExp('^[0-9]\\ufe0f?\\u20e3');

    const normalised = (content || '')
      .replace(new RegExp('\\\\n', 'g'), '\n')
      .replace(new RegExp('<[^>]+>', 'g'), '')
      .replace(
        new RegExp('\$begin:math:display$\(\[\^\\$end:math:display$]+)\\]\$begin:math:text$https\?\:\/\/\[\^\\\\s\)\]\+\\$end:math:text$', 'g'),
        '$1',
      )
      .replace(new RegExp('\\(\$begin:math:display$\[\^\\$end:math:display$]+\\]', 'g'), '')
      .replace(new RegExp('\$begin:math:display$\[\^\\$end:math:display$]+\\]', 'g'), '')
      .replace(new RegExp('https?://(?!rebrand\\.ly/mgmbetae0dcf)\\S+', 'g'), '')
      .replace(new RegExp('\\*\\*', 'g'), '')
      .replace(new RegExp('Atlas Sports News', 'gi'), '满贯门 M-News')
      .replace(new RegExp('Atlas News', 'gi'), '满贯门 M-News')
      .replace(new RegExp('[ \\t]+\\n', 'g'), '\n')
      .replace(new RegExp('\\n{3,}', 'g'), '\n\n')
      .trim();

    const lines = normalised
      .split(new RegExp('\\n+'))
      .map((line) => line.trim())
      .filter(Boolean);

    const finalLines: string[] = ['满贯门 M-News｜体育焦点 / Sports Focus'];
    let itemCount = 0;

    for (const line of lines) {
      if (sourceLine.test(line)) {
        continue;
      }

      if (line.includes('rebrand.ly/mgmbetae0dcf')) {
        continue;
      }

      if (
        line.includes('满贯门 M-News') ||
        line.includes('体育焦点') ||
        line.includes('Sports Focus') ||
        line.toLowerCase().includes('malaysia sports focus')
      ) {
        continue;
      }

      const isItemTitle = numberedLine.test(line) || numberedEmojiLine.test(line);

      if (isItemTitle) {
        itemCount += 1;

        if (itemCount > 3) {
          break;
        }

        finalLines.push('');
        finalLines.push(
          line
            .replace(new RegExp('来源\\s*/\\s*Source.*$', 'i'), '')
            .trim(),
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

    const title = `满贯门 M-News ${edition} ${dateKey}`;

    const posts = await this.prisma.scheduledPost.findMany({
      where: {
        title,
        platform: 'TELEGRAM',
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

}
