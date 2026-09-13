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
import type { SupervisorWorkerRole } from '../execution/supervisor-execution.types';
import { SupervisorWorkerCapabilityService } from './supervisor-worker-capability.service';
import type { SupervisorWorkerCapabilityOperation } from './supervisor-worker-capability.types';

export const SUPERVISOR_WORKER_OPERATION = 'atlas-supervisor-worker-operation';

export const SupervisorWorkerOperationRequired = (
  operation: SupervisorWorkerCapabilityOperation,
) => SetMetadata(SUPERVISOR_WORKER_OPERATION, operation);

export interface SupervisorWorkerAuthorizationContext {
  taskId: string;
  executionId: string;
  workerRole: SupervisorWorkerRole;
  claimEpoch: number;
  runnerId: string;
  leaseId: string;
}

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
      supervisorWorkerAuthorization?: SupervisorWorkerAuthorizationContext;
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
    const now = new Date();
    if (operation === 'heartbeat') {
      if (execution.status !== 'RUNNING') {
        throw new ForbiddenException(
          'worker_capability_heartbeat_execution_not_running',
        );
      }
      if (
        !Number.isInteger(execution.claimEpoch) ||
        typeof execution.runnerId !== 'string' ||
        execution.runnerId.length === 0 ||
        !(execution.lastHeartbeatAt instanceof Date) ||
        !(execution.leaseExpiresAt instanceof Date)
      ) {
        throw new ForbiddenException(
          'worker_capability_heartbeat_binding_required',
        );
      }
      if (
        execution.assignment.claimEpoch !== execution.claimEpoch ||
        execution.assignment.runnerId !== execution.runnerId ||
        typeof execution.assignment.leaseId !== 'string' ||
        execution.assignment.leaseId.length === 0
      ) {
        throw new ForbiddenException(
          'worker_capability_heartbeat_binding_mismatch',
        );
      }
      if (execution.leaseExpiresAt.getTime() <= now.getTime()) {
        throw new ForbiddenException(
          'worker_capability_execution_lease_expired',
        );
      }
    }
    if (
      operation !== 'read_assignment' &&
      ['COMPLETED', 'FAILED', 'CANCELLED'].includes(execution.status)
    ) {
      throw new ForbiddenException('worker_capability_terminal_execution');
    }

    try {
      this.capabilities.authorize(authorization.slice('Bearer '.length), {
        taskId,
        executionId,
        workerRole: execution.workerRole,
        executionPurpose:
          execution.assignment.executionPurpose ?? 'IMPLEMENTATION',
        assignment: execution.assignment,
        operation,
        now,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'authority_token_malformed') {
        throw new ForbiddenException('worker_capability_malformed');
      }
      if (code === 'authority_task_mismatch') {
        throw new ForbiddenException('worker_capability_task_mismatch');
      }
      throw error;
    }
    if (operation === 'heartbeat') {
      request.supervisorWorkerAuthorization = {
        taskId,
        executionId,
        workerRole: execution.workerRole,
        claimEpoch: execution.claimEpoch!,
        runnerId: execution.runnerId!,
        leaseId: execution.assignment.leaseId!,
      };
    }
    return true;
  }
}
