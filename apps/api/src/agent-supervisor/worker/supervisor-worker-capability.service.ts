import { createHash, randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  SupervisorExecution,
  WorkerAssignmentEnvelope,
} from '../execution/supervisor-execution.types';
import {
  canonicalizeAuthorityValue,
  SupervisorAuthorityService,
} from '../authority/supervisor-authority.service';
import type {
  SupervisorWorkerCapabilityAuthorizationInput,
  SupervisorWorkerCapabilityClaims,
  SupervisorWorkerCapabilityMetadata,
  SupervisorWorkerCapabilityOperation,
} from './supervisor-worker-capability.types';

const CAPABILITY_VERSION = 2 as const;
const DEFAULT_TTL_MS = 5 * 60 * 1_000;
const MAX_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_ALLOWED_ACTIONS: SupervisorWorkerCapabilityOperation[] = [
  'read_assignment',
  'mark_running',
  'complete',
  'fail',
  'cancel',
];
const OPERATIONS = new Set<SupervisorWorkerCapabilityOperation>(
  DEFAULT_ALLOWED_ACTIONS,
);

type IssueOptions = {
  now?: Date;
  ttlMs?: number;
  allowedActions?: SupervisorWorkerCapabilityOperation[];
};

@Injectable()
export class SupervisorWorkerCapabilityService {
  constructor(private readonly authority: SupervisorAuthorityService) {}

  issue(
    execution: SupervisorExecution,
    options: IssueOptions = {},
  ): {
    token: string;
    metadata: SupervisorWorkerCapabilityMetadata;
  } {
    const now = options.now ?? new Date();
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
      throw new ForbiddenException('worker_capability_invalid_expiry');
    }

    const assignment = execution.assignment;
    if (
      assignment.taskId !== execution.taskId ||
      assignment.executionId !== execution.id ||
      assignment.workerRole !== execution.workerRole
    ) {
      throw new ForbiddenException('worker_capability_execution_mismatch');
    }
    this.requireAuthorityBinding(assignment);
    if (assignment.executionPurpose !== 'IMPLEMENTATION') {
      throw new ForbiddenException('worker_capability_purpose_mismatch');
    }

    const allowedActions = [
      ...new Set(options.allowedActions ?? DEFAULT_ALLOWED_ACTIONS),
    ];
    if (
      allowedActions.length === 0 ||
      allowedActions.some((operation) => !OPERATIONS.has(operation))
    ) {
      throw new ForbiddenException('worker_capability_operation_denied');
    }

    const jti = randomUUID();
    const metadata: SupervisorWorkerCapabilityMetadata = {
      version: CAPABILITY_VERSION,
      assignmentDigest: this.assignmentDigest(assignment),
      allowedActions,
      manifestHash: assignment.manifestHash!,
      allowedPaths: [...assignment.allowedPaths],
      forbiddenActions: [...assignment.forbiddenActions],
      claimEpoch: assignment.claimEpoch!,
      leaseId: assignment.leaseId!,
      runnerId: assignment.runnerId!,
      jti,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    const claims: SupervisorWorkerCapabilityClaims = {
      ...metadata,
      iss: 'atlas.supervisor.control-plane',
      sub: 'atlas:worker-execution',
      aud: 'atlas:worker.gateway',
      actorType: 'WORKER_EXECUTION',
      tokenType: 'WORKER_CAPABILITY',
      purpose: 'IMPLEMENTATION',
      iat: metadata.issuedAt,
      exp: metadata.expiresAt,
      taskId: execution.taskId,
      executionId: execution.id,
      workerRole: execution.workerRole,
      executionPurpose: 'IMPLEMENTATION',
    };

    return {
      token: this.authority.sign('WORKER_CAPABILITY', claims),
      metadata,
    };
  }

  authorize(
    token: string,
    input: SupervisorWorkerCapabilityAuthorizationInput,
  ): SupervisorWorkerCapabilityClaims {
    this.requireAuthorityBinding(input.assignment);
    if (input.executionPurpose !== 'IMPLEMENTATION') {
      throw new ForbiddenException('worker_capability_purpose_mismatch');
    }

    const claims = this.authority.verify(token, {
      domain: 'WORKER_CAPABILITY',
      audience: 'atlas:worker.gateway',
      actorType: 'WORKER_EXECUTION',
      tokenType: 'WORKER_CAPABILITY',
      purpose: 'IMPLEMENTATION',
      now: input.now,
      claimEpoch: input.assignment.claimEpoch,
      taskId: input.taskId,
      executionId: input.executionId,
      manifestHash: input.assignment.manifestHash,
    }) as unknown as SupervisorWorkerCapabilityClaims;

    if (claims.workerRole !== input.workerRole) {
      throw new ForbiddenException('worker_capability_role_mismatch');
    }
    if (!Array.isArray(claims.allowedActions)) {
      throw new ForbiddenException('worker_capability_actions_required');
    }
    if (!claims.allowedActions.includes(input.operation)) {
      throw new ForbiddenException('worker_capability_operation_denied');
    }

    const metadata = input.assignment.workerCapability;
    const digest = this.assignmentDigest(input.assignment);
    if (
      !metadata ||
      digest !== claims.assignmentDigest ||
      metadata.assignmentDigest !== claims.assignmentDigest ||
      metadata.version !== CAPABILITY_VERSION ||
      metadata.manifestHash !== claims.manifestHash ||
      metadata.claimEpoch !== claims.claimEpoch ||
      metadata.leaseId !== claims.leaseId ||
      metadata.runnerId !== claims.runnerId ||
      metadata.jti !== claims.jti ||
      metadata.expiresAt !== claims.expiresAt ||
      metadata.issuedAt !== claims.issuedAt ||
      !this.sameOperations(metadata.allowedActions, claims.allowedActions) ||
      !this.sameStringArrays(metadata.allowedPaths, claims.allowedPaths) ||
      !this.sameStringArrays(metadata.forbiddenActions, claims.forbiddenActions)
    ) {
      throw new ForbiddenException('worker_capability_assignment_mismatch');
    }

    return claims;
  }

  assignmentDigest(assignment: WorkerAssignmentEnvelope): string {
    const boundAssignment = { ...assignment };
    delete boundAssignment.workerCapability;
    return createHash('sha256')
      .update(canonicalizeAuthorityValue(boundAssignment), 'utf8')
      .digest('hex');
  }

  private requireAuthorityBinding(assignment: WorkerAssignmentEnvelope): void {
    if (
      !assignment.manifestHash ||
      !/^[0-9a-f]{64}$/i.test(assignment.manifestHash) ||
      !Number.isInteger(assignment.claimEpoch) ||
      assignment.claimEpoch! < 0 ||
      !assignment.leaseId ||
      !assignment.runnerId
    ) {
      throw new ForbiddenException(
        'worker_capability_authority_binding_required',
      );
    }
  }

  private sameOperations(
    left: SupervisorWorkerCapabilityOperation[],
    right: SupervisorWorkerCapabilityOperation[],
  ): boolean {
    return this.sameStringArrays(left, right);
  }

  private sameStringArrays(left: string[], right: string[]): boolean {
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }
}
