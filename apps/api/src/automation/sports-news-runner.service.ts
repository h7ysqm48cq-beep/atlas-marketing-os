import { Injectable, Logger } from '@nestjs/common';
import { SportsNewsGeneratorService } from '../news/sports-news-generator.service';
import { SportsNewsImageService } from '../news/sports-news-image.service';
import { SportsNewsPublishService } from '../news/sports-news-publish.service';
import { SportsNewsRunHistoryService } from '../news/sports-news-run-history.service';
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
    private readonly runHistory: SportsNewsRunHistoryService,
  ) {}

  async run(
    kind: SportsNewsRunKind,
    trigger: 'schedule' | 'manual' = 'schedule',
  ) {
    if (this.running.has(kind))
      return { skipped: true, reason: 'already_running', kind };
    this.running.add(kind);
    let runId: string | null = null;
    let sourceCount = 0;
    let rejectedSourceCount = 0;
    try {
      const settings = await this.settingsService.get();
      if (!settings.enabled)
        return { skipped: true, reason: 'sports_news_disabled', kind };
      if (kind === 'morning' && !settings.morningEnabled)
        return { skipped: true, reason: 'morning_disabled', kind };
      if (kind === 'evening' && !settings.eveningEnabled)
        return { skipped: true, reason: 'evening_disabled', kind };
      const telegram =
        settings.telegramEnabled &&
        (kind === 'morning'
          ? settings.morningTelegramEnabled
          : settings.eveningTelegramEnabled);
      const facebook =
        settings.facebookEnabled &&
        (kind === 'morning'
          ? settings.morningFacebookEnabled
          : settings.eveningFacebookEnabled);
      if (!telegram && !facebook)
        return { skipped: true, reason: 'no_enabled_destination', kind };
      if (telegram && !settings.telegramChannelId)
        throw new Error(
          'Telegram publishing is enabled but no Telegram channel is selected.',
        );
      if (facebook && !settings.facebookChannelId)
        throw new Error(
          'Facebook publishing is enabled but no Facebook page is selected.',
        );

      const lock = await this.runHistory.acquire({
        kind,
        trigger,
        timezone: settings.timezone,
      });
      if (!lock.acquired) {
        this.logger.warn(
          `Sports news ${kind}: duplicate scheduled run skipped (${lock.runKey}).`,
        );
        return {
          skipped: true,
          reason: 'duplicate_scheduled_run',
          kind,
          runKey: lock.runKey,
        };
      }
      runId = lock.run.id;

      await this.settingsService.markRun(kind, 'FETCHING_SOURCES');
      const sourceResult = await this.sourceService.fetchLatest(
        kind,
        settings.timezone,
      );
      const validation = this.sourceValidator.validate(sourceResult.sources, {
        timezone: settings.timezone,
        sameDaySourcesOnly: settings.sameDaySourcesOnly,
        maxSourceAgeHours: settings.maxSourceAgeHours,
        requirePublishedAt: settings.requirePublishedAt,
        requireSourceUrl: settings.requireSourceUrl,
        minimumSources: settings.minimumSources,
        freshnessFallbackEnabled: settings.freshnessFallbackEnabled,
      });
      sourceCount = validation.accepted.length;
      rejectedSourceCount = validation.rejected.length;

      await this.settingsService.markRun(kind, 'GENERATING');
      const generated = await this.generator.generate(
        kind,
        validation.accepted,
        {
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
        },
      );

      let image: Awaited<ReturnType<SportsNewsImageService['generate']>> = null;
      let imageError: string | null = null;

      if (settings.imageEnabled) {
        await this.settingsService.markRun(kind, 'GENERATING_IMAGE');

        try {
          image = await this.imageGenerator.generate(kind, generated.content, {
            imageEnabled: settings.imageEnabled,
            imagePrompt: settings.imagePrompt,
            morningImagePrompt: settings.morningImagePrompt,
            eveningImagePrompt: settings.eveningImagePrompt,
            imageAspectRatio: settings.imageAspectRatio,
            imageTextMode: settings.imageTextMode,
            imageVisualStyle: settings.imageVisualStyle,

            logoEnabled: settings.logoEnabled,
            logoAssetId: settings.logoAssetId,
            logoPosition: settings.logoPosition,
            logoSize: settings.logoSize,
            logoOpacity: settings.logoOpacity,
            logoMargin: settings.logoMargin,

            brandFooterEnabled: settings.brandFooterEnabled,
            brandFooterText: settings.brandFooterText,

            footerLogoEnabled: settings.footerLogoEnabled,
            footerLogoAssetId: settings.footerLogoAssetId,

            footerQrEnabled: settings.footerQrEnabled,
            footerQrAssetId: settings.footerQrAssetId,
            footerQrLink: settings.footerQrLink,

            footerPlacement: settings.footerPlacement,
          });
        } catch (error) {
          imageError =
            error instanceof Error
              ? error.message
              : 'Unknown sports news image generation error';

          this.logger.warn(
            [
              `Sports news ${kind}: image generation failed.`,
              'Continuing with text-only publication.',
              `error=${imageError}`,
            ].join(' '),
          );

          image = null;
        }
      }

      await this.settingsService.markRun(kind, 'QUEUEING');
      const queued = await this.newsPublisher.queue({
        kind,
        content: generated.content,
        mediaUrls: image?.imageDataUrl ? [image.imageDataUrl] : [],
        timezone: settings.timezone,
        autoPublishEnabled: settings.autoPublishEnabled,
        approvalRequired: settings.approvalRequired,
        telegram,
        telegramChannelId: settings.telegramChannelId,
        facebook,
        facebookChannelId: settings.facebookChannelId,
      });
      const finalStatus = queued.queued ? 'QUEUED' : 'AWAITING_APPROVAL';
      const postIds = queued.posts.map((post) => post.id);
      await this.settingsService.markRun(kind, finalStatus);
      await this.runHistory.complete(runId, {
        status: finalStatus,
        sourceCount,
        rejectedSourceCount,
        scheduledPostIds: postIds,
      });
      this.logger.log(
        `Sports news ${kind}: ${finalStatus}. ${sourceCount} verified source(s), ${queued.posts.length} post(s), image=${Boolean(image)}, imageError=${imageError ?? 'none'}.`,
      );
      return {
        skipped: false,
        kind,
        trigger,
        runId,
        status: finalStatus,
        provider: sourceResult.provider,
        fetchedAt: sourceResult.fetchedAt,
        sourceCount,
        rejectedSourceCount,
        content: generated.content,
        imageGenerated: Boolean(image),
        imageError,
        watermarkApplied: image?.watermarkApplied ?? false,
        footerApplied: image?.footerApplied ?? false,
        scheduledPostIds: postIds,
        scheduledPostStatus: queued.status,
        ai: {
          provider: generated.provider,
          model: generated.model,
          usage: generated.usage,
        },
        destinations: { telegram, facebook },
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown sports news runner error';
      await this.settingsService
        .markRun(kind, 'FAILED', message)
        .catch(() => undefined);
      if (runId)
        await this.runHistory
          .complete(runId, {
            status: 'FAILED',
            sourceCount,
            rejectedSourceCount,
            error: message,
          })
          .catch(() => undefined);
      this.logger.error(`Sports news ${kind} run failed: ${message}`);
      throw error;
    } finally {
      this.running.delete(kind);
    }
  }
}
