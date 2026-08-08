import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { TelegramConnectorService } from './telegram-connector.service';
import { FacebookConnectorService } from './facebook-connector.service';
import { PublisherService } from './publisher.service';
import { AutomationSchedulerService } from './automation-scheduler.service';
import { SportsNewsSettingsController } from './sports-news-settings.controller';
import { SportsNewsSettingsService } from './sports-news-settings.service';
import { SportsNewsSourceValidatorService } from './sports-news-source-validator.service';
import { SportsNewsRunnerService } from './sports-news-runner.service';
import { NewsModule } from '../news/news.module';

@Module({
  imports: [NewsModule],
  controllers: [AutomationController, SportsNewsSettingsController],
  providers: [AutomationSchedulerService, AutomationService, SportsNewsSettingsService, SportsNewsSourceValidatorService, SportsNewsRunnerService, TelegramConnectorService, FacebookConnectorService, PublisherService],
  exports: [AutomationService, SportsNewsSettingsService, SportsNewsSourceValidatorService, SportsNewsRunnerService, TelegramConnectorService, FacebookConnectorService, PublisherService],
})
export class AutomationModule {}
