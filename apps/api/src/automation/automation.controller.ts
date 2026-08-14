import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  BrowserActionType,
  ScheduledPostStatus,
  SocialChannelStatus,
  SocialPlatform,
} from '../generated/prisma/enums';
import { AutomationService } from './automation.service';
import { TelegramConnectorService } from './telegram-connector.service';
import { FacebookConnectorService } from './facebook-connector.service';
import { FacebookOAuthService } from './facebook-oauth.service';
import { RuntimeProfileService } from './runtime-profile.service';
import { BrowserAccountService } from './browser-account.service';
import { BrowserRuntimeBridgeService } from './browser-runtime-bridge.service';
import { SportsNewsAutomationService } from './sports-news-automation.service';
import { BrowserActionHistoryService } from './browser-action-history.service';
import { BrowserActionTraceService } from './browser-action-trace.service';

function sanitizeBrowserActionResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const cloned = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

  const screenshot = cloned.screenshot;

  if (screenshot && typeof screenshot === 'object') {
    delete (screenshot as Record<string, unknown>).base64;
  }

  const screenshots = cloned.screenshots;

  if (screenshots && typeof screenshots === 'object') {
    for (const item of Object.values(screenshots)) {
      if (item && typeof item === 'object') {
        delete (item as Record<string, unknown>).base64;
      }
    }
  }

  return cloned;
}

type ScreenshotPayload = {
  absolutePath?: unknown;
};

function readScreenshotPath(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const absolutePath = (value as ScreenshotPayload).absolutePath;

  return typeof absolutePath === 'string' ? absolutePath : null;
}

function screenshotPathFromAction(
  responsePayload: unknown,
  variant: 'primary' | 'before' | 'after',
): string | null {
  if (!responsePayload || typeof responsePayload !== 'object') {
    return null;
  }

  const payload = responsePayload as Record<string, unknown>;

  const screenshot = readScreenshotPath(payload.screenshot);

  const screenshots =
    payload.screenshots && typeof payload.screenshots === 'object'
      ? (payload.screenshots as Record<string, unknown>)
      : null;

  const before = readScreenshotPath(screenshots?.before);

  const after = readScreenshotPath(screenshots?.after);

  if (variant === 'before') {
    return before;
  }

  if (variant === 'after') {
    return after;
  }

  return screenshot || after || before;
}

@Controller('automation')
export class AutomationController {
  private readonly postPublishOptions = new Map<
    string,
    { addLogoBeforePublish: boolean; watermarkMode: 'none' | 'logo' }
  >();

  constructor(
    private readonly automationService: AutomationService,
    private readonly telegramConnector: TelegramConnectorService,
    private readonly facebookConnector: FacebookConnectorService,
    private readonly facebookOAuth: FacebookOAuthService,
    private readonly runtimeProfiles: RuntimeProfileService,
    private readonly browserAccounts: BrowserAccountService,
    private readonly browserRuntime: BrowserRuntimeBridgeService,
    private readonly browserActionHistory: BrowserActionHistoryService,
    private readonly browserActionTrace: BrowserActionTraceService,
    private readonly sportsNews: SportsNewsAutomationService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.automationService.dashboard();
  }

  @Get('channels')
  channels() {
    return this.automationService.listChannels();
  }

  /*
   * PUBLISHING_READINESS_DRY_RUN_V1
   *
   * Read-only diagnostic route.
   * Does NOT queue or publish anything.
   */
  @Get('channels/:id/publishing-readiness')
  publishingReadiness(@Param('id') id: string) {
    return this.runtimeProfiles.getBrowserPublishingSafety(id);
  }

  @Get('channels/:id')
  getChannel(@Param('id') id: string) {
    return this.automationService.getChannel(id);
  }

