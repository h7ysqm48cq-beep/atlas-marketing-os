import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SUPERVISOR_EXECUTION_STORE,
  type SupervisorExecutionStore,
} from '../stores/supervisor-execution.store';
import { SupervisorWorkerCapabilityService } from './supervisor-worker-capability.service';
import type { SupervisorWorkerCapabilityOperation } from './supervisor-worker-capability.types';

export const SUPERVISOR_WORKER_OPERATION = 'atlas-supervisor-worker-operation';

export const SupervisorWorkerOperationRequired = (
  operation: SupervisorWorkerCapabilityOperation,
) => SetMetadata(SUPERVISOR_WORKER_OPERATION, operation);

@Injectable()
export class SupervisorWorkerGuard implements CanActivate {
  constructor(
    private readonly capabilities: SupervisorWorkerCapabilityService,
    @Inject(SUPERVISOR_EXECUTION_STORE)
    private readonly executions: SupervisorExecutionStore,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const operation =
      this.reflector.getAllAndOverride<SupervisorWorkerCapabilityOperation>(
        SUPERVISOR_WORKER_OPERATION,
        [context.getHandler(), context.getClass()],
      );
    if (!operation) {
      throw new ForbiddenException('worker_capability_operation_not_declared');
    }

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string | string[] };
      params: { taskId?: string; executionId?: string };
    }>();
    const authorization = request.headers.authorization;
    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ') ||
      authorization.length === 'Bearer '.length
    ) {
      throw new UnauthorizedException('worker_capability_required');
    }

    const taskId = request.params.taskId;
    const executionId = request.params.executionId;
    if (!taskId || !executionId) {
      throw new ForbiddenException('worker_capability_execution_mismatch');
    }
    const execution = await this.executions.get(executionId);
    if (!execution) {
      throw new ForbiddenException('worker_capability_execution_mismatch');
    }
    if (execution.taskId !== taskId) {
      throw new ForbiddenException('worker_capability_task_mismatch');
    }
    if (
      operation !== 'read_assignment' &&
      ['COMPLETED', 'FAILED', 'CANCELLED'].includes(execution.status)
    ) {
      throw new ForbiddenException('worker_capability_terminal_execution');
    }

    this.capabilities.authorize(authorization.slice('Bearer '.length), {
      taskId,
      executionId,
      workerRole: execution.workerRole,
      executionPurpose:
        execution.assignment.executionPurpose ?? 'IMPLEMENTATION',
      assignment: execution.assignment,
      operation,
    });
    return true;
  }
}
