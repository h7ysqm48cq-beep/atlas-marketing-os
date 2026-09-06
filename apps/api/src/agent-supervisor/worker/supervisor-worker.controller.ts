import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import type { WorkerExecutionResult } from '../execution/supervisor-execution.types';
import {
  SupervisorWorkerGuard,
  SupervisorWorkerOperationRequired,
} from './supervisor-worker.guard';

@Public()
@UseGuards(SupervisorWorkerGuard)
@Controller('engineering/supervisor/worker')
export class SupervisorWorkerController {
  constructor(private readonly dispatcher: WorkerDispatcherService) {}

  @Get('tasks/:taskId/executions/:executionId/assignment')
  @SupervisorWorkerOperationRequired('read_assignment')
  async getAssignment(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
  ) {
    const execution = await this.dispatcher.getExecution(executionId);
    return execution.assignment;
  }

  @Post('tasks/:taskId/executions/:executionId/running')
  @SupervisorWorkerOperationRequired('mark_running')
  markRunning(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.dispatcher.markRunning(executionId);
  }

  @Post('tasks/:taskId/executions/:executionId/complete')
  @SupervisorWorkerOperationRequired('complete')
  complete(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
    @Body() result: WorkerExecutionResult,
  ) {
    return this.dispatcher.complete(executionId, result);
  }

  @Post('tasks/:taskId/executions/:executionId/fail')
  @SupervisorWorkerOperationRequired('fail')
  fail(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
    @Body() body: { error: string },
  ) {
    return this.dispatcher.fail(executionId, body.error ?? '');
  }

  @Post('tasks/:taskId/executions/:executionId/cancel')
  @SupervisorWorkerOperationRequired('cancel')
  cancel(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
    @Body() body: { reason: string },
  ) {
    return this.dispatcher.cancel(executionId, body.reason ?? '');
  }
}
