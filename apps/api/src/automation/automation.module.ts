import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { TelegramConnectorService } from './telegram-connector.service';
import { FacebookConnectorService } from './facebook-connector.service';
import { PublisherService } from './publisher.service';
import { AutomationSchedulerService } from './automation-scheduler.service';
import { SportsNewsAutomationService } from './sports-news-automation.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [
    AutomationController,
  ],
  providers: [
    AutomationSchedulerService,
    SportsNewsAutomationService,
    AutomationService,
    TelegramConnectorService,
    FacebookConnectorService,
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