  @Get('browser-actions')
  browserActions(
    @Query('channelId')
    channelId?: string,
    @Query('limit')
    limit?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;

    return this.browserActionHistory.listRecent({
      channelId: channelId?.trim() || undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
  }

  @Get('browser-actions/:id/screenshot')
  async browserActionScreenshot(
    @Param('id') id: string,
    @Query('variant')
    requestedVariant?: string,
    @Res() response?: Response,
  ) {
    const variant: 'primary' | 'before' | 'after' =
      requestedVariant === 'before' || requestedVariant === 'after'
        ? requestedVariant
        : 'primary';

    const action = await this.browserActionHistory.getRequired(id);

    const screenshotPath = screenshotPathFromAction(
      action.responsePayload,
      variant,
    );

    if (!screenshotPath) {
      throw new NotFoundException(
        'Screenshot is not available for this Browser Agent action.',
      );
    }

    const screenshotRoot = path.resolve(
      process.env.BROWSER_SCREENSHOT_ROOT ||
        path.join(homedir(), '.atlas', 'browser-screenshots'),
    );

    let canonicalRoot: string;

    let canonicalScreenshot: string;

    try {
      [canonicalRoot, canonicalScreenshot] = await Promise.all([
        realpath(screenshotRoot),
        realpath(screenshotPath),
      ]);
    } catch {
      throw new NotFoundException(
        'The archived screenshot file could not be found.',
      );
    }

    const insideRoot =
      canonicalScreenshot === canonicalRoot ||
      canonicalScreenshot.startsWith(`${canonicalRoot}${path.sep}`);

    if (!insideRoot) {
      throw new BadRequestException(
        'The screenshot path is outside the configured archive.',
      );
    }

    let image: Buffer;

    try {
      image = await readFile(canonicalScreenshot);
    } catch {
      throw new NotFoundException(
        'The archived screenshot file could not be read.',
      );
    }

    response
      ?.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'Content-Length': String(image.byteLength),
      })
      .send(image);
  }

  @Post('browser-actions/:id/retry')
  async retryBrowserAction(@Param('id') id: string) {
    const previous = await this.browserActionHistory.getRequired(id);

    if (previous.status !== 'FAILED') {
      throw new BadRequestException(
        'Only failed Browser Agent actions can be retried.',
      );
    }

    if (previous.action !== BrowserActionType.PREPARE) {
      throw new BadRequestException(
        'Only failed PREPARE actions currently support retry.',
      );
    }

    const caption = previous.caption?.trim() || '';

    if (!caption) {
      throw new BadRequestException(
        'The failed action does not contain a caption to retry.',
      );
    }

    const profile = await this.runtimeProfiles.getBrowserLaunchProfile(
      previous.channelId,
    );

    const retryAction = await this.browserActionHistory.start({
      channelId: previous.channelId,
      flowId: randomUUID(),
      action: BrowserActionType.PREPARE,
      browserProfileKey: profile.browserProfileKey,
      caption,
      imagePath: previous.imagePath,
      requestPayload: {
        retryOfActionId: previous.id,
        caption,
        imagePath: previous.imagePath,
      },
    });

    try {
      const result = await this.browserRuntime.prepareFacebookPost(
        profile.browserProfileKey,
        {
          caption,
          imagePath: previous.imagePath,
        },
      );

      await this.browserActionHistory.succeed(retryAction.id, {
        responsePayload: sanitizeBrowserActionResponse(result),
      });

      return {
        success: true,
        retried: true,
        retryOfActionId: previous.id,
        actionId: retryAction.id,
        result,
      };
    } catch (error) {
      await this.browserActionHistory.fail(retryAction.id, error);

      throw error;
    }
  }

  @Get('browser-worker/health')
  browserWorkerHealth() {
    return this.browserRuntime.health();
  }

  @Post('channels/:id/browser/open')
  openChannelBrowser(
    @Param('id') id: string,
    @Body()
    body: {
      headless?: boolean;
      startUrl?: string;
    },
  ) {
    return this.browserRuntime.open(id, body);
  }

