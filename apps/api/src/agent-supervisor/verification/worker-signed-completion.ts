import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { SupervisorReviewCandidate, SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution, WorkerExecutionResult } from '../execution/supervisor-execution.types';
import type { AuthenticatedBootstrapActor } from '../worker/supervisor-bootstrap-actor-registry';
import type { TrustedActorRegistry } from './actor-provenance';
import { canonicalizeAuthorityValue } from '../authority/supervisor-authority.service';
import { offerDigest } from './worker-exact-claim-offer';
import {
  ACTOR_ATTESTATION_DOMAIN,
  type ActorSignature, type SignedClaimBinding, type SignedCompletionBinding,
} from './signed-execution-attestation';

export interface StoredExactClaimProof {
  kid: string;
  binding: SignedClaimBinding;
  signature: string;
  preclaimChallengeId: string;
  preclaimSignature: string;
}

function deny(): never {
  throw new ForbiddenException('signed_execution_completion_required');
}
function canonical(value: unknown): string {
  return canonicalizeAuthorityValue(value);
}
function samePaths(first: string[], second: string[]): boolean {
  if (!Array.isArray(first) || !Array.isArray(second) ||
      [...first, ...second].some(p => typeof p !== 'string' || !p.trim()) ||
      new Set(first).size !== first.length ||
      new Set(second).size !== second.length) return false;
  return canonical([...first].sort()) === canonical([...second].sort());
}
function normalizedCandidate(
  candidate: SupervisorReviewCandidate,
): SupervisorReviewCandidate {
  return {
    action: candidate.action, targetBranch: candidate.targetBranch,
    baseSha: candidate.baseSha, headSha: candidate.headSha,
    changedFiles: [...candidate.changedFiles].sort(),
  };
}
function verifyEd25519(
  proof: ActorSignature<unknown>,
  domain: string,
  publicKeyPem: string,
): boolean {
  try {
    const pub = createPublicKey(publicKeyPem);
    if (pub.asymmetricKeyType !== 'ed25519' ||
        typeof proof.signature !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(proof.signature)) return false;
    const bytes = Buffer.from(proof.signature, 'base64url');
    if (bytes.length !== 64 ||
        bytes.toString('base64url') !== proof.signature) return false;
    return verifySignature(null, Buffer.from(canonical({
      domain, kid: proof.kid, binding: proof.binding,
    }), 'utf8'), pub, bytes);
  } catch {
    return false;
  }
}

/**
 * Pure pre-COMPLETED validator. Its claim must come from the immutable ledger
 * read under task+execution locks; actor from guard, not a request body.
 * Caller must store completion in same DB transaction AFTER validation.
 */
