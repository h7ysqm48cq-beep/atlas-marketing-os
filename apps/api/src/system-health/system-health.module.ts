import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AssetsModule } from '../assets/assets.module';
import { AutomationModule } from '../automation/automation.module';
import { NotificationModule } from '../notifications/notification.module';
import { AgentSupervisorModule } from '../agent-supervisor/agent-supervisor.module';

import { SystemHealthController } from './system-health.controller';
import { SystemHealthService } from './system-health.service';
import { SystemHealthAlertService } from './system-health-alert.service';


@Module({
  imports:[
    DatabaseModule,
    AssetsModule,
    AutomationModule,
    NotificationModule,
    AgentSupervisorModule,
  ],
  controllers:[
    SystemHealthController,
  ],
  providers:[
    SystemHealthService,
    SystemHealthAlertService,
  ],
  exports:[
    SystemHealthService,
  ],
})
export class SystemHealthModule {}
