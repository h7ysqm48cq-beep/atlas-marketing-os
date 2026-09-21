import { BadRequestException } from '@nestjs/common';
import type { SupervisorTask, SupervisorReviewCandidate } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';

function sameCandidate(left: SupervisorReviewCandidate, right: SupervisorReviewCandidate) {
  const leftFiles = [...left.changedFiles].sort();
  const rightFiles = [...right.changedFiles].sort();
  return (
    left.action === right.action &&
    left.targetBranch === right.targetBranch &&
    left.baseSha === right.baseSha &&
    left.headSha === right.headSha &&
    leftFiles.length === rightFiles.length &&
    leftFiles.every((path, index) => path === rightFiles[index])
  );
}

// Checks persisted execution evidence, not merely a user-supplied ready flag.
// Claim/runner metadata is not yet independently authenticated actor identity.
export function requireCompletedIndependentVerification(
  task: SupervisorTask,
  executions: SupervisorExecution[],
): void {
  const verifierExecutions = executions.filter(
    (execution) =>
      execution.taskId === task.id &&
      execution.assignment.executionPurpose === 'INDEPENDENT_VERIFICATION',
  );
  const active = verifierExecutions.some((execution) =>
    ['QUEUED', 'DISPATCHED', 'RUNNING'].includes(execution.status),
  );
  const completed = verifierExecutions.filter((execution) =>
    execution.status === 'COMPLETED' &&
    execution.result !== null &&
    Boolean(execution.result.summary.trim()) &&
    execution.completedAt instanceof Date &&
    Number.isFinite(execution.completedAt.getTime()) &&
    execution.startedAt instanceof Date &&
    execution.completedAt.getTime() >= execution.startedAt.getTime() &&
    execution.startedAt.getTime() >= task.updatedAt.getTime() &&
    execution.assignment.taskId === task.id &&
    execution.assignment.executionId === execution.id &&
    execution.assignment.workerRole === task.owner &&
    execution.workerRole === task.owner &&
    execution.error === null &&
    typeof execution.runnerId === 'string' &&
    Boolean(execution.runnerId.trim()) &&
    execution.claimEpoch > 0 &&
    execution.assignment.claimEpoch === execution.claimEpoch &&
    execution.assignment.runnerId === execution.runnerId &&
    Boolean(execution.assignment.manifestHash?.trim()),
  );
  if (active || completed.length !== 1) {
    throw new BadRequestException({ code: 'independent_verification_required' });
  }
  // First-hop identity provenance is mandatory, not a replacement for signed
  // claim/completion attestation. A historical role-only verifier MUST NOT
  // become READY simply because result/status/runner fields look consistent.
  const verified = completed[0];
  const verifierActor = verified.assignment.bootstrapActor;
  const implementations = executions.filter(execution =>
    execution.taskId === task.id &&
    (execution.assignment.executionPurpose ?? 'IMPLEMENTATION') === 'IMPLEMENTATION' &&
    execution.status === 'COMPLETED' && execution.result !== null &&
    Boolean(execution.result.summary.trim()) &&
    execution.error === null &&
    execution.assignment.bootstrapActor !== undefined &&
    execution.assignment.executionId === execution.id &&
    execution.assignment.taskId === task.id &&
    execution.assignment.workerRole === task.owner &&
    execution.workerRole === task.owner &&
    execution.assignment.claimEpoch === execution.claimEpoch &&
    execution.assignment.runnerId === execution.runnerId &&
    execution.runnerId !== null &&
    Boolean(execution.assignment.manifestHash?.trim()) &&
    execution.claimEpoch > 0 &&
    execution.startedAt instanceof Date &&
    execution.completedAt instanceof Date &&
    // Implementation may predate VERIFYING/task.updatedAt. The verifier
    // (checked above) must start after the task entered its current version.
    execution.completedAt.getTime() >= execution.startedAt.getTime() &&
    execution.completedAt.getTime() <= verified.startedAt!.getTime() &&
    [...execution.result.evidence.changedFiles].sort().join('\u0000') ===
      [...(task.evidence?.changedFiles ?? [])].sort().join('\u0000'),
  );
  if (!verifierActor ||
      !verifierActor.purposes.includes('INDEPENDENT_VERIFICATION') ||
      verifierActor.workerRole !== task.owner ||
      !verifierActor.claimNonce?.trim() ||
      implementations.length !== 1) {
    throw new BadRequestException({
      code: 'independent_verifier_identity_required',
    });
  }
  const implementationActor = implementations[0].assignment.bootstrapActor!;
  if (!implementationActor.purposes.includes('IMPLEMENTATION') ||
      implementationActor.workerRole !== task.owner ||
      !implementationActor.claimNonce?.trim() ||
      verifierActor.principalId === implementationActor.principalId ||
      verifierActor.controllingPrincipalId === implementationActor.controllingPrincipalId ||
      verifierActor.kid === implementationActor.kid) {
    throw new BadRequestException({
      code: 'independent_verifier_principal_separation_required',
    });
  }
  const verifierEvidence = verified.result!.evidence;
  const reviewed = task.evidence?.reviewCandidate;
  const taskFiles = [...(task.evidence?.changedFiles ?? [])].sort();
  const verifiedFiles = [...verifierEvidence.changedFiles].sort();
  if (
    Boolean(reviewed) !== Boolean(verifierEvidence.reviewCandidate) ||
    (reviewed &&
      verifierEvidence.reviewCandidate &&
      !sameCandidate(reviewed, verifierEvidence.reviewCandidate)) ||
    taskFiles.length !== verifiedFiles.length ||
    taskFiles.some((path, index) => path !== verifiedFiles[index])
  ) {
    throw new BadRequestException({
      code: 'independent_verification_candidate_mismatch',
    });
  }
}
