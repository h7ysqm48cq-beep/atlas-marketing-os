import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ScheduledPostStatus,
  SocialChannelStatus,
  SocialPlatform,
} from '../generated/prisma/enums';
import { AutomationService } from './automation.service';
import { TelegramConnectorService } from './telegram-connector.service';
import { FacebookConnectorService } from './facebook-connector.service';
import { SportsNewsAutomationService } from './sports-news-automation.service';

@Controller('automation')
export class AutomationController {
  constructor(
    private readonly automationService:
      AutomationService,
    private readonly telegramConnector:
      TelegramConnectorService,
    private readonly facebookConnector:
      FacebookConnectorService,
    private readonly sportsNewsAutomation:
      SportsNewsAutomationService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.automationService.dashboard();
  }

  @Get('channels')
  channels() {
    return this.automationService.listChannels();
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
    return this.facebookConnector
      .publishPost(
        body.content,
        body.link,
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

  @Post('sports-news/run')
  runSportsNewsNow() {
    return this.sportsNewsAutomation.run('MANUAL');
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
