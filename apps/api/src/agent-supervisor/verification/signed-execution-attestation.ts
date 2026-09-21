import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { SupervisorTask, SupervisorReviewCandidate } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { canonicalizeAuthorityValue } from '../authority/supervisor-authority.service';
import type { TrustedActorKey, TrustedActorRegistry } from './actor-provenance';

type Purpose = 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION';

export interface SignedClaimBinding {
  taskId: string;
  executionId: string;
  purpose: Purpose;
  manifestHash: string;
  claimEpoch: number;
  runnerId: string;
  leaseId: string;
  claimNonce: string;
  authenticatedAt: string;
  frozenBaseSha: string;
}
export interface SignedCompletionBinding {
  taskId: string;
  executionId: string;
  claimProofDigest: string;
  resultDigest: string;
  completedAt: string;
  candidate: SupervisorReviewCandidate;
}
export interface ActorSignature<T> {
  kid: string;
  binding: T;
  signature: string;
}
/**
 * Data MUST come from server-controlled, immutable, transactionally persisted
 * claim and completion records, not HTTP bodies or mutable task evidence.
 * This validator does NOT establish when a proof was originally persisted.
 */
export interface PersistedActorAttestation {
  claim: ActorSignature<SignedClaimBinding>;
  completion: ActorSignature<SignedCompletionBinding>;
}

function deny(): never {
  throw new ForbiddenException('independent_verifier_attestation_required');
}
function canonical(value: unknown): string {
  return canonicalizeAuthorityValue(value);
}
function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
function paths(value: string[]): string {
  if (!Array.isArray(value) ||
      value.some(path => typeof path !== 'string' || !path.trim()) ||
      new Set(value).size !== value.length) deny();
  return canonical([...value].sort());
}
function candidateEquals(left: SupervisorReviewCandidate,
  right: SupervisorReviewCandidate): boolean {
  return left.action === right.action &&
    left.targetBranch === right.targetBranch &&
    left.baseSha === right.baseSha &&
    left.headSha === right.headSha &&
    paths(left.changedFiles) === paths(right.changedFiles);
}
function signatureValid<T>(
  proof: ActorSignature<T> | null | undefined,
  expectedBinding: T,
  domain: 'atlas.actor.claim.v1' | 'atlas.actor.completion.v1',
  key: TrustedActorKey,
): boolean {
  if (!proof || proof.kid !== key.kid ||
      typeof proof.signature !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(proof.signature) ||
      canonical(proof.binding) !== canonical(expectedBinding)) return false;
  try {
    const signature = Buffer.from(proof.signature, 'base64url');
    if (signature.length !== 64 ||
        signature.toString('base64url') !== proof.signature) return false;
    return verifySignature(null, Buffer.from(canonical({
      domain, kid: proof.kid, binding: proof.binding,
    }), 'utf8'), createPublicKey(key.publicKeyPem), signature);
  } catch {
    return false;
  }
}
function actorProof(
  execution: SupervisorExecution,
  purpose: Purpose,
  candidate: SupervisorReviewCandidate,
  attestation: PersistedActorAttestation | null | undefined,
  registry: TrustedActorRegistry,
): TrustedActorKey {
  const actor = execution.assignment.bootstrapActor;
  if (!attestation || !actor || !execution.result ||
      execution.status !== 'COMPLETED' ||
      execution.assignment.executionPurpose !== purpose ||
      execution.assignment.taskId !== execution.taskId ||
      execution.assignment.executionId !== execution.id ||
      execution.claimEpoch < 1 ||
      execution.assignment.claimEpoch !== execution.claimEpoch ||
      execution.assignment.runnerId !== execution.runnerId ||
      !execution.runnerId ||
      !execution.assignment.manifestHash ||
      !execution.assignment.leaseId ||
      !execution.startedAt || !execution.completedAt ||
      !Number.isFinite(execution.startedAt.getTime()) ||
      !Number.isFinite(execution.completedAt.getTime()) ||
      execution.startedAt.getTime() > execution.completedAt.getTime() ||
      actor.workerRole !== execution.workerRole ||
      !actor.purposes.includes(purpose) ||
      !actor.claimNonce || !actor.authenticatedAt ||
      !Number.isFinite(Date.parse(actor.authenticatedAt)) ||
      actor.kid !== attestation.claim.kid ||
      actor.kid !== attestation.completion.kid) deny();

  const key = registry.resolve(actor.kid);
  if (!key || key.status !== 'ACTIVE' ||
      key.kid !== actor.kid ||
      key.principalId !== actor.principalId ||
      key.controllingPrincipalId !== actor.controllingPrincipalId ||
      !key.permittedPurposes.includes(purpose)) deny();

  const expectedClaim: SignedClaimBinding = {
    taskId: execution.taskId,
    executionId: execution.id,
    purpose,
    manifestHash: execution.assignment.manifestHash,
    claimEpoch: execution.claimEpoch,
    runnerId: execution.runnerId,
    leaseId: execution.assignment.leaseId,
    claimNonce: actor.claimNonce,
    authenticatedAt: actor.authenticatedAt,
    frozenBaseSha: candidate.baseSha,
  };
  if (execution.assignment.frozenBaseSha !== candidate.baseSha ||
      !signatureValid(attestation.claim, expectedClaim,
        'atlas.actor.claim.v1', key)) deny();

  const expectedCompletion: SignedCompletionBinding = {
    taskId: execution.taskId,
    executionId: execution.id,
    claimProofDigest: digest(attestation.claim),
    resultDigest: digest(execution.result),
    completedAt: execution.completedAt.toISOString(),
    candidate: {
      action: candidate.action,
      targetBranch: candidate.targetBranch,
      baseSha: candidate.baseSha,
      headSha: candidate.headSha,
      changedFiles: [...candidate.changedFiles].sort(),
    },
  };
  if (!candidateEquals(attestation.completion.binding.candidate, candidate) ||
      !signatureValid(attestation.completion, expectedCompletion,
        'atlas.actor.completion.v1', key) ||
      paths(execution.result.evidence.changedFiles) !==
        paths(candidate.changedFiles)) deny();
  if (execution.result.evidence.reviewCandidate &&
      !candidateEquals(execution.result.evidence.reviewCandidate, candidate)) {
    deny();
  }
  return key;
}

