import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  SocialPlatform,
  SocialProxyType,
} from '../../generated/prisma/client';
import {
  BrowserAccountService,
} from '../services/browser-account.service';
import {
  BrowserLeaseService,
} from '../services/browser-lease.service';
import {
  BrowserSessionService,
} from '../services/browser-session.service';
import {
  BrowserTimelineService,
} from '../services/browser-timeline.service';
import {
  BrowserAutomationPolicyService,
} from '../services/browser-automation-policy.service';
import {
  BrowserOnboardingService,
} from '../services/browser-onboarding.service';

type CreateBrowserAccountBody = {
  displayName?: string;

  facebookEmail?: string;
  facebookPassword?: string;

  platform?: SocialPlatform;
  browserProfileName?: string;

  locale?: string;
  timezone?: string;

  browserEngine?: string;
  operatingSystem?: string;
  userAgent?: string | null;

  screenWidth?: number;
  screenHeight?: number;
  deviceScaleFactor?: number;
  colorScheme?: string;

  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;

  identityLocked?: boolean;

  proxyType?: SocialProxyType;
  proxyHost?: string | null;
  proxyPort?: number | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
  proxyCountry?: string | null;

  workspaceId?: string | null;
  brandId?: string | null;
};

@Controller('browser-runtime/accounts')
export class BrowserAccountController {
  constructor(
    private readonly browserAccounts:
      BrowserAccountService,
    private readonly browserLeases:
      BrowserLeaseService,
    private readonly browserSessions:
      BrowserSessionService,
    private readonly browserTimeline:
      BrowserTimelineService,
    private readonly automationPolicies:
      BrowserAutomationPolicyService,
    private readonly onboarding:
      BrowserOnboardingService,
  ) {}

  @Get()
  list() {
    return this.browserAccounts.list();
  }

  @Post(':id/channels/:channelId/link')
  linkChannel(
    @Param('id')
    id: string,
    @Param('channelId')
    channelId: string,
    @Body()
    body: {
      isPrimary?: boolean;
    },
  ) {
    return this.browserAccounts
      .linkChannel(
        id,
        channelId,
        body,
      );
  }

  @Post('select-for-channel')
  selectForChannel(
    @Body()
    body: {
      channelId?: string;
      excludeAccountIds?: string[];
      minimumHealthScore?: number;
      requireActiveCookie?: boolean;
    },
  ) {
    return this.browserAccounts
      .selectForChannel(
        body.channelId || '',
        {
          excludeAccountIds:
            body.excludeAccountIds,
          minimumHealthScore:
            body.minimumHealthScore,
          requireActiveCookie:
            body.requireActiveCookie,
        },
      );
  }

  @Get('pool/overview')
  browserPool() {
    return this.browserAccounts
      .pool();
  }

  @Get(':id')
  getById(
    @Param('id')
    id: string,
  ) {
    return this.browserAccounts.getById(
      id,
    );
  }

  @Patch(':id')
  update(
    @Param('id')
    id: string,
    @Body()
    body: {
      displayName?: string;
      browserProfileName?: string;
      brandId?: string | null;
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
      clearProxyCredentials?: boolean;
    },
  ) {
    return this.browserAccounts.update(
      id,
      body as any,
    );
  }

  @Post()
  create(
    @Body()
    body: CreateBrowserAccountBody,
  ) {
    return this.browserAccounts.create(
      body,
    );
  }

  @Post('lease/select-and-acquire')
  selectAndAcquireLease(
    @Body()
    body: {
      channelId?: string;
      ownerKey?: string;
      durationSeconds?: number;
      minimumHealthScore?: number;
      requireActiveCookie?: boolean;
      excludeAccountIds?: string[];
      metadata?: unknown;
    },
  ) {
    return this.browserLeases
      .selectAndAcquire(
        body,
      );
  }

  @Post(':id/lease/acquire')
  acquireLease(
    @Param('id')
    id: string,
    @Body()
    body: {
      ownerKey?: string;
      channelId?: string | null;
      durationSeconds?: number;
      metadata?: unknown;
    },
  ) {
    return this.browserLeases
      .acquire(
        id,
        body,
      );
  }

  @Post(':id/lease/release')
  releaseLease(
    @Param('id')
    id: string,
    @Body()
    body: {
      leaseToken?: string;
      ownerKey?: string;
    },
  ) {
    return this.browserLeases
      .release(
        id,
        body,
      );
  }

  @Get(':id/lease/status')
  leaseStatus(
    @Param('id')
    id: string,
  ) {
    return this.browserLeases
      .status(
        id,
      );
  }

  @Post(':id/browser/open')
  openBrowser(
    @Param('id')
    id: string,
    @Body()
    body: {
      headless?: boolean;
      startUrl?: string;
    },
  ) {
    return this.browserSessions.open(
      id,
      body,
    );
  }

  @Get(':id/browser/status')
  browserStatus(
    @Param('id')
    id: string,
  ) {
    return this.browserSessions.status(
      id,
    );
  }

  @Post(':id/browser/inspect')
  inspectBrowser(
    @Param('id')
    id: string,
  ) {
    return this.browserSessions.inspect(
      id,
    );
  }

  @Post(':id/facebook/sync-pages')
  syncFacebookPages(
    @Param('id')
    id: string,
    @Body()
    body: {
      brandId?: string | null;
      pages?: Array<{
        pageId?: string | null;
        name?: string;
        url?: string | null;
        imageUrl?: string | null;
        username?: string | null;
      }>;
    },
  ) {
    return this.browserAccounts
      .syncFacebookPages(
        id,
        body,
      );
  }

  @Post(':id/facebook/discover-pages')
  discoverFacebookPages(
    @Param('id')
    id: string,
  ) {
    return this.browserSessions
      .discoverFacebookPages(
        id,
      );
  }

  @Post(':id/browser/close')
  closeBrowser(
    @Param('id')
    id: string,
  ) {
    return this.browserSessions.close(
      id,
    );
  }


  @Get(':id/timeline')
  timeline(
    @Param('id')
    id: string,
  ) {
    return this.browserTimeline.list(
      id,
    );
  }

  @Get(':id/automation-policy')
  automationPolicy(
    @Param('id')
    id: string,
  ) {
    return this.automationPolicies
      .getOrCreate(
        id,
      );
  }

  @Patch(':id/automation-policy')
  updateAutomationPolicy(
    @Param('id')
    id: string,
    @Body()
    body: {
      autoVerifyLogin?: boolean;
      autoDiscoverPages?: boolean;
      autoSyncPages?: boolean;
      autoHealthCheck?: boolean;
      autoCloseBrowser?: boolean;
      autoNotifications?: boolean;
      keepBrowserOpenAfterLogin?: boolean;
    },
  ) {
    return this.automationPolicies
      .update(
        id,
        body,
      );
  }


  @Post(':id/onboarding/run')
  runOnboarding(
    @Param('id')
    id: string,
    @Body()
    body: {
      verifyLogin?: boolean;
      forceDiscover?: boolean;
      forceSync?: boolean;
      closeAfterComplete?: boolean;
    },
  ) {
    return this.onboarding.run(
      id,
      body,
    );
  }

}
