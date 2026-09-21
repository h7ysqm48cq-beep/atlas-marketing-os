import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { AuthenticatedBootstrapActor } from '../worker/supervisor-bootstrap-actor-registry';
import { canonicalizeAuthorityValue } from '../authority/supervisor-authority.service';
import type { ActorPurpose, TrustedActorRegistry } from './actor-provenance';
import {
  issueWorkerPreclaimChallenge, verifyWorkerPreclaimProof,
  type WorkerPreclaimChallenge, type SignedWorkerPreclaimProof,
} from './worker-preclaim-proof';
import {
  ACTOR_ATTESTATION_DOMAIN, type ActorSignature, type SignedClaimBinding,
} from './signed-execution-attestation';

export interface WorkerExactClaimOffer {
  // Verifier receives the already frozen candidate to sign completion.
  // It is not part of preclaim or claim binding; READY re-reads task evidence.
  reviewCandidate?: NonNullable<SupervisorTask['evidence']>['reviewCandidate'];
  candidateBranch?: string;
  challenge: WorkerPreclaimChallenge;
  claimBinding: SignedClaimBinding;
  // Captures the exact QUEUED assignment before any claim fields are added.
  assignmentSnapshotDigest: string;
  taskUpdatedAt: string;
}

export function offerDigest(value: unknown): string {
  return createHash('sha256')
    .update(canonicalizeAuthorityValue(value), 'utf8').digest('hex');
}

function deny(): never {
  throw new ForbiddenException('worker_exact_claim_offer_required');
}

/** Creates an offer from an existing QUEUED execution. No task is claimed. */
export function issueWorkerExactClaimOffer(input: {
  actor: AuthenticatedBootstrapActor;
  task: SupervisorTask;
  execution: SupervisorExecution;
  purpose: ActorPurpose;
  runnerId: string;
  leaseId: string;
  now: Date;
}): WorkerExactClaimOffer {
  try {
    const { actor, task, execution, purpose, runnerId, leaseId, now } = input;
    const required = purpose === 'INDEPENDENT_VERIFICATION'
      ? 'VERIFYING' : 'WORKING';
    const assignment = execution.assignment;
    if (task.status !== required || execution.status !== 'QUEUED' ||
        task.owner !== actor.workerRole ||
        execution.workerRole !== actor.workerRole ||
        execution.taskId !== task.id ||
        assignment.taskId !== task.id ||
        assignment.executionId !== execution.id ||
        assignment.workerRole !== actor.workerRole ||
        (assignment.executionPurpose ?? 'IMPLEMENTATION') !== purpose ||
        !actor.purposes.includes(purpose) ||
        !/^[0-9a-f]{40}$/i.test(assignment.frozenBaseSha ?? '') ||
        !/^[0-9a-f]{64}$/i.test(assignment.manifestHash ?? '') ||
        !runnerId?.trim() || !leaseId?.trim() ||
        !Number.isInteger(execution.claimEpoch) ||
        execution.claimEpoch < 0 ||
        !Number.isFinite(task.updatedAt.getTime()) ||
        !Number.isFinite(now.getTime())) deny();
    const challenge = issueWorkerPreclaimChallenge({ actor, purpose, now });
    return {
      challenge,
      claimBinding: {
        taskId: task.id,
        executionId: execution.id,
        purpose,
        manifestHash: assignment.manifestHash!,
        claimEpoch: execution.claimEpoch + 1,
        runnerId, leaseId,
        claimNonce: challenge.nonce,
        authenticatedAt: challenge.issuedAt,
        frozenBaseSha: assignment.frozenBaseSha!,
      },
      assignmentSnapshotDigest: offerDigest(assignment),
      taskUpdatedAt: task.updatedAt.toISOString(),
    };
  } catch {
    deny();
  }
}

/**
 * Verify exact worker signature BEFORE the database CAS. The expected offer,
 * current QUEUED execution and task MUST originate from the server's DB
 * transaction, not the caller. The challenge is not consumed here.
 */
export function verifyWorkerExactClaimOffer(input: {
  actor: AuthenticatedBootstrapActor | null | undefined;
  expected: WorkerExactClaimOffer | null | undefined;
  task: SupervisorTask;
  execution: SupervisorExecution;
  preclaimProof: SignedWorkerPreclaimProof | null | undefined;
  claimProof: ActorSignature<SignedClaimBinding> | null | undefined;
  registry: TrustedActorRegistry | null | undefined;
  now: Date;
}): void {
  try {
    const { expected, actor, preclaimProof, claimProof, registry, now } = input;
    if (!expected || !actor || !claimProof || !registry) deny();
    const principal = verifyWorkerPreclaimProof({
      actor, expected: expected.challenge, proof: preclaimProof,
      registry, now,
    });
    if (claimProof.kid !== principal.kid ||
        claimProof.kid !== expected.challenge.kid ||
        !expected.challenge.id ||
        expected.claimBinding.claimNonce !== expected.challenge.nonce ||
        expected.claimBinding.authenticatedAt !== expected.challenge.issuedAt ||
        expected.claimBinding.purpose !== expected.challenge.purpose ||
        expected.claimBinding.taskId !== input.task.id ||
        expected.claimBinding.executionId !== input.execution.id ||
        expected.claimBinding.claimEpoch !== input.execution.claimEpoch + 1 ||
        expected.claimBinding.manifestHash !==
          input.execution.assignment.manifestHash ||
        expected.claimBinding.frozenBaseSha !==
          input.execution.assignment.frozenBaseSha ||
        expected.claimBinding.runnerId?.trim() === '' ||
        expected.claimBinding.leaseId?.trim() === '' ||
        input.execution.status !== 'QUEUED' ||
        input.task.status !== (expected.challenge.purpose ===
          'INDEPENDENT_VERIFICATION' ? 'VERIFYING' : 'WORKING') ||
        input.task.owner !== principal.workerRole ||
        input.execution.workerRole !== principal.workerRole ||
        input.execution.taskId !== input.task.id ||
        (input.execution.assignment.executionPurpose ?? 'IMPLEMENTATION') !==
          expected.challenge.purpose ||
        input.task.updatedAt.toISOString() !== expected.taskUpdatedAt ||
        offerDigest(input.execution.assignment) !==
          expected.assignmentSnapshotDigest ||
        canonicalizeAuthorityValue(claimProof.binding) !==
          canonicalizeAuthorityValue(expected.claimBinding) ||
        typeof claimProof.signature !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(claimProof.signature)) deny();

    const key = registry.resolve(principal.kid);
    if (!key || key.status !== 'ACTIVE' ||
        key.principalId !== principal.principalId ||
        key.controllingPrincipalId !== principal.controllingPrincipalId ||
        !key.permittedPurposes.includes(expected.claimBinding.purpose)) deny();
    const pub = createPublicKey(key.publicKeyPem);
    if (pub.asymmetricKeyType !== 'ed25519') deny();
    const signature = Buffer.from(claimProof.signature, 'base64url');
    if (signature.length !== 64 ||
        signature.toString('base64url') !== claimProof.signature ||
        !verifySignature(null, Buffer.from(canonicalizeAuthorityValue({
          domain: ACTOR_ATTESTATION_DOMAIN.claim,
          kid: claimProof.kid,
          binding: claimProof.binding,
        }), 'utf8'), pub, signature)) deny();
  } catch {
    deny();
  }
}
