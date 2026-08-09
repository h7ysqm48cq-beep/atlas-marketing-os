import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { TelegramConnectorService } from './telegram-connector.service';
import { FacebookConnectorService } from './facebook-connector.service';
import { FacebookOAuthService } from './facebook-oauth.service';
import { RuntimeProfileService } from './runtime-profile.service';
import { BrowserAccountService } from './browser-account.service';
import { BrowserRuntimeBridgeService } from './browser-runtime-bridge.service';
import { BrowserActionHistoryService } from './browser-action-history.service';
import { BrowserActionTraceService } from './browser-action-trace.service';
import { PublisherService } from './publisher.service';
import { AutomationSchedulerService } from './automation-scheduler.service';
import { SportsNewsAutomationService } from './sports-news-automation.service';
import { MSportsImageBrandingService } from './msports/msports-image-branding.service';
import { AssetImageModule } from '../asset-image/asset-image.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AssetImageModule, StorageModule],
  controllers: [AutomationController],
  providers: [
    AutomationSchedulerService,
    SportsNewsAutomationService,
    MSportsImageBrandingService,
    AutomationService,
    TelegramConnectorService,
    FacebookConnectorService,
    FacebookOAuthService,
    RuntimeProfileService,
    BrowserAccountService,
    BrowserRuntimeBridgeService,
    BrowserActionHistoryService,
    BrowserActionTraceService,
    PublisherService,
  ],
  exports: [
    BrowserRuntimeBridgeService,
    AutomationService,
    TelegramConnectorService,
    FacebookConnectorService,
    BrowserActionTraceService,
    PublisherService,
  ],
})
export class AutomationModule {}
