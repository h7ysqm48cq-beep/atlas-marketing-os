import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import type { WorkerExecutionResult } from '../execution/supervisor-execution.types';
import {
  SupervisorWorkerGuard,
  SupervisorWorkerOperationRequired,
} from './supervisor-worker.guard';
import type {
  SupervisorWorkerCapabilityClaims,
  SupervisorWorkerCapabilityFence,
} from './supervisor-worker-capability.types';

type WorkerRequest = { atlasWorkerCapability?: SupervisorWorkerCapabilityClaims };

function v2Fence(request: WorkerRequest): SupervisorWorkerCapabilityFence | undefined {
  const claims = request.atlasWorkerCapability;
  return claims?.version === 2
    ? { claimedBy: claims.runnerId, claimEpoch: claims.claimEpoch, now: new Date() }
    : undefined;
}

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
    @Req() request?: WorkerRequest,
  ) {
    const fence = v2Fence(request ?? {});
    return fence
      ? this.dispatcher.markRunning(executionId, fence)
      : this.dispatcher.markRunning(executionId);
  }

  @Post('tasks/:taskId/executions/:executionId/complete')
  @SupervisorWorkerOperationRequired('complete')
  complete(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
    @Body() result: WorkerExecutionResult,
    @Req() request?: WorkerRequest,
  ) {
    const fence = v2Fence(request ?? {});
    return fence
      ? this.dispatcher.complete(executionId, result, fence)
      : this.dispatcher.complete(executionId, result);
  }

  @Post('tasks/:taskId/executions/:executionId/fail')
  @SupervisorWorkerOperationRequired('fail')
  fail(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
    @Body() body: { error: string },
    @Req() request?: WorkerRequest,
  ) {
    const fence = v2Fence(request ?? {});
    return fence
      ? this.dispatcher.fail(executionId, body.error ?? '', fence)
      : this.dispatcher.fail(executionId, body.error ?? '');
  }

  @Post('tasks/:taskId/executions/:executionId/cancel')
  @SupervisorWorkerOperationRequired('cancel')
  cancel(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
    @Body() body: { reason: string },
    @Req() request?: WorkerRequest,
  ) {
    const fence = v2Fence(request ?? {});
    return fence
      ? this.dispatcher.cancel(executionId, body.reason ?? '', fence)
      : this.dispatcher.cancel(executionId, body.reason ?? '');
  }
}
