import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { canonicalizeAuthorityValue } from '../authority/supervisor-authority.service';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { AuthenticatedBootstrapActor } from '../worker/supervisor-bootstrap-actor-registry';
import type { TrustedActorRegistry } from './actor-provenance';
import type { ActorSignature } from './signed-execution-attestation';

export const SIGNED_HEARTBEAT_DOMAIN = 'atlas.actor.heartbeat.v1';
export const SIGNED_HEARTBEAT_LEASE_MS = 60_000;
export interface SignedHeartbeatBinding {
  taskId: string; executionId: string; claimEpoch: number;
  runnerId: string; leaseId: string; claimNonce: string;
  issuedAt: string;
}
function deny(): never {
  throw new ForbiddenException('signed_worker_heartbeat_required');
}
/**
 * Heartbeat only extends the exact existing signed execution lease.
 * No new claim, no challenge reuse, no minting of an independent identity.
 * DB transaction must CAS update lastHeartbeatAt (anti-replay) and lease.
 */
export function verifySignedWorkerHeartbeat(input: {
  actor: AuthenticatedBootstrapActor | null | undefined;
  execution: SupervisorExecution;
  claimRow: { kid: string; claimNonce: string;
    claimEpoch: number } | null;
  registry: TrustedActorRegistry | null | undefined;
  proof: ActorSignature<SignedHeartbeatBinding> | null | undefined;
  now: Date;
}): Date {
  try {
    const { actor, execution, claimRow, registry, proof, now } = input;
    const binding = proof?.binding;
    const stamped = binding?.issuedAt;
    if (!actor || !claimRow || !registry || !proof || !binding ||
        !Number.isFinite(now.getTime()) ||
        execution.status !== 'RUNNING' || execution.result !== null ||
        !execution.lastHeartbeatAt || !execution.leaseExpiresAt ||
        !execution.startedAt || !execution.runnerId ||
        !execution.assignment.leaseId ||
        execution.assignment.bootstrapActor?.kid !== actor.kid ||
        execution.assignment.bootstrapActor?.principalId !== actor.principalId ||
        execution.assignment.bootstrapActor?.controllingPrincipalId !==
          actor.controllingPrincipalId ||
        execution.assignment.bootstrapActor?.workerRole !== actor.workerRole ||
        execution.workerRole !== actor.workerRole ||
        execution.assignment.claimEpoch !== execution.claimEpoch ||
        execution.assignment.runnerId !== execution.runnerId ||
        claimRow.kid !== actor.kid ||
        claimRow.claimEpoch !== execution.claimEpoch ||
        claimRow.claimNonce !== execution.assignment.bootstrapActor?.claimNonce ||
        typeof stamped !== 'string' ||
        !Number.isFinite(Date.parse(stamped)) ||
        new Date(stamped).toISOString() !== stamped ||
        Date.parse(stamped) <= execution.lastHeartbeatAt.getTime() ||
        Date.parse(stamped) < execution.startedAt.getTime() ||
        Date.parse(stamped) > now.getTime() + 5_000 ||
        now.getTime() - Date.parse(stamped) > 30_000 ||
        now.getTime() >= execution.leaseExpiresAt.getTime() ||
        binding.taskId !== execution.taskId ||
        binding.executionId !== execution.id ||
        binding.claimEpoch !== execution.claimEpoch ||
        binding.runnerId !== execution.runnerId ||
        binding.leaseId !== execution.assignment.leaseId ||
        binding.claimNonce !== claimRow.claimNonce ||
        proof.kid !== actor.kid ||
        !actor.purposes.includes(
          execution.assignment.executionPurpose ?? 'IMPLEMENTATION')) deny();
    const purpose = execution.assignment.executionPurpose ?? 'IMPLEMENTATION';
    const key = registry.resolve(actor.kid);
    if (!key || key.status !== 'ACTIVE' ||
        key.principalId !== actor.principalId ||
        key.controllingPrincipalId !== actor.controllingPrincipalId ||
        !key.permittedPurposes.includes(purpose)) deny();
    const pub = createPublicKey(key.publicKeyPem);
    if (pub.asymmetricKeyType !== 'ed25519' ||
        typeof proof.signature !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(proof.signature)) deny();
    const signature = Buffer.from(proof.signature, 'base64url');
    if (signature.length !== 64 ||
        signature.toString('base64url') !== proof.signature ||
        !verifySignature(null, Buffer.from(canonicalizeAuthorityValue({
          domain: SIGNED_HEARTBEAT_DOMAIN, kid: proof.kid, binding,
        }), 'utf8'), pub, signature)) deny();
    return new Date(stamped);
  } catch {
    deny();
  }
}