  @Post('channels/:id/browser/facebook/login')
  async loginFacebookBrowser(
    @Param('id') id: string,
    @Body()
    body: {
      confirmation?: string;
    },
  ) {
    const profile = await this.runtimeProfiles.getBrowserLaunchProfile(id);

    return this.browserRuntime.request(
      `/profiles/${encodeURIComponent(
        profile.browserProfileKey,
      )}/facebook/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirmation: body.confirmation,
        }),
      },
    );
  }

  @Post('channels/:id/browser/facebook/submit-2fa')
  async submitFacebookTwoFactor(
    @Param('id') id: string,
    @Body()
    body: {
      code?: string;
    },
  ) {
    const profile = await this.runtimeProfiles.getBrowserLaunchProfile(id);

    return this.browserRuntime.request(
      `/profiles/${encodeURIComponent(
        profile.browserProfileKey,
      )}/facebook/submit-2fa`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: body.code,
        }),
      },
    );
  }

  @Post('channels/:id/browser/inspect')
  async inspectBrowserPage(@Param('id') id: string) {
    const profile = await this.runtimeProfiles.getBrowserLaunchProfile(id);

    return this.browserRuntime.request(
      `/profiles/${encodeURIComponent(profile.browserProfileKey)}/inspect`,
      {
        method: 'POST',
      },
    );
  }

  @Get('channels/:id/browser/status')
  channelBrowserStatus(@Param('id') id: string) {
    return this.browserRuntime.status(id);
  }

  @Post('channels/:id/browser/facebook/prepare-post')
  async prepareFacebookBrowserPost(
    @Param('id') id: string,
    @Body()
    body: {
      caption?: string;
      imagePath?: string | null;
    },
  ) {
    const caption = body.caption?.trim() || '';

    const imagePath = body.imagePath?.trim() || null;

    const profile = await this.runtimeProfiles.getBrowserLaunchProfile(id);

    const action = await this.browserActionHistory.start({
      channelId: id,
      flowId: randomUUID(),
      action: BrowserActionType.PREPARE,
      browserProfileKey: profile.browserProfileKey,
      caption,
      imagePath,
      requestPayload: {
        caption,
        imagePath,
      },
    });

    const prepareRequestTrace = await this.browserActionTrace.startStep({
      browserActionId: action.id,
      stepKey: 'PREPARE_REQUEST',
      stepName: 'Prepare Facebook draft request',
      stepOrder: 0,
      metadata: {
        channelId: id,
        browserProfileKey: profile.browserProfileKey,
      },
    });

    try {
      const result = await this.browserRuntime.prepareFacebookPostForChannel(
        id,
        {
          caption,
          imagePath,
        },
      );

      const prepareResult = result as {
        executionTrace?: unknown;
      };

      await this.browserActionTrace.importWorkerTrace(
        action.id,
        prepareResult.executionTrace,
      );

      await this.browserActionTrace.succeedStep(prepareRequestTrace.id, {
        metadata: {
          browserProfileKey: profile.browserProfileKey,
          resultReceived: true,
        },
      });

      await this.browserActionHistory.succeed(action.id, {
        responsePayload: sanitizeBrowserActionResponse(result),
      });

      return result;
    } catch (error) {
      await this.browserActionTrace.failStep(prepareRequestTrace.id, error);

      await this.browserActionHistory.fail(action.id, error);

      throw error;
    }
  }

  @Post('browser-actions/:actionId/replay')
  async replayFacebookBrowserAction(
    @Param('actionId')
    actionId: string,
  ) {
    const previous = await this.browserActionHistory.getRequired(actionId);

    if (previous.action !== BrowserActionType.PREPARE) {
      throw new BadRequestException(
        'Replay v1 currently supports PREPARE actions only.',
      );
    }

    const caption = previous.caption?.trim() || '';

    if (!caption) {
      throw new BadRequestException(
        'The selected PREPARE action does not contain a caption.',
      );
    }

    const profile = await this.runtimeProfiles.getBrowserLaunchProfile(
      previous.channelId,
    );

    const replayAction = await this.browserActionHistory.start({
      channelId: previous.channelId,
      flowId: randomUUID(),
      action: BrowserActionType.PREPARE,
      browserProfileKey: profile.browserProfileKey,
      caption,
      imagePath: previous.imagePath,
      requestPayload: {
        replayOfActionId: previous.id,
        caption,
        imagePath: previous.imagePath,
      },
    });

    const replayRequestTrace = await this.browserActionTrace.startStep({
      browserActionId: replayAction.id,
      stepKey: 'REPLAY_REQUEST',
      stepName: 'Replay Facebook draft request',
      stepOrder: 0,
      metadata: {
        replayOfActionId: previous.id,
        originalFlowId: previous.flowId,
        channelId: previous.channelId,
        browserProfileKey: profile.browserProfileKey,
      },
    });

    const ensureProfileTrace = await this.browserActionTrace.startStep({
      browserActionId: replayAction.id,
      stepKey: 'ENSURE_BROWSER_PROFILE',
      stepName: 'Ensure browser profile is running',
      stepOrder: -1,
      metadata: {
        channelId: previous.channelId,
        browserProfileKey: profile.browserProfileKey,
      },
    });

    try {
      const ensuredProfile = await this.browserRuntime.ensureProfile(
        previous.channelId,
        {
          headless: false,
          startUrl: 'https://www.facebook.com/',
        },
      );

      await this.browserActionTrace.succeedStep(ensureProfileTrace.id, {
        metadata: {
          channelId: previous.channelId,
          browserProfileKey: ensuredProfile.browserProfileKey,
          ensured: true,
        },
      });

      const ensured = await this.browserRuntime.ensureProfile(
        previous.channelId,
        {
          headless: false,
          startUrl: 'https://www.facebook.com/',
        },
      );

      await this.browserActionTrace.succeedStep(ensureProfileTrace.id, {
        metadata: {
          channelId: previous.channelId,
          browserProfileKey: ensuredProfile.browserProfileKey,
          ensured: true,
        },
      });

      const result = await this.browserRuntime.prepareFacebookPost(
        ensuredProfile.browserProfileKey,
        {
          caption,
          imagePath: previous.imagePath,
        },
      );

      const replayResult = result as {
        executionTrace?: unknown;
      };

      await this.browserActionTrace.importWorkerTrace(
        replayAction.id,
        replayResult.executionTrace,
      );

      await this.browserActionTrace.succeedStep(replayRequestTrace.id, {
        metadata: {
          replayOfActionId: previous.id,
          browserProfileKey: profile.browserProfileKey,
          resultReceived: true,
        },
      });

      await this.browserActionHistory.succeed(replayAction.id, {
        responsePayload: sanitizeBrowserActionResponse(result),
      });

      return {
        success: true,
        replayed: true,
        replayOfActionId: previous.id,
        actionId: replayAction.id,
        flowId: replayAction.flowId,
        result,
      };
    } catch (error) {
      await this.browserActionTrace
        .failStep(ensureProfileTrace.id, error)
        .catch(() => undefined);

      await this.browserActionTrace
        .failStep(replayRequestTrace.id, error)
        .catch(() => undefined);

      await this.browserActionHistory.fail(replayAction.id, error);

      throw error;
    }
  }

  @Post('channels/:id/browser/facebook/discard-post')
  async discardFacebookBrowserPost(@Param('id') id: string) {
    const profile = await this.runtimeProfiles.getBrowserLaunchProfile(id);

    const flowId = await this.browserActionHistory.findOpenFlowId(id);

    const action = await this.browserActionHistory.start({
      channelId: id,
      flowId,
      action: BrowserActionType.DISCARD,
      browserProfileKey: profile.browserProfileKey,
      requestPayload: {
        channelId: id,
      },
    });

    try {
      const result = await this.browserRuntime.discardFacebookPost(id);

      const discardResult = result as {
        success?: boolean;
        discarded?: boolean;
        alreadyClosed?: boolean;
        executionTrace?: unknown;
      };

      await this.browserActionTrace.importWorkerTrace(
        action.id,
        discardResult.executionTrace,
      );

      const sanitizedResult = sanitizeBrowserActionResponse(result);

      await this.browserActionHistory.succeed(action.id, {
        responsePayload: sanitizedResult,
      });

      return result;
    } catch (error) {
      await this.browserActionHistory.fail(action.id, error);

      throw error;
    }
  }

  @Post('channels/:id/browser/facebook/publish-post')
  async publishFacebookBrowserPost(
    @Param('id') id: string,
    @Body()
    body: {
      confirmation?: string;
    },
  ) {
    const confirmation = body.confirmation || '';

    const profile = await this.runtimeProfiles.getBrowserLaunchProfile(id);

    const flowId = await this.browserActionHistory.findOpenFlowId(id);

    const action = await this.browserActionHistory.start({
      channelId: id,
      flowId,
      action: BrowserActionType.PUBLISH,
      browserProfileKey: profile.browserProfileKey,
      requestPayload: {
        confirmation,
      },
    });

    try {
      const result = await this.browserRuntime.publishFacebookPost(
        id,
        confirmation,
      );

      const publishResult = result as {
        success?: boolean;
        published?: boolean;
        executionTrace?: unknown;
        verification?: {
          status?: string;
        };
      };

      await this.browserActionTrace.importWorkerTrace(
        action.id,
        publishResult.executionTrace,
      );

      const sanitizedResult = sanitizeBrowserActionResponse(result);

      const verificationStatus = publishResult.verification?.status;

      const publishConfirmed =
        publishResult.published === true &&
        (verificationStatus === 'CONFIRMED' ||
          verificationStatus === 'COMPOSER_CLOSED');

      if (!publishConfirmed) {
        const publishError = new Error(
          verificationStatus === 'UNCONFIRMED'
            ? 'Facebook publishing could not be confirmed.'
            : verificationStatus === 'FAILED'
              ? 'Facebook publishing failed.'
              : 'Facebook did not confirm that the post was published.',
        );

        await this.browserActionHistory.fail(
          action.id,
          publishError,
          sanitizedResult,
        );

        return result;
      }

      await this.browserActionHistory.succeed(action.id, {
        responsePayload: sanitizedResult,
      });

      return result;
    } catch (error) {
      await this.browserActionHistory.fail(action.id, error);

      throw error;
    }
  }

  @Post('channels/:id/browser/check-ip')
  checkChannelBrowserIp(@Param('id') id: string) {
    return this.browserRuntime.checkIp(id);
  }

  @Post('channels/:id/browser/close')
  closeChannelBrowser(@Param('id') id: string) {
    return this.browserRuntime.close(id);
  }

  @Post('runtime-profiles/backfill')
  backfillRuntimeProfiles() {
    return this.runtimeProfiles.backfillMissingProfiles();
  }

  @Get('channels/:id/runtime-profile')
  getRuntimeProfile(@Param('id') id: string) {
    return this.runtimeProfiles.getForChannel(id);
  }

  @Put('channels/:id/runtime-profile')
  updateRuntimeProfile(
    @Param('id') id: string,
    @Body()
    body: {
      browserProfileName?: string;
      locale?: string;
      timezone?: string;
      proxyType?: 'DIRECT' | 'HTTP' | 'HTTPS' | 'SOCKS5';
      proxyHost?: string | null;
      proxyPort?: number | null;
      proxyUsername?: string | null;
      proxyPassword?: string | null;
      proxyCountry?: string | null;
    },
  ) {
    return this.runtimeProfiles.upsertForChannel(id, body);
  }

  @Post('channels/:id/runtime-profile/test-proxy')
  testRuntimeProfileProxy(@Param('id') id: string) {
    return this.runtimeProfiles.testProxy(id);
  }

  @Post('channels/:id/test')
  testChannel(@Param('id') id: string) {
    return this.automationService.testChannel(id);
  }

  @Post('channels/:id/disconnect')
  disconnectChannel(@Param('id') id: string) {
    return this.automationService.disconnectChannel(id);
  }

  @Delete('channels/:id')
  removeChannel(@Param('id') id: string) {
    return this.automationService.removeChannel(id);
  }

  @Post('channels')
  createChannel(
    @Body()
    body: {
      brandId: string;
      platform: SocialPlatform;
      name: string;
      externalId?: string;
      username?: string;
      accessToken?: string;
      tokenExpiresAt?: string | null;
    },
  ) {
    return this.automationService.createChannel(body);
  }

  @Post('telegram/inspect-bot')
  inspectTelegramBot(@Body() body: { botToken: string }) {
    return this.automationService.inspectTelegramBot(body.botToken);
  }

  @Patch('channels/:id')
  updateChannel(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      externalId?: string;
      username?: string | null;
      accessToken?: string | null;
      tokenExpiresAt?: string | null;
    },
  ) {
    return this.automationService.updateChannel(id, body);
  }

  @Patch('channels/:id/status')
  updateChannelStatus(
    @Param('id') id: string,
    @Body()
    body: {
      status: SocialChannelStatus;
      lastError?: string;
    },
  ) {
    return this.automationService.updateChannelStatus(
      id,
      body.status,
      body.lastError,
    );
  }

  @Get('posts/calendar')
  calendarPosts(
    @Query('status')
    status?: ScheduledPostStatus,
    @Query('from')
    from?: string,
    @Query('to')
    to?: string,
    @Query('limit')
    limit?: string,
  ) {
    return this.automationService.listCalendarPosts(
      status,
      from,
      to,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('posts')
  posts(
    @Query('status')
    status?: ScheduledPostStatus,
    @Query('from')
    from?: string,
    @Query('to')
    to?: string,
    @Query('limit')
    limit?: string,
  ) {
    return this.automationService.listPosts(
      status,
      from,
      to,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('posts/:id')
  getPost(@Param('id') id: string) {
    return this.automationService.getPost(id);
  }

  @Post('posts')
  createPost(
    @Body()
    body: {
      brandId: string;
      channelId: string;
      campaignId?: string;
      historyId?: string;
      platform: SocialPlatform;
      title?: string;
      content: string;
      mediaUrls?: string[];
      scheduledAt: string;
      timezone?: string;
      status?: ScheduledPostStatus;
    },
  ) {
    return this.automationService.createPost(body);
  }

  @Post('multi-publish')
  multiPublish(
    @Body()
    body: {
      brandId: string;
      campaignId?: string;
      historyId?: string;
      title?: string;
      contents: Partial<Record<SocialPlatform, string>>;
      mediaUrls?: Partial<Record<SocialPlatform, string[]>>;
      platforms: SocialPlatform[];
      scheduledAt: string;
      timezone?: string;
      queueImmediately?: boolean;
    },
  ) {
    return this.automationService.createMultiPlatformPosts(body);
  }

  @Patch('posts/:id')
  updatePost(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.automationService.updatePost(id, body);
  }

  @Delete('posts/:id')
  removePost(@Param('id') id: string) {
    return this.automationService.removePost(id);
  }

  @Post('posts/:id/queue')
  queuePost(@Param('id') id: string) {
    return this.automationService.queuePost(id);
  }

  @Post('posts/:id/retry')
  retryPost(@Param('id') id: string) {
    return this.automationService.retryPost(id);
  }

  @Post('posts/:id/cancel')
  cancelPost(@Param('id') id: string) {
    return this.automationService.cancelPost(id);
  }

  @Get('facebook/connect')
  connectFacebook(
    @Query('brandId')
    brandId: string,
  ) {
    return this.facebookOAuth.createAuthorizationUrl(brandId);
  }

  @Get('facebook/callback')
  async facebookCallback(
    @Query('code')
    code: string | undefined,
    @Query('state')
    state: string | undefined,
    @Query('error')
    error: string | undefined,
    @Query('error_description')
    errorDescription: string | undefined,
    @Res()
    response: Response,
  ) {
    try {
      const result = await this.facebookOAuth.handleCallback({
        code,
        state,
        error,
        errorDescription,
      });

      return response.redirect(
        this.facebookOAuth.buildSuccessRedirect({
          importedCount: result.imported.length,
          brandId: result.brand.id,
        }),
      );
    } catch (callbackError) {
      const message =
        callbackError instanceof Error
          ? callbackError.message
          : 'Facebook connection failed.';

      return response.redirect(this.facebookOAuth.buildErrorRedirect(message));
    }
  }

  @Post('facebook/test')
  testFacebook() {
    return this.facebookConnector.testConnection();
  }

  @Post('facebook/test-post')
  testFacebookPost() {
    return this.facebookConnector.sendTestPost();
  }

  @Post('facebook/publish')
  publishFacebook(
    @Body()
    body: {
      content: string;
      link?: string;
    },
  ) {
    throw new BadRequestException(
      [
        'Direct Facebook publishing is disabled.',
        'Create or select a Facebook social channel',
        'and publish through the channel-based automation flow.',
      ].join(' '),
    );
  }

  @Post('telegram/test')
  testTelegram() {
    return this.telegramConnector.testConnection();
  }

  @Post('telegram/test-message')
  testTelegramMessage() {
    return this.telegramConnector.sendTestMessage();
  }

  @Post('telegram/publish')
  publishTelegram(
    @Body()
    body: {
      content: string;
    },
  ) {
    return this.telegramConnector.sendMessage(body.content);
  }

  @Post('run')
  runPublisher() {
    return this.automationService.runPublisher();
  }

  @Post('sports-news/morning/force')
  async forceSportsNewsMorning() {
    return this.sportsNews.forceCreateMorningEditionNow();
  }

  @Post('sports-news/evening/force')
  async forceSportsNewsEvening() {
    return this.sportsNews.forceCreateEveningEditionNow();
  }

  @Get('sports-news/status')
  getSportsNewsStatus() {
    return this.sportsNews.getStatus();
  }

  @Post('sports-news/morning')
  createSportsNewsMorning() {
    return this.sportsNews.createMorningEditionNow();
  }

  @Post('sports-news/evening')
  createSportsNewsEvening() {
    return this.sportsNews.createEveningEditionNow();
  }

  @Get('settings')
  settings() {
    return this.automationService.getSettings();
  }

  @Patch('settings')
  updateSettings(
    @Body()
    body: {
      timezone?: string;
      approvalRequired?: boolean;
      autoPublishEnabled?: boolean;
      retryLimit?: number;
      retryDelayMinutes?: number;
      defaultFacebookTime?: string;
      defaultTelegramTime?: string;
    },
  ) {
    return this.automationService.updateSettings(body);
  }

  @Get('browser-accounts')
  listBrowserAccounts() {
    return this.browserAccounts.list();
  }

  @Get('browser-accounts/:id')
  getBrowserAccount(@Param('id') id: string) {
    return this.browserAccounts.getById(id);
  }

  @Post('browser-accounts')
  createBrowserAccount(
    @Body()
    body: {
      displayName: string;
      platform?: 'FACEBOOK';
      browserProfileName?: string;
      locale?: string;
      timezone?: string;
      proxyType?: 'DIRECT' | 'HTTP' | 'HTTPS' | 'SOCKS5';
      proxyHost?: string | null;
      proxyPort?: number | null;
      proxyUsername?: string | null;
      proxyPassword?: string | null;
      proxyCountry?: string | null;
      workspaceId?: string | null;
      brandId?: string | null;
    },
  ) {
    return this.browserAccounts.create(body as any);
  }

  @Get('posts/:id/preview')
  async getPostPreview(@Param('id') id: string) {
    const post = await this.automationService.getPost(id);

    if (!post) {
      throw new NotFoundException('Scheduled post not found.');
    }

    const previewOptions = this.postPublishOptions.get(id) || {
      addLogoBeforePublish: false,
      watermarkMode: 'none' as const,
    };

    return {
      ...post,
      previewOptions,
    };
  }

  @Patch('posts/:id/publish-options')
  async updatePostPublishOptions(
    @Param('id') id: string,
    @Body()
    body: {
      addLogoBeforePublish?: boolean;
    },
  ) {
    const post = await this.automationService.getPost(id);

    if (!post) {
      throw new NotFoundException('Scheduled post not found.');
    }

    const next = {
      addLogoBeforePublish: Boolean(body.addLogoBeforePublish),
      watermarkMode: body.addLogoBeforePublish
        ? ('logo' as const)
        : ('none' as const),
    };

    this.postPublishOptions.set(id, next);

    return {
      id,
      title: post.title,
      status: post.status,
      previewOptions: next,
    };
  }

  @Post('posts/:id/publish-now')
  async publishPostNow(@Param('id') id: string) {
    const post = await this.automationService.getPost(id);

    if (!post) {
      throw new NotFoundException('Scheduled post not found.');
    }

    if (post.status === 'PUBLISHED') {
      throw new BadRequestException('Post is already published.');
    }

    return this.automationService.retryPost(id);
  }
}
