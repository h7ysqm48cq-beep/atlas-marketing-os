import { Injectable, Logger } from '@nestjs/common';
import { SportsNewsGeneratorService } from '../news/sports-news-generator.service';
import { SportsNewsImageService } from '../news/sports-news-image.service';
import { SportsNewsPublishService } from '../news/sports-news-publish.service';
import { SportsNewsSourceService } from '../news/sports-news-source.service';
import { SportsNewsSettingsService } from './sports-news-settings.service';
import { SportsNewsSourceValidatorService } from './sports-news-source-validator.service';

export type SportsNewsRunKind = 'morning' | 'evening';

@Injectable()
export class SportsNewsRunnerService {
  private readonly logger = new Logger(SportsNewsRunnerService.name);
  private running = new Set<SportsNewsRunKind>();

  constructor(
    private readonly settingsService: SportsNewsSettingsService,
    private readonly sourceService: SportsNewsSourceService,
    private readonly sourceValidator: SportsNewsSourceValidatorService,
    private readonly generator: SportsNewsGeneratorService,
    private readonly imageGenerator: SportsNewsImageService,
    private readonly newsPublisher: SportsNewsPublishService,
  ) {}

  async run(kind: SportsNewsRunKind, trigger: 'schedule' | 'manual' = 'schedule') {
    if (this.running.has(kind)) return { skipped: true, reason: 'already_running', kind };
    this.running.add(kind);
    try {
      const settings = await this.settingsService.get();
      if (!settings.enabled) return { skipped: true, reason: 'sports_news_disabled', kind };
      if (kind === 'morning' && !settings.morningEnabled) return { skipped: true, reason: 'morning_disabled', kind };
      if (kind === 'evening' && !settings.eveningEnabled) return { skipped: true, reason: 'evening_disabled', kind };

      const telegram = settings.telegramEnabled && (kind === 'morning' ? settings.morningTelegramEnabled : settings.eveningTelegramEnabled);
      const facebook = settings.facebookEnabled && (kind === 'morning' ? settings.morningFacebookEnabled : settings.eveningFacebookEnabled);
      if (!telegram && !facebook) return { skipped: true, reason: 'no_enabled_destination', kind };
      if (telegram && !settings.telegramChannelId) throw new Error('Telegram publishing is enabled but no Telegram channel is selected.');
      if (facebook && !settings.facebookChannelId) throw new Error('Facebook publishing is enabled but no Facebook page is selected.');

      await this.settingsService.markRun(kind, 'FETCHING_SOURCES');
      const sourceResult = await this.sourceService.fetchLatest(kind, settings.timezone);
      const validation = this.sourceValidator.validate(sourceResult.sources, {
        timezone: settings.timezone,
        sameDaySourcesOnly: settings.sameDaySourcesOnly,
        maxSourceAgeHours: settings.maxSourceAgeHours,
        requirePublishedAt: settings.requirePublishedAt,
        requireSourceUrl: settings.requireSourceUrl,
        minimumSources: settings.minimumSources,
        freshnessFallbackEnabled: settings.freshnessFallbackEnabled,
      });

      await this.settingsService.markRun(kind, 'GENERATING');
      const generated = await this.generator.generate(kind, validation.accepted, {
        language: settings.language,
        sportsKnowledgeEnabled: settings.sportsKnowledgeEnabled,
        discussionQuestionEnabled: settings.discussionQuestionEnabled,
        referenceLinksEnabled: settings.referenceLinksEnabled,
        customPromptEnabled: settings.customPromptEnabled,
        systemPrompt: settings.systemPrompt,
        morningPrompt: settings.morningPrompt,
        eveningPrompt: settings.eveningPrompt,
        knowledgePrompt: settings.knowledgePrompt,
        customInstructions: settings.customInstructions,
      });

      let image: Awaited<ReturnType<SportsNewsImageService['generate']>> = null;
      if (settings.imageEnabled) {
        await this.settingsService.markRun(kind, 'GENERATING_IMAGE');
        image = await this.imageGenerator.generate(kind, generated.content, {
          imageEnabled: settings.imageEnabled,
          imagePrompt: settings.imagePrompt,
          morningImagePrompt: settings.morningImagePrompt,
          eveningImagePrompt: settings.eveningImagePrompt,
          imageAspectRatio: settings.imageAspectRatio,
          imageTextMode: settings.imageTextMode,
          imageVisualStyle: settings.imageVisualStyle,
          logoEnabled: settings.logoEnabled,
          logoPosition: settings.logoPosition,
          brandFooterEnabled: settings.brandFooterEnabled,
          brandFooterText: settings.brandFooterText,
        });
      }

      await this.settingsService.markRun(kind, 'QUEUEING');
      const queued = await this.newsPublisher.queue({
        kind,
        content: generated.content,
        mediaUrls: image?.dataUrl ? [image.dataUrl] : [],
        timezone: settings.timezone,
        autoPublishEnabled: settings.autoPublishEnabled,
        approvalRequired: settings.approvalRequired,
        telegram,
        telegramChannelId: settings.telegramChannelId,
        facebook,
        facebookChannelId: settings.facebookChannelId,
      });

      const finalStatus = queued.queued ? 'QUEUED' : 'AWAITING_APPROVAL';
      await this.settingsService.markRun(kind, finalStatus);
      this.logger.log(`Sports news ${kind}: ${finalStatus}. ${validation.accepted.length} verified source(s), ${queued.posts.length} post(s), image=${Boolean(image)}.`);

      return {
        skipped: false,
        kind,
        trigger,
        status: finalStatus,
        provider: sourceResult.provider,
        fetchedAt: sourceResult.fetchedAt,
        sourceCount: validation.accepted.length,
        rejectedSourceCount: validation.rejected.length,
        content: generated.content,
        imageGenerated: Boolean(image),
        scheduledPostIds: queued.posts.map(post => post.id),
        scheduledPostStatus: queued.status,
        ai: { provider: generated.provider, model: generated.model, usage: generated.usage },
        destinations: { telegram, facebook },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sports news runner error';
      await this.settingsService.markRun(kind, 'FAILED', message).catch(() => undefined);
      this.logger.error(`Sports news ${kind} run failed: ${message}`);
      throw error;
    } finally {
      this.running.delete(kind);
    }
  }
}
