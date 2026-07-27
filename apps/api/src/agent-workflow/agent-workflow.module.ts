import { Module } from '@nestjs/common';
import { AgentWorkflowController } from './agent-workflow.controller';
import { AgentWorkflowService } from './agent-workflow.service';

@Module({
  controllers: [
    AgentWorkflowController,
  ],
  providers: [
    AgentWorkflowService,
  ],
  exports: [
    AgentWorkflowService,
  ],
})
export class AgentWorkflowModule {}
