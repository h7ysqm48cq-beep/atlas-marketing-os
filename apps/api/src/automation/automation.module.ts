import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { TelegramConnectorService } from './telegram-connector.service';
import { FacebookConnectorService } from './facebook-connector.service';
import { FacebookOAuthService } from './facebook-oauth.service';
import { RuntimeProfileService } from './runtime-profile.service';
import { BrowserRuntimeBridgeService } from './browser-runtime-bridge.service';
import { BrowserActionHistoryService } from './browser-action-history.service';
import { PublisherService } from './publisher.service';
import { AutomationSchedulerService } from './automation-scheduler.service';

@Module({
  controllers: [
    AutomationController,
  ],
  providers: [
    AutomationSchedulerService,
    AutomationService,
    TelegramConnectorService,
    FacebookConnectorService,
    FacebookOAuthService,
    RuntimeProfileService,
    BrowserRuntimeBridgeService,
    BrowserActionHistoryService,
    PublisherService,
  ],
  exports: [
    AutomationService,
    TelegramConnectorService,
    FacebookConnectorService,
    PublisherService,
  ],
})
export class AutomationModule {}
