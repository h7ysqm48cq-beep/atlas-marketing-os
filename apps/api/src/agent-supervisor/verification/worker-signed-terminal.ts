import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { canonicalizeAuthorityValue } from '../authority/supervisor-authority.service';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { AuthenticatedBootstrapActor } from '../worker/supervisor-bootstrap-actor-registry';
import type { TrustedActorRegistry } from './actor-provenance';
import type { ActorSignature } from './signed-execution-attestation';

export const SIGNED_TERMINAL_DOMAIN = 'atlas.actor.terminal.v1';
export interface SignedTerminalBinding {
  taskId: string; executionId: string; claimEpoch: number;
  runnerId: string; leaseId: string; claimNonce: string;
  status: 'FAILED' | 'CANCELLED'; reason: string; issuedAt: string;
}
function deny(): never {
  throw new ForbiddenException('signed_worker_terminal_required');
}
/**
 * Failure/cancellation NEVER supplies evidence for READY.
 * Worker must prove possession of the SAME key as its immutable claim,
 * and cannot terminate another actor's execution or an expired lease.
 */
export function verifySignedWorkerTerminal(input: {
  actor: AuthenticatedBootstrapActor | null | undefined;
  execution: SupervisorExecution;
  claimRow: { kid: string; claimNonce: string;
    claimEpoch: number } | null;
  registry: TrustedActorRegistry | null | undefined;
  proof: ActorSignature<SignedTerminalBinding> | null | undefined;
  now: Date;
}): SignedTerminalBinding {
  try {
    const { actor, execution, claimRow, registry, proof, now } = input;
    const binding = proof?.binding;
    if (!actor || !claimRow || !registry || !proof || !binding ||
        !Number.isFinite(now.getTime()) ||
        execution.status !== 'RUNNING' ||
        execution.result !== null || execution.completedAt !== null ||
        execution.error !== null ||
        !execution.startedAt || !execution.leaseExpiresAt ||
        !execution.runnerId || !execution.assignment.leaseId ||
        !execution.assignment.bootstrapActor ||
        execution.assignment.bootstrapActor.kid !== actor.kid ||
        execution.assignment.bootstrapActor.principalId !== actor.principalId ||
        execution.assignment.bootstrapActor.controllingPrincipalId !==
          actor.controllingPrincipalId ||
        execution.assignment.bootstrapActor.workerRole !== actor.workerRole ||
        !actor.purposes.includes(
          execution.assignment.executionPurpose ?? 'IMPLEMENTATION') ||
        execution.workerRole !== actor.workerRole ||
        execution.assignment.claimEpoch !== execution.claimEpoch ||
        execution.assignment.runnerId !== execution.runnerId ||
        claimRow.kid !== actor.kid ||
        claimRow.claimEpoch !== execution.claimEpoch ||
        claimRow.claimNonce !==
          execution.assignment.bootstrapActor.claimNonce ||
        now.getTime() >= execution.leaseExpiresAt.getTime() ||
        proof.kid !== actor.kid ||
        binding.taskId !== execution.taskId ||
        binding.executionId !== execution.id ||
        binding.claimEpoch !== execution.claimEpoch ||
        binding.runnerId !== execution.runnerId ||
        binding.leaseId !== execution.assignment.leaseId ||
        binding.claimNonce !== claimRow.claimNonce ||
        (binding.status !== 'FAILED' && binding.status !== 'CANCELLED') ||
        typeof binding.reason !== 'string' ||
        !binding.reason.trim() || binding.reason.length > 1024 ||
        typeof binding.issuedAt !== 'string' ||
        !Number.isFinite(Date.parse(binding.issuedAt)) ||
        new Date(binding.issuedAt).toISOString() !== binding.issuedAt ||
        Date.parse(binding.issuedAt) < execution.startedAt.getTime() ||
        Math.abs(now.getTime() - Date.parse(binding.issuedAt)) > 30_000) {
      deny();
    }
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
    const bytes = Buffer.from(proof.signature, 'base64url');
    if (bytes.length !== 64 ||
        bytes.toString('base64url') !== proof.signature ||
        !verifySignature(null, Buffer.from(canonicalizeAuthorityValue({
          domain: SIGNED_TERMINAL_DOMAIN, kid: actor.kid, binding,
        })), pub, bytes)) deny();
    return binding;
  } catch {
    deny();
  }
}
