import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { TelegramConnectorService } from './telegram-connector.service';
import { FacebookConnectorService } from './facebook-connector.service';

@Module({
  controllers: [
    AutomationController,
  ],
  providers: [
    AutomationService,
    TelegramConnectorService,
    FacebookConnectorService,
  ],
  exports: [
    AutomationService,
    TelegramConnectorService,
    FacebookConnectorService,
  ],
})
export class AutomationModule {}
