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

  private async createEdition(edition: Edition) {
    if (this.config.get<string>('SPORTS_NEWS_ENABLED') !== 'true') {
      return;
    }

    if (!this.client || this.running) {
      this.logger.warn(
        this.running
          ? 'Sports news generation is already running.'
          : 'OPENAI_API_KEY is unavailable; sports news was skipped.',
      );
      return;
    }

    this.running = true;

    try {
      const channel = await this.resolveChannel();
      if (!channel) {
        this.logger.warn('No connected Sports News Telegram channel was found.');
        return;
      }

      const dateKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const title = `Atlas Sports News ${edition} ${dateKey}`;

      const existing = await this.prisma.scheduledPost.findFirst({
        where: { channelId: channel.id, title },
      });
      if (existing) {
        this.logger.log(`Sports news already exists: ${title}`);
        return;
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

      await this.prisma.scheduledPost.create({
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
    } catch (error) {
      this.logger.error(
        `Sports news generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
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
        'Write one Telegram-ready bilingual digest for Malaysian readers, Chinese first and English second.',
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
    return `${withoutTrailingCta}\n\n${CTA_URL}`;
  }
}
