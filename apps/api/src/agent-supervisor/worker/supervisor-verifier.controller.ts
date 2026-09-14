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
  SupervisorVerifierGuard,
  type SupervisorVerifierAuthorizationContext,
  SupervisorVerifierOperationRequired,
} from './supervisor-verifier.guard';

@Public()
@UseGuards(SupervisorVerifierGuard)
@Controller('engineering/supervisor/verifier')
export class SupervisorVerifierController {
  constructor(
    private readonly dispatcher: WorkerDispatcherService,
    @Inject(SUPERVISOR_EXECUTION_HEARTBEAT_STORE)
    private readonly heartbeats: SupervisorExecutionHeartbeatStore,
  ) {}

  @Get('tasks/:taskId/executions/:executionId/assignment')
  @SupervisorVerifierOperationRequired('read_assignment')
  async getAssignment(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
  ) {
    const execution = await this.dispatcher.getExecution(executionId);
    return execution.assignment;
  }

  @Post('tasks/:taskId/executions/:executionId/verification')
  @SupervisorVerifierOperationRequired('submit_verification')
  submitVerification(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
    @Body() result: WorkerExecutionResult,
  ) {
    return this.dispatcher.complete(executionId, result);
  }

  @Post('tasks/:taskId/executions/:executionId/fail')
  @SupervisorVerifierOperationRequired('fail')
  fail(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
    @Body() body: { error: string },
  ) {
    return this.dispatcher.fail(executionId, body.error ?? '');
  }

  @Post('tasks/:taskId/executions/:executionId/cancel')
  @SupervisorVerifierOperationRequired('cancel')
  cancel(
    @Param('taskId') _taskId: string,
    @Param('executionId') executionId: string,
    @Body() body: { reason: string },
  ) {
    return this.dispatcher.cancel(executionId, body.reason ?? '');
  }

  @Post('tasks/:taskId/executions/:executionId/heartbeat')
  @HttpCode(HttpStatus.OK)
  @SupervisorVerifierOperationRequired('heartbeat')
  async heartbeat(
    @Req()
    request: {
      supervisorVerifierAuthorization?: SupervisorVerifierAuthorizationContext;
    },
    @Param('taskId') _taskId: string,
    @Param('executionId') _executionId: string,
    @Body() _body?: Record<string, unknown>,
  ) {
    const authorization = request.supervisorVerifierAuthorization;
    if (!authorization) {
      throw new ForbiddenException(
        'verifier_heartbeat_authorization_required',
      );
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
      throw new ForbiddenException('verifier_heartbeat_rejected');
    }

    return renewed;
  }
}