/**
 * Cryptographic *validator*, not a producer/persistence integration.
 * Every proof must be obtained from a trusted immutable record during the
 * same READY_FOR_REVIEW transaction that checks executions and releases locks.
 */
function verifyIndependentPair(input: {
  task: SupervisorTask;
  implementation: SupervisorExecution;
  verifier: SupervisorExecution;
  implementationAttestation: PersistedActorAttestation | null | undefined;
  verifierAttestation: PersistedActorAttestation | null | undefined;
  registry: TrustedActorRegistry | null | undefined;
}): void {
  const { task, implementation, verifier, registry } = input;
  const candidate = task.evidence?.reviewCandidate;
  if (!registry || !candidate ||
      !/^[0-9a-f]{40}$/i.test(candidate.baseSha) ||
      !/^[0-9a-f]{40}$/i.test(candidate.headSha) ||
      paths(candidate.changedFiles) !== paths(task.evidence!.changedFiles) ||
      implementation.taskId !== task.id || verifier.taskId !== task.id ||
      implementation.id === verifier.id ||
      implementation.completedAt === null ||
      verifier.startedAt === null ||
      implementation.completedAt.getTime() > verifier.startedAt.getTime()) deny();
  const first = actorProof(implementation, 'IMPLEMENTATION',
    candidate, input.implementationAttestation, registry);
  const second = actorProof(verifier, 'INDEPENDENT_VERIFICATION',
    candidate, input.verifierAttestation, registry);
  const firstKey = createPublicKey(first.publicKeyPem).export({
    format: 'der', type: 'spki',
  });
  const secondKey = createPublicKey(second.publicKeyPem).export({
    format: 'der', type: 'spki',
  });
  if (first.principalId === second.principalId ||
      first.controllingPrincipalId === second.controllingPrincipalId ||
      firstKey.equals(secondKey)) deny();
}

export function requireSignedIndependentExecutionPair(
  input: Parameters<typeof verifyIndependentPair>[0],
): void {
  // Malformed persisted JSON and invalid public keys also fail CLOSED with
  // the same diagnostic instead of leaking TypeError or unsafe partial state.
  try {
    verifyIndependentPair(input);
  } catch {
    deny();
  }
}

/** Validate one persisted signed completion without granting READY authority. */
export function requireSignedActorExecution(input: {
  execution: SupervisorExecution;
  purpose: Purpose; candidate: SupervisorReviewCandidate;
  attestation: PersistedActorAttestation | null | undefined;
  registry: TrustedActorRegistry | null | undefined;
}): void {
  try {
    if (!input.registry) deny();
    actorProof(input.execution, input.purpose, input.candidate,
      input.attestation, input.registry);
  } catch {
    deny();
  }
}

export const ACTOR_ATTESTATION_DOMAIN = {
  claim: 'atlas.actor.claim.v1',
  completion: 'atlas.actor.completion.v1',
} as const;
