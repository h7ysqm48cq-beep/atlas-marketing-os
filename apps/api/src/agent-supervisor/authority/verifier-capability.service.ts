import { createHash, randomUUID } from 'node:crypto';
import type { BootstrapActorClaim } from '../worker/supervisor-bootstrap-actor-registry';
import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  SupervisorAuthorityService,
  canonicalizeAuthorityValue,
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
  bootstrapActor?: BootstrapActorClaim;
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
  actorBindingDigest?: string;
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
      ...(input.bootstrapActor ? {
        actorBindingDigest: this.actorBindingDigest(input.bootstrapActor),
      } : {}),
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
    const expectedActorDigest = input.bootstrapActor
      ? this.actorBindingDigest(input.bootstrapActor) : undefined;
    if (claims.actorBindingDigest !== expectedActorDigest) {
      throw new ForbiddenException('verifier_capability_actor_binding_mismatch');
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

  private actorBindingDigest(actor: BootstrapActorClaim): string {
    if (!actor.kid?.trim() || !actor.principalId?.trim() ||
        !actor.controllingPrincipalId?.trim() || !actor.claimNonce?.trim() ||
        !Number.isFinite(Date.parse(actor.authenticatedAt)) ||
        !actor.purposes?.includes('INDEPENDENT_VERIFICATION')) {
      throw new ForbiddenException('verifier_capability_actor_binding_invalid');
    }
    return createHash('sha256')
      .update(canonicalizeAuthorityValue(actor), 'utf8').digest('hex');
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
