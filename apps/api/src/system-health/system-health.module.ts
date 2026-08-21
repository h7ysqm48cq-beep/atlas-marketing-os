import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AssetsModule } from '../assets/assets.module';
import { AutomationModule } from '../automation/automation.module';

import { SystemHealthController } from './system-health.controller';
import { SystemHealthService } from './system-health.service';


@Module({
  imports:[
    DatabaseModule,
    AssetsModule,
    AutomationModule,
  ],
  controllers:[
    SystemHealthController,
  ],
  providers:[
    SystemHealthService,
  ],
  exports:[
    SystemHealthService,
  ],
})
export class SystemHealthModule {}
