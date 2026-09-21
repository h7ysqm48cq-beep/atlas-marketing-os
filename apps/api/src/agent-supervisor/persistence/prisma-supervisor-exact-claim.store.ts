import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { SupervisorExecution, WorkerExecutionResult } from '../execution/supervisor-execution.types';
import type { AuthenticatedBootstrapActor } from '../worker/supervisor-bootstrap-actor-registry';
import type { ActorPurpose, TrustedActorRegistry } from '../verification/actor-provenance';
import {
  issueWorkerExactClaimOffer, verifyWorkerExactClaimOffer, offerDigest,
  type WorkerExactClaimOffer,
} from '../verification/worker-exact-claim-offer';
import type { SignedWorkerPreclaimProof, WorkerPreclaimChallenge } from '../verification/worker-preclaim-proof';
import type { ActorSignature, SignedClaimBinding, SignedCompletionBinding } from '../verification/signed-execution-attestation';
import { verifySignedExecutionCompletion } from '../verification/worker-signed-completion';
import { verifySignedWorkerHeartbeat, SIGNED_HEARTBEAT_LEASE_MS, type SignedHeartbeatBinding } from '../verification/worker-signed-heartbeat';
import { verifySignedWorkerTerminal, type SignedTerminalBinding } from '../verification/worker-signed-terminal';
import { mapExecutionRecord, mapTaskRecord } from './supervisor-persistence.mapper';

/**
 * Opt-in signed store, wired ONLY to signed worker routes. Requires
 * separately governed proof/challenge schema, guard-authenticated actor,
 * and real workload-held Ed25519 signer. No legacy claimNext fallback.
 */
export class PrismaSupervisorExactClaimStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trustedKeys: TrustedActorRegistry,
  ) {}

  private deny(): never {
    throw new ForbiddenException('worker_exact_claim_offer_required');
  }

  private async taskInUtc(
    tx: Prisma.TransactionClient,
    taskId: string,
  ) {
    const row = await tx.supervisorTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    // Existing SupervisorTask.updatedAt is timestamp WITHOUT time zone.
    // PrismaPg on MYT can shift Date values; preserve UTC wall time explicitly.
    const versions = await tx.$queryRawUnsafe<Array<{ utc: string }>>(
      'SELECT to_char("updatedAt",' +
      " 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS \"utc\"" +
      ' FROM "SupervisorTask" WHERE "id"=$1',
      taskId,
    );
    if (versions.length !== 1) this.deny();
    return {
      ...mapTaskRecord(row),
      updatedAt: new Date(versions[0].utc),
    };
  }

  /**
   * Read-only queue discovery for independently authenticated signed workers.
   * This does NOT reserve a task; issueOffer and claimOffer separately verify
   * exact task/assignment/version under their own DB transactions.
   */
  async nextQueued(input: {
    actor: AuthenticatedBootstrapActor;
    purpose: ActorPurpose;
  }): Promise<{ executionId: string } | null> {
    try {
      const { actor, purpose } = input;
      const key = this.trustedKeys.resolve(actor.kid);
      if (!key || key.status !== 'ACTIVE' ||
          key.principalId !== actor.principalId ||
          key.controllingPrincipalId !== actor.controllingPrincipalId ||
          !key.permittedPurposes.includes(purpose) ||
          !actor.purposes.includes(purpose) ||
          (purpose !== 'IMPLEMENTATION' &&
           purpose !== 'INDEPENDENT_VERIFICATION')) this.deny();
      const requiredStatus = purpose === 'IMPLEMENTATION'
        ? 'WORKING' : 'VERIFYING';
      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        "SELECT e.\"id\" FROM \"SupervisorExecution\" e\nJOIN \"SupervisorTask\" t ON t.\"id\"=e.\"taskId\"\nWHERE e.\"status\"='QUEUED' AND t.\"status\"=$1\nAND t.\"owner\"=$2 AND e.\"workerRole\"=$2\nAND COALESCE(e.\"assignment\"->>'executionPurpose','IMPLEMENTATION')=$3\nAND e.\"assignment\"->>'frozenBaseSha' ~ '^[0-9a-fA-F]{40}$'\nAND e.\"assignment\"->>'manifestHash' ~ '^[0-9a-fA-F]{64}$'\nORDER BY e.\"createdAt\",e.\"id\" LIMIT 1",
        requiredStatus, actor.workerRole, purpose,
      );
      return rows[0] ? { executionId: rows[0].id } : null;
    } catch {
      this.deny();
    }
  }

  /** Offer creation does not make an execution RUNNING. */
  async issueOffer(input: {
    actor: AuthenticatedBootstrapActor;
    executionId: string;
    purpose: ActorPurpose;
    now?: Date;
  }): Promise<WorkerExactClaimOffer> {
    try {
      const actor = input.actor;
      const key = this.trustedKeys.resolve(actor.kid);
      if (!key || key.status !== 'ACTIVE' ||
          key.principalId !== actor.principalId ||
          key.controllingPrincipalId !== actor.controllingPrincipalId ||
          !key.permittedPurposes.includes(input.purpose)) this.deny();
      return await this.prisma.$transaction(async tx => {
        const executionRow = await tx.supervisorExecution.findUniqueOrThrow({
          where: { id: input.executionId },
        });
        const execution = mapExecutionRecord(executionRow);
        const task = await this.taskInUtc(tx, execution.taskId);
        const expected = issueWorkerExactClaimOffer({
          actor, task, execution, purpose: input.purpose,
          runnerId: randomUUID(), leaseId: randomUUID(),
          now: input.now ?? new Date(),
        });
        await tx.$executeRawUnsafe([
          'INSERT INTO "SupervisorActorPreclaimChallenge"',
          '("id","nonce","kid","workerRole","purpose","issuedAt","expiresAt",',
          '"offeredExecutionId","offerBinding","offerAssignment",',
          '"taskUpdatedAt","offerAssignmentDigest")',
          'VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,',
          "$8,$9::jsonb,$10::jsonb,($11::timestamptz AT TIME ZONE 'UTC'),$12)",
        ].join(' '),
        expected.challenge.id, expected.challenge.nonce,
        expected.challenge.kid, expected.challenge.workerRole,
        expected.challenge.purpose, expected.challenge.issuedAt,
        expected.challenge.expiresAt, execution.id,
        JSON.stringify(expected.claimBinding),
        JSON.stringify(execution.assignment),
        expected.taskUpdatedAt, expected.assignmentSnapshotDigest);
        if (input.purpose === 'INDEPENDENT_VERIFICATION') {
          const reviewCandidate = task.evidence?.reviewCandidate;
          const publication = task.evidence?.candidatePublication;
          if (!reviewCandidate || !publication ||
              reviewCandidate.baseSha !== expected.claimBinding.frozenBaseSha ||
              publication.taskId !== task.id ||
              publication.remoteVerified !== true ||
              publication.targetBranch !== 'production/atlas' ||
              publication.baseSha !== reviewCandidate.baseSha ||
              publication.headSha !== reviewCandidate.headSha ||
              publication.remoteHeadSha !== reviewCandidate.headSha ||
              publication.candidateBranch !==
                'atlas/candidate/' + task.id + '/' + publication.executionId) {
            this.deny();
          }
          return { ...expected, reviewCandidate,
            candidateBranch: publication.candidateBranch };
        }
        return expected;
      }, { timeout: 15000 });
    } catch {
      this.deny();
    }
  }

  /**
   * Load server-persisted offer and exact execution under DB locks, verify
   * BOTH worker-signed domains, CAS-consume, RUNNING, append proof together.
   * No production endpoint currently invokes this opt-in method.
   */
  async claimOffer(input: {
    actor: AuthenticatedBootstrapActor;
    challengeId: string;
    preclaimProof: SignedWorkerPreclaimProof;
    claimProof: ActorSignature<SignedClaimBinding>;
    now?: Date;
  }): Promise<SupervisorExecution> {
    try {
      return await this.prisma.$transaction(async tx => {
        const offers = await tx.$queryRawUnsafe<Array<{
          id: string; nonce: string; kid: string; workerRole: string;
          purpose: string; issuedAtIso: string; expiresAtIso: string;
          taskUpdatedAtIso: string; offeredExecutionId: string;
          offerBinding: SignedClaimBinding;
          offerAssignment: SupervisorExecution['assignment'];
          offerAssignmentDigest: string;
        }>>([
          'SELECT "id","nonce","kid","workerRole","purpose",',
          'to_char("issuedAt" AT TIME ZONE ' +
            "'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS \"issuedAtIso\",",
          'to_char("expiresAt" AT TIME ZONE ' +
            "'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS \"expiresAtIso\",",
          'to_char("taskUpdatedAt",' +
            "'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS \"taskUpdatedAtIso\",",
          '"offeredExecutionId","offerBinding","offerAssignment",',
          '"offerAssignmentDigest" FROM "SupervisorActorPreclaimChallenge"',
          'WHERE "id"=$1 FOR UPDATE',
        ].join(' '), input.challengeId);
        if (offers.length !== 1) this.deny();
        const saved = offers[0];
        const expected: WorkerExactClaimOffer = {
          challenge: {
            id: saved.id, nonce: saved.nonce, kid: saved.kid,
            workerRole: saved.workerRole as WorkerPreclaimChallenge['workerRole'],
            purpose: saved.purpose as WorkerPreclaimChallenge['purpose'],
            issuedAt: saved.issuedAtIso,
            expiresAt: saved.expiresAtIso,
          },
          claimBinding: saved.offerBinding,
          assignmentSnapshotDigest: saved.offerAssignmentDigest,
          taskUpdatedAt: saved.taskUpdatedAtIso,
        };
        const taskId = expected.claimBinding.taskId;
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "SupervisorTask" WHERE "id"=$1 FOR UPDATE',
          taskId,
        );
        const task = await this.taskInUtc(tx, taskId);
        const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "SupervisorExecution" WHERE "id"=$1 FOR UPDATE',
          saved.offeredExecutionId,
        );
        if (locked.length !== 1) this.deny();
        const before = mapExecutionRecord(
          await tx.supervisorExecution.findUniqueOrThrow({
            where: { id: saved.offeredExecutionId },
          }),
        );
        verifyWorkerExactClaimOffer({
          actor: input.actor, expected, task, execution: before,
          preclaimProof: input.preclaimProof,
          claimProof: input.claimProof,
          registry: this.trustedKeys, now: input.now ?? new Date(),
        });
        const reserved = await tx.$queryRawUnsafe<Array<{ id: string }>>([
          'UPDATE "SupervisorActorPreclaimChallenge"',
          'SET "consumedAt"=clock_timestamp(),"executionId"=$1',
          'WHERE "id"=$2 AND "offeredExecutionId"=$1',
          'AND "kid"=$3 AND "nonce"=$4 AND "consumedAt" IS NULL',
          'AND "expiresAt">clock_timestamp() RETURNING "id"',
        ].join(' '), saved.offeredExecutionId,
        saved.id, input.actor.kid, saved.nonce);
        if (reserved.length !== 1) this.deny();
        const binding = expected.claimBinding;
        const actor = input.actor;
        const assignment = {
          ...before.assignment,
          claimEpoch: binding.claimEpoch,
          runnerId: binding.runnerId,
          leaseId: binding.leaseId,
          bootstrapActor: {
            ...actor,
            claimNonce: binding.claimNonce,
            authenticatedAt: binding.authenticatedAt,
          },
        };
        delete assignment.workerCapability;
        const now = input.now ?? new Date();
        const updated = await tx.supervisorExecution.update({
          where: { id: before.id, status: 'QUEUED',
            claimEpoch: before.claimEpoch },
          data: {
            status: 'RUNNING', claimEpoch: binding.claimEpoch,
            runnerId: binding.runnerId, startedAt: now,
            lastHeartbeatAt: now,
            leaseExpiresAt: new Date(now.getTime() + 60_000),
            assignment: JSON.parse(JSON.stringify(assignment)) as Prisma.InputJsonValue,
            result: Prisma.DbNull,
            completedAt: null, error: null,
          },
        });
        const stored = {
          ...input.claimProof,
          preclaimChallengeId: expected.challenge.id,
          preclaimSignature: input.preclaimProof.signature,
        };
        await tx.$executeRawUnsafe([
          'INSERT INTO "SupervisorActorClaimProof"',
          '("executionId","taskId","claimEpoch","claimNonce",',
          '"kid","proof","proofDigest")',
          'VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',
        ].join(' '), before.id, taskId, binding.claimEpoch,
        binding.claimNonce, actor.kid, JSON.stringify(stored),
        offerDigest(input.claimProof));
        return mapExecutionRecord(updated);
      }, { timeout: 15000 });
    } catch {
      this.deny();
    }
  }

  /**
   * Opt-in signed completion. No controller/dispatcher is wired here. The
   * ORIGINAL claim must come from the append-only proof table, not from a
   * request body; final result and completion signature commit atomically.
   */
  async completeSigned(input: {
    actor: AuthenticatedBootstrapActor;
    executionId: string;
    result: WorkerExecutionResult;
    completionProof: ActorSignature<SignedCompletionBinding>;
  }): Promise<SupervisorExecution> {
    try {
      return await this.prisma.$transaction(async tx => {
        const executionRow = await tx.supervisorExecution.findUniqueOrThrow({
          where: { id: input.executionId },
        });
        const taskId = executionRow.taskId;
        const taskLocks = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "SupervisorTask" WHERE "id"=$1 FOR UPDATE',
          taskId,
        );
        if (taskLocks.length !== 1) this.deny();
        const task = await this.taskInUtc(tx, taskId);
        const executionLocks = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "SupervisorExecution" WHERE "id"=$1 FOR UPDATE',
          input.executionId,
        );
        if (executionLocks.length !== 1) this.deny();
        // A valid signature does not revive an expired worker. The DB clock
        // is authoritative and these columns are TIMESTAMP WITHOUT TIME ZONE.
        const liveLease = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "SupervisorExecution" WHERE "id"=$1' +
          ' AND "status"=\'RUNNING\'' +
          ' AND "leaseExpiresAt">(clock_timestamp() AT TIME ZONE \'UTC\')',
          input.executionId,
        );
        if (liveLease.length !== 1) this.deny();
        const before = mapExecutionRecord(
          await tx.supervisorExecution.findUniqueOrThrow({
            where: { id: input.executionId },
          }),
        );
        const claims = await tx.$queryRawUnsafe<Array<{
          proof: unknown;
          proofDigest: string;
          claimEpoch: number;
          taskId: string;
          kid: string;
          claimNonce: string;
        }>>([
          'SELECT "proof","proofDigest","claimEpoch",',
          '"taskId","kid","claimNonce" FROM "SupervisorActorClaimProof"',
          // Immutable proof table is SELECT/INSERT only for the app role.
          'WHERE "executionId"=$1',
        ].join(' '), input.executionId);
        if (claims.length !== 1) this.deny();
        const now = new Date();
        const verified = verifySignedExecutionCompletion({
          actor: input.actor, task, execution: before,
          result: input.result,
          completedAt: input.completionProof?.binding?.completedAt,
          completionProof: input.completionProof,
          claimRow: claims[0], registry: this.trustedKeys,
          now,
        });
        const completed = new Date(input.completionProof.binding.completedAt);
        const updated = await tx.supervisorExecution.update({
          where: { id: before.id, status: 'RUNNING',
            claimEpoch: before.claimEpoch,
            runnerId: before.runnerId! },
          data: {
            status: 'COMPLETED', completedAt: completed,
            result: JSON.parse(JSON.stringify(input.result)) as Prisma.InputJsonValue,
            error: null, lastHeartbeatAt: now,
          },
        });
        await tx.$executeRawUnsafe([
          'INSERT INTO "SupervisorActorCompletionProof"',
          '("executionId","taskId","claimEpoch",',
          '"claimProofDigest","kid","proof")',
          'VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
        ].join(' '), before.id, taskId, verified.claimEpoch,
        verified.claimDigest, input.actor.kid,
        JSON.stringify(verified.completion));
        return mapExecutionRecord(updated);
      }, { timeout: 15000 });
    } catch {
      this.deny();
    }
  }


  /** A signed FAILED/CANCELLED is terminal but NEVER READY evidence. */
  async terminateSigned(input: {
    actor: AuthenticatedBootstrapActor;
    executionId: string;
    proof: ActorSignature<SignedTerminalBinding>;
  }): Promise<SupervisorExecution> {
    try {
      return await this.prisma.$transaction(async tx => {
        const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "SupervisorExecution" WHERE "id"=$1 FOR UPDATE',
          input.executionId,
        );
        if (locked.length !== 1) this.deny();
        const before = mapExecutionRecord(
          await tx.supervisorExecution.findUniqueOrThrow({
            where: { id: input.executionId },
          }),
        );
        const claims = await tx.$queryRawUnsafe<Array<{
          kid: string; claimNonce: string; claimEpoch: number;
        }>>('SELECT "kid","claimNonce","claimEpoch" ' +
          'FROM "SupervisorActorClaimProof" WHERE "executionId"=$1',
          input.executionId);
        if (claims.length !== 1) this.deny();
        const stamps = await tx.$queryRawUnsafe<Array<{
          started: string | null; expires: string | null;
        }>>("SELECT to_char(\"startedAt\",'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS \"started\", to_char(\"leaseExpiresAt\",'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS \"expires\" FROM \"SupervisorExecution\" WHERE \"id\"=$1", input.executionId);
        if (stamps.length !== 1 || !stamps[0].started ||
            !stamps[0].expires) this.deny();
        before.startedAt = new Date(stamps[0].started);
        before.leaseExpiresAt = new Date(stamps[0].expires);
        const now = new Date();
        const verified = verifySignedWorkerTerminal({
          actor: input.actor, execution: before,
          claimRow: claims[0], registry: this.trustedKeys,
          proof: input.proof, now,
        });
        const changed = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          "UPDATE \"SupervisorExecution\" SET \"status\"=$1, \"error\"=$2, \"completedAt\"=($3::timestamptz AT TIME ZONE 'UTC') WHERE \"id\"=$4 AND \"status\"='RUNNING' AND \"claimEpoch\"=$5 AND \"runnerId\"=$6 AND \"leaseExpiresAt\">(clock_timestamp() AT TIME ZONE 'UTC') RETURNING \"id\"", verified.status,
          verified.reason.trim(), now.toISOString(), before.id,
          before.claimEpoch, before.runnerId,
        );
        if (changed.length !== 1) this.deny();
        return mapExecutionRecord(
          await tx.supervisorExecution.findUniqueOrThrow({
            where: { id: before.id },
          }),
        );
      }, { timeout: 15000 });
    } catch {
      this.deny();
    }
  }

  /**
   * Opt-in long-running worker lease renewal. The same registered signing
   * key signs execution+epoch+runner+lease+claim nonce+increasing timestamp.
   * A replay or competing epoch cannot renew a lease in the DB CAS.
   */
  async heartbeatSigned(input: {
    actor: AuthenticatedBootstrapActor;
    executionId: string;
    proof: ActorSignature<SignedHeartbeatBinding>;
  }): Promise<SupervisorExecution> {
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "SupervisorExecution" WHERE "id"=$1 FOR UPDATE',
          input.executionId,
        );
        const row = await tx.supervisorExecution.findUniqueOrThrow({
          where: { id: input.executionId },
        });
        const execution = mapExecutionRecord(row);
        const claims = await tx.$queryRawUnsafe<Array<{
          kid: string; claimNonce: string; claimEpoch: number;
        }>>([
          'SELECT "kid","claimNonce","claimEpoch"',
          // Execution is already locked; ledger rows are insert-only.
          'FROM "SupervisorActorClaimProof" WHERE "executionId"=$1',
        ].join(' '), input.executionId);
        if (claims.length !== 1) this.deny();
        // PrismaPg raw Date decoding under MYT can shift TIMESTAMP values;
        // read UTC wall timestamps explicitly, not as timestamptz.
        const stamps = await tx.$queryRawUnsafe<Array<{
          started: string | null; last: string | null;
          expires: string | null;
        }>>("SELECT to_char(\"startedAt\",'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS \"started\", to_char(\"lastHeartbeatAt\",'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS \"last\", to_char(\"leaseExpiresAt\",'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS \"expires\" FROM \"SupervisorExecution\" WHERE \"id\"=$1", input.executionId);
        if (stamps.length !== 1 || !stamps[0].started ||
            !stamps[0].last || !stamps[0].expires) this.deny();
        execution.startedAt = new Date(stamps[0].started);
        execution.lastHeartbeatAt = new Date(stamps[0].last);
        execution.leaseExpiresAt = new Date(stamps[0].expires);
        const issuedAt = verifySignedWorkerHeartbeat({
          actor: input.actor, execution, claimRow: claims[0],
          registry: this.trustedKeys, proof: input.proof,
          now: new Date(),
        });
        const updated = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          "UPDATE \"SupervisorExecution\" SET \"lastHeartbeatAt\"=($1::timestamptz AT TIME ZONE 'UTC'), \"leaseExpiresAt\"=(($1::timestamptz + interval '60 seconds') AT TIME ZONE 'UTC') WHERE \"id\"=$2 AND \"status\"='RUNNING' AND \"claimEpoch\"=$3 AND \"runnerId\"=$4 AND \"lastHeartbeatAt\"<($1::timestamptz AT TIME ZONE 'UTC') AND \"leaseExpiresAt\">(clock_timestamp() AT TIME ZONE 'UTC') RETURNING \"id\"", issuedAt.toISOString(), input.executionId,
          execution.claimEpoch, execution.runnerId);
        if (updated.length !== 1) this.deny();
        return { ...execution, lastHeartbeatAt: issuedAt,
          leaseExpiresAt: new Date(issuedAt.getTime() +
            SIGNED_HEARTBEAT_LEASE_MS),
        };
      }, { timeout: 15000 });
    } catch {
      this.deny();
    }
  }

}
