import {
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import type {
  AutoQueueInput,
  ScheduleContentInput,
} from './workflow.types';
import { Public } from '../auth/public.decorator';
import { QueuePlannerService } from './queue-planner.service';

@Controller('workflow')
export class WorkflowController {
  constructor(
    private readonly workflowService:
      WorkflowService,
    private readonly queuePlanner: QueuePlannerService,
  ) {}

  @Get('health')
  @Public()
  health() {
    return {
      connected: true,
      service: 'Atlas Workflow Engine',
      version: '3.1',
    };
  }

  @Post('auto-queue')
  autoQueue(
    @Body()
    body: AutoQueueInput,
  ) {
    return this.workflowService
      .autoQueue(body);
  }

  @Post('schedule-content')
  scheduleContent(
    @Body()
    body: ScheduleContentInput,
  ) {
    return this.workflowService
      .scheduleContent(body);
  }
}
