import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { QueuePlannerService } from './queue-planner.service';

@Module({
  imports: [
    AutomationModule,
  ],
  controllers: [
    WorkflowController,
  ],
  providers: [
    WorkflowService,
    QueuePlannerService,
  ],
  exports: [
    WorkflowService,
  ],
})
export class WorkflowModule {}
