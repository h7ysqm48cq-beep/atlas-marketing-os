import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  SupervisorAuthorityService,
  type AuthorityClaims,
} from './supervisor-authority.service';

export type VerifierCapabilityOperation =
  | 'read_assignment'
  | 'mark_running'
  | 'heartbeat'
  | 'submit_verification'
  | 'fail'
  | 'cancel';

export interface VerifierCapabilityInput {
  taskId: string;
  executionId: string;
  manifestHash: string;
  claimEpoch: number;
  allowedPaths: string[];
  purpose?: 'INDEPENDENT_VERIFICATION';
  leaseId: string;
  runnerId: string;
}

export interface VerifierCapability extends AuthorityClaims {
  actorType: 'VERIFIER_EXECUTION';
  tokenType: 'VERIFIER_CAPABILITY';
  purpose: 'INDEPENDENT_VERIFICATION';
  taskId: string;
  executionId: string;
  manifestHash: string;
  claimEpoch: number;
  allowedPaths: string[];
  allowedActions: VerifierCapabilityOperation[];
  leaseId: string;
  runnerId: string;
}

@Injectable()
export class VerifierCapabilityService {
  private readonly operations: VerifierCapabilityOperation[] = [
    'read_assignment',
    'mark_running',
    'heartbeat',
    'submit_verification',
    'fail',
    'cancel',
  ];

  constructor(private readonly authority: SupervisorAuthorityService) {}

  issue(input: VerifierCapabilityInput, now = new Date()): string {
    this.validateBinding(input);
    return this.authority.sign('VERIFIER_CAPABILITY', {
      iss: 'atlas.supervisor.control-plane',
      sub: 'atlas:verifier-execution',
      aud: 'atlas:verifier.gateway',
      actorType: 'VERIFIER_EXECUTION',
      tokenType: 'VERIFIER_CAPABILITY',
      purpose: 'INDEPENDENT_VERIFICATION',
      iat: now.toISOString(),
      exp: new Date(now.getTime() + 5 * 60 * 1_000).toISOString(),
      jti: randomUUID(),
      claimEpoch: input.claimEpoch,
      taskId: input.taskId,
      executionId: input.executionId,
      manifestHash: input.manifestHash,
      allowedPaths: [...input.allowedPaths],
      allowedActions: [...this.operations],
      leaseId: input.leaseId,
      runnerId: input.runnerId,
    });
  }

  authorize(
    token: string,
    input: VerifierCapabilityInput & {
      operation: VerifierCapabilityOperation;
      now?: Date;
    },
  ): VerifierCapability {
    const claims = this.authority.verify(token, {
      domain: 'VERIFIER_CAPABILITY',
      audience: 'atlas:verifier.gateway',
      actorType: 'VERIFIER_EXECUTION',
      tokenType: 'VERIFIER_CAPABILITY',
      purpose: 'INDEPENDENT_VERIFICATION',
      now: input.now,
      claimEpoch: input.claimEpoch,
      taskId: input.taskId,
      executionId: input.executionId,
      manifestHash: input.manifestHash,
    }) as VerifierCapability;

    if (!claims.allowedActions.includes(input.operation)) {
      throw new ForbiddenException('verifier_capability_operation_denied');
    }
    if (claims.leaseId !== input.leaseId || claims.runnerId !== input.runnerId) {
      throw new ForbiddenException('verifier_capability_claim_mismatch');
    }
    if (
      claims.allowedPaths.length !== input.allowedPaths.length ||
      claims.allowedPaths.some((path, index) => path !== input.allowedPaths[index])
    ) {
      throw new ForbiddenException('verifier_capability_scope_mismatch');
    }
    return claims;
  }

  private validateBinding(input: VerifierCapabilityInput): void {
    if (
      !input.taskId ||
      !input.executionId ||
      !/^[0-9a-f]{64}$/i.test(input.manifestHash) ||
      !Number.isInteger(input.claimEpoch) ||
      input.claimEpoch < 0 ||
      !input.leaseId ||
      !input.runnerId
    ) {
      throw new ForbiddenException('verifier_capability_binding_required');
    }
  }
}
