import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { TrustedActorRegistry } from '../verification/actor-provenance';
import {
  requireCompletedIndependentVerification,
} from '../verification/independent-verification-ready';
import {
  requireSignedIndependentExecutionPair, requireSignedActorExecution,
  type ActorSignature, type SignedClaimBinding,
  type SignedCompletionBinding,
} from '../verification/signed-execution-attestation';
import { offerDigest } from '../verification/worker-exact-claim-offer';
import type { TrustedCandidatePublicationVerifier } from '../verification/github-candidate-publication-verifier';
import { mapExecutionRecord, mapTaskRecord } from './supervisor-persistence.mapper';

/**
 * Opt-in signed READY gate wired only to guarded signed system routes.
 * BOTH attestations are loaded from insert-only ledger rows WITHIN the same
 * transaction that checks task version and releases task file locks.
 * Legacy lifecycle never invokes this proof gate.
 */
export class PrismaSupervisorSignedReviewStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: TrustedActorRegistry,
    private readonly publicationVerifier?: TrustedCandidatePublicationVerifier,
  ) {}
  private deny(): never {
    throw new ForbiddenException('signed_independent_review_required');
  }

  private async attestations(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    execution: SupervisorExecution,
  ) {
    const claims = await tx.$queryRawUnsafe<Array<{
      taskId: string; kid: string; claimEpoch: number;
      claimNonce: string; proofDigest: string;
      proof: { kid: string; binding: SignedClaimBinding;
        signature: string; preclaimChallengeId?: string;
        preclaimSignature?: string };
    }>>([
      'SELECT "taskId","kid","claimEpoch","claimNonce",',
      '"proofDigest","proof" FROM "SupervisorActorClaimProof"',
      // SELECT-only proof rows: task/execution locks + owner-separated
      // append-only ledger establish immutable evidence without UPDATE GRANT.
      'WHERE "executionId"=$1',
    ].join(' '), execution.id);
    const completions = await tx.$queryRawUnsafe<Array<{
      taskId: string; kid: string; claimEpoch: number;
      claimProofDigest: string;
      proof: ActorSignature<SignedCompletionBinding>;
    }>>([
      'SELECT "taskId","kid","claimEpoch","claimProofDigest","proof"',
      'FROM "SupervisorActorCompletionProof"',
      // SELECT-only proof rows: task/execution locks + owner-separated
      // append-only ledger establish immutable evidence without UPDATE GRANT.
      'WHERE "executionId"=$1',
    ].join(' '), execution.id);
    if (claims.length !== 1 || completions.length !== 1) this.deny();
    const claim = claims[0];
    const completion = completions[0];
    if (!claim.proof || !completion.proof ||
        typeof claim.proof.preclaimChallengeId !== 'string' ||
        !claim.proof.preclaimChallengeId.trim() ||
        typeof claim.proof.preclaimSignature !== 'string' ||
        !claim.proof.preclaimSignature.trim() ||
        claim.taskId !== execution.taskId ||
        completion.taskId !== execution.taskId ||
        claim.claimEpoch !== execution.claimEpoch ||
        completion.claimEpoch !== execution.claimEpoch ||
        claim.kid !== completion.kid ||
        claim.kid !== execution.assignment.bootstrapActor?.kid ||
        claim.claimNonce !== execution.assignment.bootstrapActor?.claimNonce) {
      this.deny();
    }
    const original: ActorSignature<SignedClaimBinding> = {
      kid: claim.proof.kid,
      binding: claim.proof.binding,
      signature: claim.proof.signature,
    };
    const digest = offerDigest(original);
    if (claim.proofDigest !== digest ||
        completion.claimProofDigest !== digest) this.deny();
    return { claim: original, completion: completion.proof };
  }

  async currentTaskVersion(taskId: string): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ utc: string }>>(
      'SELECT to_char("updatedAt",' +
      " 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS \"utc\"" +
      ' FROM "SupervisorTask" WHERE "id"=$1', taskId,
    );
    if (rows.length !== 1 || !rows[0].utc) this.deny();
    return rows[0].utc;
  }

  /** Control-plane preflight: no task mutation, no owner elevation. */
  async assertCompletedImplementation(input: {
    taskId: string; executionId: string;
  }): Promise<void> {
    try {
      await this.prisma.$transaction(async tx => {
        const taskLock = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "SupervisorTask" WHERE "id"=$1 FOR UPDATE',
          input.taskId,
        );
        if (taskLock.length !== 1) this.deny();
        const task = mapTaskRecord(
          await tx.supervisorTask.findUniqueOrThrow({
            where: { id: input.taskId },
          }),
        );
        const execLock = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "SupervisorExecution" WHERE "id"=$1 FOR UPDATE',
          input.executionId,
        );
        if (execLock.length !== 1) this.deny();
        const execution = mapExecutionRecord(
          await tx.supervisorExecution.findUniqueOrThrow({
            where: { id: input.executionId },
          }),
        );
        const candidate = execution.result?.evidence.reviewCandidate;
        const receipt = execution.result?.evidence.candidatePublication;
        const sameFiles = (a: string[], b: string[]) =>
          a.length === b.length &&
          [...a].sort().join('\0') === [...b].sort().join('\0');
        if (task.status !== 'WORKING' || task.evidence !== null ||
            execution.taskId !== task.id ||
            execution.status !== 'COMPLETED' ||
            execution.assignment.executionPurpose !== 'IMPLEMENTATION' ||
            !candidate || !receipt ||
            candidate.targetBranch !== 'production/atlas' ||
            receipt.remoteVerified !== true ||
            receipt.taskId !== task.id ||
            receipt.executionId !== execution.id ||
            receipt.baseSha !== candidate.baseSha ||
            receipt.headSha !== candidate.headSha ||
            receipt.remoteHeadSha !== candidate.headSha ||
            receipt.candidateBranch !==
              'atlas/candidate/' + task.id + '/' + execution.id ||
            !candidate.changedFiles.length ||
            candidate.changedFiles.some(path =>
              !task.allowedPaths.includes(path)) ||
            !sameFiles(receipt.changedFiles, candidate.changedFiles) ||
            !sameFiles(execution.result!.evidence.changedFiles,
              candidate.changedFiles)) this.deny();
        const proofs = await this.attestations(tx, execution);
        requireSignedActorExecution({
          execution, purpose: 'IMPLEMENTATION', candidate,
          attestation: proofs, registry: this.registry,
        });
        if (!this.publicationVerifier) this.deny();
        await this.publicationVerifier.assertPublished({
          taskId: task.id, implementationId: execution.id,
          candidate, receipt,
        });
      }, { timeout: 15000 });
    } catch {
      this.deny();
    }
  }

  /**
   * The caller passes ONLY id and previously observed version; current
   * evidence, executions, receipts, and both immutable proofs are DB-loaded.
   */
  async releaseReady(input: {
    taskId: string;
    expectedTaskVersion: string;
  }): Promise<SupervisorTask> {
    try {
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(
        input.expectedTaskVersion,
      ) || !input.expectedTaskVersion.endsWith('Z')) this.deny();
      return await this.prisma.$transaction(async tx => {
        const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "SupervisorTask" WHERE "id"=$1 FOR UPDATE',
          input.taskId,
        );
        if (locked.length !== 1) this.deny();
        const row = await tx.supervisorTask.findUniqueOrThrow({
          where: { id: input.taskId },
        });
        const versions = await tx.$queryRawUnsafe<Array<{ utc: string }>>(
          'SELECT to_char("updatedAt",' +
          " 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS \"utc\"" +
          ' FROM "SupervisorTask" WHERE "id"=$1',
          input.taskId,
        );
        if (versions.length !== 1 || row.status !== 'VERIFYING' ||
            versions[0].utc !== input.expectedTaskVersion) this.deny();
        const task = {
          ...mapTaskRecord(row),
          updatedAt: new Date(versions[0].utc),
        };
        const candidate = task.evidence?.reviewCandidate;
        const receipt = task.evidence?.candidatePublication;
        if (!candidate || !receipt || receipt.remoteVerified !== true ||
            receipt.taskId !== task.id ||
            receipt.remoteHeadSha !== candidate.headSha ||
            receipt.headSha !== candidate.headSha ||
            receipt.baseSha !== candidate.baseSha ||
            receipt.targetBranch !== candidate.targetBranch ||
            receipt.changedFiles.length !== candidate.changedFiles.length ||
            [...receipt.changedFiles].sort().join('\u0000') !==
              [...candidate.changedFiles].sort().join('\u0000')) this.deny();

        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "SupervisorExecution"' +
          ' WHERE "taskId"=$1 ORDER BY "createdAt","id" FOR UPDATE',
          task.id,
        );
        const executions = (await tx.supervisorExecution.findMany({
          where: { taskId: task.id }, orderBy: { createdAt: 'asc' },
        })).map(mapExecutionRecord);
        requireCompletedIndependentVerification(task, executions);
        const implementation = executions.filter(exec =>
          (exec.assignment.executionPurpose ?? 'IMPLEMENTATION') ===
            'IMPLEMENTATION' && exec.status === 'COMPLETED',
        );
        const verifier = executions.filter(exec =>
          exec.assignment.executionPurpose ===
            'INDEPENDENT_VERIFICATION' && exec.status === 'COMPLETED',
        );
        if (implementation.length !== 1 || verifier.length !== 1 ||
            receipt.executionId !== implementation[0].id) this.deny();
        const first = await this.attestations(tx, implementation[0]);
        const second = await this.attestations(tx, verifier[0]);
        requireSignedIndependentExecutionPair({
          task, implementation: implementation[0], verifier: verifier[0],
          implementationAttestation: first, verifierAttestation: second,
          registry: this.registry,
        });
        if (!this.publicationVerifier) this.deny();
        await this.publicationVerifier.assertPublished({
          taskId: task.id,
          implementationId: implementation[0].id,
          candidate, receipt,
        });
        const locks = await tx.$queryRawUnsafe<Array<{ path: string }>>(
          'SELECT "path" FROM "SupervisorFileLock"' +
          ' WHERE "taskId"=$1 ORDER BY "path" FOR UPDATE',
          task.id,
        );
        const expected = [...new Set(task.allowedPaths)].sort();
        if (!expected.length || locks.length !== expected.length ||
            locks.some((lock, i) => lock.path !== expected[i])) this.deny();
        const changed = await tx.$queryRawUnsafe<Array<{ id: string }>>([
          'UPDATE "SupervisorTask" SET "status"=\'READY_FOR_REVIEW\',',
          '"updatedAt"=(clock_timestamp() AT TIME ZONE \'UTC\')',
          'WHERE "id"=$1 AND "status"=\'VERIFYING\' AND',
          '"updatedAt"=($2::timestamptz AT TIME ZONE \'UTC\')',
          'RETURNING "id"',
        ].join(' '), task.id, versions[0].utc);
        if (changed.length !== 1) this.deny();
        await tx.supervisorFileLock.deleteMany({
          where: { taskId: task.id },
        });
        const result = await tx.supervisorTask.findUniqueOrThrow({
          where: { id: task.id },
        });
        return mapTaskRecord(result);
      }, { timeout: 15000 });
    } catch {
      this.deny();
    }
  }
}
