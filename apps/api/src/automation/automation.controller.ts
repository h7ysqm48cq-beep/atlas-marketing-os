import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ScheduledPostStatus,
  SocialChannelStatus,
  SocialPlatform,
} from '../generated/prisma/enums';
import { AutomationService } from './automation.service';
import { TelegramConnectorService } from './telegram-connector.service';
import { FacebookConnectorService } from './facebook-connector.service';
import { FacebookOAuthService } from './facebook-oauth.service';
import { RuntimeProfileService } from './runtime-profile.service';

@Controller('automation')
export class AutomationController {
  constructor(
    private readonly automationService:
      AutomationService,
    private readonly telegramConnector:
      TelegramConnectorService,
    private readonly facebookConnector:
      FacebookConnectorService,
    private readonly facebookOAuth:
      FacebookOAuthService,
    private readonly runtimeProfiles:
      RuntimeProfileService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.automationService.dashboard();
  }

  @Get('channels')
  channels() {
    return this.automationService.listChannels();
  }

  @Get('channels/:id')
  getChannel(
    @Param('id') id: string,
  ) {
    return this.automationService
      .getChannel(id);
  }

  @Post('runtime-profiles/backfill')
  backfillRuntimeProfiles() {
    return this.runtimeProfiles
      .backfillMissingProfiles();
  }


  @Get('channels/:id/runtime-profile')
  getRuntimeProfile(
    @Param('id') id: string,
  ) {
    return this.runtimeProfiles
      .getForChannel(id);
  }

  @Put('channels/:id/runtime-profile')
  updateRuntimeProfile(
    @Param('id') id: string,
    @Body()
    body: {
      browserProfileName?: string;
      locale?: string;
      timezone?: string;
      proxyType?:
        | 'DIRECT'
        | 'HTTP'
        | 'HTTPS'
        | 'SOCKS5';
      proxyHost?: string | null;
      proxyPort?: number | null;
      proxyUsername?: string | null;
      proxyPassword?: string | null;
      proxyCountry?: string | null;
    },
  ) {
    return this.runtimeProfiles
      .upsertForChannel(
        id,
        body,
      );
  }


  @Post('channels/:id/runtime-profile/test-proxy')
  testRuntimeProfileProxy(
    @Param('id') id: string,
  ) {
    return this.runtimeProfiles
      .testProxy(id);
  }


  @Post('channels/:id/test')
  testChannel(
    @Param('id') id: string,
  ) {
    return this.automationService
      .testChannel(id);
  }

  @Post('channels/:id/disconnect')
  disconnectChannel(
    @Param('id') id: string,
  ) {
    return this.automationService
      .disconnectChannel(id);
  }

  @Delete('channels/:id')
  removeChannel(
    @Param('id') id: string,
  ) {
    return this.automationService
      .removeChannel(id);
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
    return this.automationService.createChannel(
      body,
    );
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
    return this.automationService.updateChannel(
      id,
      body,
    );
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

  @Get('posts')
  posts(
    @Query('status')
    status?: ScheduledPostStatus,
  ) {
    return this.automationService.listPosts(
      status,
    );
  }

  @Get('posts/:id')
  getPost(
    @Param('id') id: string,
  ) {
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
    return this.automationService.createPost(
      body,
    );
  }


  @Post('multi-publish')
  multiPublish(
    @Body()
    body: {
      brandId: string;
      campaignId?: string;
      historyId?: string;
      title?: string;
      contents: Partial<
        Record<
          SocialPlatform,
          string
        >
      >;
      mediaUrls?: Partial<
        Record<
          SocialPlatform,
          string[]
        >
      >;
      platforms: SocialPlatform[];
      scheduledAt: string;
      timezone?: string;
      queueImmediately?: boolean;
    },
  ) {
    return this.automationService
      .createMultiPlatformPosts(body);
  }

  @Patch('posts/:id')
  updatePost(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.automationService.updatePost(
      id,
      body,
    );
  }

  @Delete('posts/:id')
  removePost(
    @Param('id') id: string,
  ) {
    return this.automationService.removePost(id);
  }

  @Post('posts/:id/queue')
  queuePost(
    @Param('id') id: string,
  ) {
    return this.automationService.queuePost(id);
  }

  @Post('posts/:id/retry')
  retryPost(
    @Param('id') id: string,
  ) {
    return this.automationService.retryPost(id);
  }

  @Post('posts/:id/cancel')
  cancelPost(
    @Param('id') id: string,
  ) {
    return this.automationService.cancelPost(id);
  }


  @Get('facebook/connect')
  connectFacebook(
    @Query('brandId')
    brandId: string,
  ) {
    return this.facebookOAuth
      .createAuthorizationUrl(
        brandId,
      );
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
      const result =
        await this.facebookOAuth
          .handleCallback({
            code,
            state,
            error,
            errorDescription,
          });

      return response.redirect(
        this.facebookOAuth
          .buildSuccessRedirect({
            importedCount:
              result.imported.length,
            brandId:
              result.brand.id,
          }),
      );
    } catch (callbackError) {
      const message =
        callbackError instanceof Error
          ? callbackError.message
          : 'Facebook connection failed.';

      return response.redirect(
        this.facebookOAuth
          .buildErrorRedirect(
            message,
          ),
      );
    }
  }


  @Post('facebook/test')
  testFacebook() {
    return this.facebookConnector
      .testConnection();
  }

  @Post('facebook/test-post')
  testFacebookPost() {
    return this.facebookConnector
      .sendTestPost();
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
    return this.telegramConnector.sendMessage(
      body.content,
    );
  }

  

  @Post("run")
  runPublisher() {
    return this.automationService.runPublisher();
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
    return this.automationService.updateSettings(
      body,
    );
  }
}
