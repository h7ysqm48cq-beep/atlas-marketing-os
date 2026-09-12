import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { resolveSupervisorExecutionLivenessConfig } from '../execution/supervisor-execution-liveness.config';
import type { WorkerExecutionResult } from '../execution/supervisor-execution.types';
import {
  SUPERVISOR_EXECUTION_HEARTBEAT_STORE,
  type SupervisorExecutionHeartbeatStore,
} from '../stores/supervisor-execution.store';
import {
  SupervisorWorkerAuthorizationContext,
  SupervisorWorkerGuard,
  SupervisorWorkerOperationRequired,
} from './supervisor-worker.guard';

@Public()
@UseGuards(SupervisorWorkerGuard)
@Controller('engineering/supervisor/worker')
export class SupervisorWorkerController {
  constructor(
    private readonly dispatcher: WorkerDispatcherService,
    @Inject(SUPERVISOR_EXECUTION_HEARTBEAT_STORE)
    private readonly heartbeats: SupervisorExecutionHeartbeatStore,
  ) {
    const heartbeat = this.heartbeat.bind(this);
    for (const key of Reflect.getMetadataKeys(this.heartbeat)) {
      Reflect.defineMetadata(
        key,
        Reflect.getMetadata(key, this.heartbeat),
        heartbeat,
      );
    }
    this.heartbeat = heartbeat;
  }

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

  @Post('tasks/:taskId/executions/:executionId/heartbeat')
  @HttpCode(HttpStatus.OK)
  @SupervisorWorkerOperationRequired('heartbeat')
  async heartbeat(
    @Req()
    request: {
      supervisorWorkerAuthorization?: SupervisorWorkerAuthorizationContext;
    },
    @Param('taskId') _taskId: string,
    @Param('executionId') _executionId: string,
    @Body() _body?: Record<string, unknown>,
  ) {
    const authorization = request.supervisorWorkerAuthorization;
    if (!authorization) {
      throw new ForbiddenException('worker_heartbeat_authorization_required');
    }
    const now = new Date();
    const { runningLeaseMs } = resolveSupervisorExecutionLivenessConfig();
    const renewed = await this.heartbeats.heartbeat({
      executionId: authorization.executionId,
      taskId: authorization.taskId,
      workerRole: authorization.workerRole,
      claimEpoch: authorization.claimEpoch,
      runnerId: authorization.runnerId,
      leaseId: authorization.leaseId,
      now,
      leaseExpiresAt: new Date(now.getTime() + runningLeaseMs),
    });
    if (!renewed) {
      throw new ForbiddenException('worker_heartbeat_rejected');
    }
    return renewed;
  }
}