function validateSignedCompletion(input: {
  actor: AuthenticatedBootstrapActor | null | undefined;
  task: SupervisorTask;
  execution: SupervisorExecution;
  result: WorkerExecutionResult;
  completedAt: string;
  now: Date;
  claimRow: { proof: unknown; proofDigest: string; claimEpoch: number;
    taskId: string; kid: string; claimNonce: string } | null;
  completionProof: ActorSignature<SignedCompletionBinding> | null | undefined;
  registry: TrustedActorRegistry | null | undefined;
}): { claimDigest: string; claimEpoch: number;
  completion: ActorSignature<SignedCompletionBinding> } {
  const { actor, task, execution, result, claimRow, completionProof,
    registry, completedAt, now } = input;
  if (!actor || !registry || !claimRow || !completionProof ||
      execution.status !== 'RUNNING' || execution.result !== null ||
      execution.error !== null || execution.completedAt !== null ||
      task.id !== execution.taskId || task.owner !== actor.workerRole ||
      execution.workerRole !== actor.workerRole ||
      execution.assignment.taskId !== task.id ||
      execution.assignment.executionId !== execution.id ||
      execution.runnerId === null || execution.claimEpoch < 1 ||
      execution.assignment.claimEpoch !== execution.claimEpoch ||
      execution.assignment.runnerId !== execution.runnerId ||
      !execution.assignment.leaseId ||
      !execution.assignment.manifestHash ||
      !execution.assignment.frozenBaseSha ||
      !result || !result.evidence || !result.summary?.trim() ||
      !Number.isFinite(now.getTime()) ||
      typeof completedAt !== 'string' ||
      !Number.isFinite(Date.parse(completedAt)) ||
      new Date(completedAt).toISOString() !== completedAt ||
      Math.abs(now.getTime() - Date.parse(completedAt)) > 120_000 ||
      !execution.startedAt ||
      Date.parse(completedAt) < execution.startedAt.getTime()) deny();

  const purpose = execution.assignment.executionPurpose ?? 'IMPLEMENTATION';
  // Real lifecycle: implementation publishes and COMPLETES while the task is
  // WORKING. submitImplementation stores candidate only AFTER completion.
  // Verifier must use the task's frozen candidate already in VERIFYING.
  const candidate = purpose === 'IMPLEMENTATION'
    ? result.evidence.reviewCandidate : task.evidence?.reviewCandidate;
  if (!candidate ||
      !/^[0-9a-f]{40}$/i.test(candidate.baseSha) ||
      !/^[0-9a-f]{40}$/i.test(candidate.headSha) ||
      !samePaths(candidate.changedFiles, result.evidence.changedFiles) ||
      (purpose === 'INDEPENDENT_VERIFICATION' &&
       (!task.evidence ||
        !samePaths(candidate.changedFiles, task.evidence.changedFiles))) ||
      (task.evidence?.reviewCandidate &&
       canonical(normalizedCandidate(task.evidence.reviewCandidate)) !==
         canonical(normalizedCandidate(candidate))) ||
      (result.evidence.reviewCandidate &&
       canonical(normalizedCandidate(result.evidence.reviewCandidate)) !==
         canonical(normalizedCandidate(candidate)))) deny();
  if (purpose === 'IMPLEMENTATION') {
    const receipt = result.evidence.candidatePublication;
    if (!receipt || receipt.remoteVerified !== true ||
        receipt.taskId !== task.id ||
        receipt.executionId !== execution.id ||
        receipt.targetBranch !== 'production/atlas' ||
        receipt.candidateBranch !==
          `atlas/candidate/${task.id}/${execution.id}` ||
        receipt.baseSha !== candidate.baseSha ||
        receipt.headSha !== candidate.headSha ||
        receipt.remoteHeadSha !== candidate.headSha ||
        !samePaths(receipt.changedFiles, candidate.changedFiles)) deny();
  }
  if ((purpose !== 'IMPLEMENTATION' &&
       purpose !== 'INDEPENDENT_VERIFICATION') ||
      !actor.purposes.includes(purpose) ||
      task.status !== (purpose === 'IMPLEMENTATION' ?
        'WORKING' : 'VERIFYING') ||
      !actor.kid || !actor.principalId || !actor.controllingPrincipalId ||
      claimRow.taskId !== task.id ||
      claimRow.claimEpoch !== execution.claimEpoch ||
      claimRow.kid !== actor.kid ||
      completionProof.kid !== actor.kid) deny();
  const stored = claimRow.proof as StoredExactClaimProof;
  if (!stored || typeof stored !== 'object' ||
      typeof stored.preclaimChallengeId !== 'string' ||
      !stored.preclaimChallengeId.trim() ||
      typeof stored.preclaimSignature !== 'string' ||
      !stored.preclaimSignature.trim() ||
      stored.kid !== actor.kid || !stored.binding ||
      typeof stored.signature !== 'string') deny();
  const actorClaim = execution.assignment.bootstrapActor;
  if (!actorClaim ||
      actorClaim.kid !== actor.kid ||
      actorClaim.principalId !== actor.principalId ||
      actorClaim.controllingPrincipalId !== actor.controllingPrincipalId ||
      actorClaim.workerRole !== actor.workerRole ||
      !actorClaim.purposes.includes(purpose) ||
      actorClaim.claimNonce !== claimRow.claimNonce) deny();
  const key = registry.resolve(actor.kid);
  if (!key || key.status !== 'ACTIVE' ||
      key.principalId !== actor.principalId ||
      key.controllingPrincipalId !== actor.controllingPrincipalId ||
      !key.permittedPurposes.includes(purpose)) deny();
  const expectedClaim: SignedClaimBinding = {
    taskId: task.id, executionId: execution.id, purpose,
    manifestHash: execution.assignment.manifestHash,
    claimEpoch: execution.claimEpoch,
    runnerId: execution.runnerId,
    leaseId: execution.assignment.leaseId,
    claimNonce: actorClaim.claimNonce,
    authenticatedAt: actorClaim.authenticatedAt,
    frozenBaseSha: candidate.baseSha,
  };
  const pureClaim: ActorSignature<SignedClaimBinding> = {
    kid: stored.kid, binding: stored.binding, signature: stored.signature,
  };
  const digest = offerDigest(pureClaim);
  if (execution.assignment.frozenBaseSha !== candidate.baseSha ||
      claimRow.proofDigest !== digest ||
      canonical(stored.binding) !== canonical(expectedClaim) ||
      !verifyEd25519(pureClaim, ACTOR_ATTESTATION_DOMAIN.claim,
        key.publicKeyPem)) deny();

  const expectedCompletion: SignedCompletionBinding = {
    taskId: task.id, executionId: execution.id,
    claimProofDigest: digest, resultDigest: offerDigest(result),
    completedAt,
    candidate: normalizedCandidate(candidate),
  };
  if (canonical(completionProof.binding) !== canonical(expectedCompletion) ||
      !verifyEd25519(completionProof,
        ACTOR_ATTESTATION_DOMAIN.completion, key.publicKeyPem)) deny();
  return { claimDigest: digest, claimEpoch: execution.claimEpoch,
    completion: completionProof };
}
export function verifySignedExecutionCompletion(
  input: Parameters<typeof validateSignedCompletion>[0],
): ReturnType<typeof validateSignedCompletion> {
  try {
    return validateSignedCompletion(input);
  } catch {
    deny();
  }
}
