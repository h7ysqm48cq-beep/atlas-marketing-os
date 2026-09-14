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
  VerifierCapabilityService,
  type VerifierCapabilityOperation,
} from '../authority/verifier-capability.service';
import type { SupervisorWorkerRole } from '../execution/supervisor-execution.types';
import {
  SUPERVISOR_EXECUTION_STORE,
  type SupervisorExecutionStore,
} from '../stores/supervisor-execution.store';

export const SUPERVISOR_VERIFIER_OPERATION =
  'atlas-supervisor-verifier-operation';

export const SupervisorVerifierOperationRequired = (
  operation: VerifierCapabilityOperation,
) => SetMetadata(SUPERVISOR_VERIFIER_OPERATION, operation);

export interface SupervisorVerifierAuthorizationContext {
  taskId: string;
  executionId: string;
  workerRole: SupervisorWorkerRole;
  claimEpoch: number;
  runnerId: string;
  leaseId: string;
}

@Injectable()
export class SupervisorVerifierGuard implements CanActivate {
  constructor(
    private readonly capabilities: VerifierCapabilityService,
    @Inject(SUPERVISOR_EXECUTION_STORE)
    private readonly executions: SupervisorExecutionStore,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const operation =
      this.reflector.getAllAndOverride<VerifierCapabilityOperation>(
        SUPERVISOR_VERIFIER_OPERATION,
        [context.getHandler(), context.getClass()],
      );
    if (!operation) {
      throw new ForbiddenException(
        'verifier_capability_operation_not_declared',
      );
    }

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string | string[] };
      params: { taskId?: string; executionId?: string };
      supervisorVerifierAuthorization?: SupervisorVerifierAuthorizationContext;
    }>();
    const authorization = request.headers.authorization;
    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ') ||
      authorization.length === 'Bearer '.length
    ) {
      throw new UnauthorizedException('verifier_capability_required');
    }

    const taskId = request.params.taskId;
    const executionId = request.params.executionId;
    if (!taskId || !executionId) {
      throw new ForbiddenException('verifier_capability_execution_mismatch');
    }

    const execution = await this.executions.get(executionId);
    if (!execution || execution.taskId !== taskId) {
      throw new ForbiddenException('verifier_capability_execution_mismatch');
    }
    if (execution.assignment.executionPurpose !== 'INDEPENDENT_VERIFICATION') {
      throw new ForbiddenException('verifier_capability_purpose_mismatch');
    }

    const assignment = execution.assignment;
    if (
      !assignment.manifestHash ||
      !Number.isInteger(execution.claimEpoch) ||
      !assignment.leaseId ||
      !assignment.runnerId ||
      !execution.runnerId
    ) {
      throw new ForbiddenException('verifier_capability_binding_required');
    }
    if (
      assignment.claimEpoch !== execution.claimEpoch ||
      assignment.runnerId !== execution.runnerId
    ) {
      throw new ForbiddenException('verifier_capability_claim_mismatch');
    }

    const now = new Date();
    if (operation === 'heartbeat' && execution.status !== 'RUNNING') {
      throw new ForbiddenException(
        'verifier_capability_heartbeat_execution_not_running',
      );
    }

    if (
      operation !== 'read_assignment' &&
      ['COMPLETED', 'FAILED', 'CANCELLED'].includes(execution.status)
    ) {
      throw new ForbiddenException('verifier_capability_terminal_execution');
    }

    const leaseBoundOperation = [
      'heartbeat',
      'submit_verification',
      'fail',
      'cancel',
    ].includes(operation);
    if (leaseBoundOperation) {
      if (
        !(execution.lastHeartbeatAt instanceof Date) ||
        !(execution.leaseExpiresAt instanceof Date)
      ) {
        throw new ForbiddenException('verifier_capability_binding_required');
      }
      if (execution.leaseExpiresAt.getTime() <= now.getTime()) {
        throw new ForbiddenException(
          'verifier_capability_execution_lease_expired',
        );
      }
    }

    this.capabilities.authorize(authorization.slice('Bearer '.length), {
      taskId,
      executionId,
      manifestHash: assignment.manifestHash,
      claimEpoch: execution.claimEpoch,
      allowedPaths: assignment.allowedPaths,
      purpose: 'INDEPENDENT_VERIFICATION',
      leaseId: assignment.leaseId,
      runnerId: execution.runnerId,
      operation,
      now,
    });

    if (operation === 'heartbeat') {
      request.supervisorVerifierAuthorization = {
        taskId,
        executionId,
        workerRole: execution.workerRole,
        claimEpoch: execution.claimEpoch,
        runnerId: execution.runnerId,
        leaseId: assignment.leaseId,
      };
    }

    return true;
  }
}
