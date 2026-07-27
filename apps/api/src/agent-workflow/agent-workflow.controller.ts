import {
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { AgentWorkflowService } from './agent-workflow.service';

@Controller('agent-workflow')
export class AgentWorkflowController {
  constructor(
    private readonly agentWorkflowService:
      AgentWorkflowService,
  ) {}

  @Get()
  status() {
    return this.agentWorkflowService.status();
  }

  @Post('preview')
  preview() {
    return this.agentWorkflowService
      .createWorkflowState();
  }
}
