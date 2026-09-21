import { createHash, createPrivateKey, sign } from 'node:crypto';
import type {
  ClaimedExecutionSession, ExecutionPurpose, WorkerAssignment,
  WorkerExecutionResult, WorkerReviewCandidate,
} from './types.ts';
import { AmbiguousSupervisorMutationError } from './supervisor-client.ts';

type FetchLike = (
  input: string | URL | Request, init?: RequestInit,
) => Promise<Response>;

interface Challenge {
  id: string; nonce: string; kid: string; workerRole: string;
  purpose: ExecutionPurpose; issuedAt: string; expiresAt: string;
}
interface ClaimBinding {
  taskId: string; executionId: string; purpose: ExecutionPurpose;
  manifestHash: string; claimEpoch: number; runnerId: string;
  leaseId: string; claimNonce: string; authenticatedAt: string;
  frozenBaseSha: string;
}
interface ExactOffer {
  challenge: Challenge;
  claimBinding: ClaimBinding;
  reviewCandidate?: WorkerReviewCandidate;
  candidateBranch?: string;
}
interface ExecutionResponse {
  id: string; status: string; assignment: WorkerAssignment;
}
interface ActorSignature<T> {
  kid: string; binding: T; signature: string;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map(key =>
    JSON.stringify(key) + ':' + canonical(record[key]),
  ).join(',') + '}';
}
function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
function assertCandidate(value: WorkerReviewCandidate | undefined,
  base: string): WorkerReviewCandidate {
  if (!value || value.action !== 'merge' ||
      value.targetBranch !== 'production/atlas' ||
      value.baseSha !== base ||
      !/^[0-9a-f]{40}$/i.test(value.headSha) ||
      !Array.isArray(value.changedFiles) ||
      value.changedFiles.length === 0 ||
      value.changedFiles.some(file =>
        typeof file !== 'string' || !file.trim()) ||
      new Set(value.changedFiles).size !== value.changedFiles.length) {
    throw new Error('signed_completion_candidate_required');
  }
  return { ...value, changedFiles: [...value.changedFiles].sort() };
}
function assertBinding(value: ClaimBinding, executionId: string,
  purpose: ExecutionPurpose): void {
  if (!value || value.executionId !== executionId ||
      value.purpose !== purpose || !value.taskId ||
      !/^[a-f0-9]{64}$/i.test(value.manifestHash) ||
      !/^[a-f0-9]{40}$/i.test(value.frozenBaseSha) ||
      !Number.isInteger(value.claimEpoch) || value.claimEpoch < 1 ||
      !value.runnerId || !value.leaseId || !value.claimNonce ||
      !value.authenticatedAt) {
    throw new Error('signed_offer_binding_invalid');
  }
}
function assertClaim(execution: ExecutionResponse,
  expected: ClaimBinding): asserts execution is ExecutionResponse {
  const assignment = execution?.assignment;
  if (!assignment || execution.status !== 'RUNNING' ||
      execution.id !== expected.executionId ||
      assignment.taskId !== expected.taskId ||
      assignment.executionId !== expected.executionId ||
      (assignment.executionPurpose ?? 'IMPLEMENTATION') !== expected.purpose ||
      assignment.claimEpoch !== expected.claimEpoch ||
      assignment.runnerId !== expected.runnerId ||
      assignment.leaseId !== expected.leaseId ||
      assignment.manifestHash !== expected.manifestHash ||
      assignment.frozenBaseSha !== expected.frozenBaseSha) {
    throw new Error('signed_claim_response_invalid');
  }
}
export interface SignedSupervisorClientOptions {
  baseUrl: string;
  actorBootstrapToken: string;
  signingKid: string;
  signingPrivateKeyPem: string;
  executionPurpose: ExecutionPurpose;
  fetch?: FetchLike;
}

/**
 * Workload-private-key transport. No legacy capability or claim-next fallback.
 * Failure/cancellation use a distinct Ed25519 terminal proof. Unknown
 * mutation outcomes (network, 5xx or malformed acknowledgements) remain
 * ambiguous: never replay a terminal write or fall back to legacy tokens.
 */
export class SignedSupervisorClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly kid: string;
  private readonly purpose: ExecutionPurpose;
  private readonly privateKey: ReturnType<typeof createPrivateKey>;
  private readonly fetcher: FetchLike;

  constructor(options: SignedSupervisorClientOptions) {
    if (!options.baseUrl || !options.actorBootstrapToken ||
        !options.signingKid ||
        (options.executionPurpose !== 'IMPLEMENTATION' &&
         options.executionPurpose !== 'INDEPENDENT_VERIFICATION')) {
      throw new Error('signed_runner_configuration_invalid');
    }
    try {
      this.privateKey = createPrivateKey(options.signingPrivateKeyPem);
      if (this.privateKey.asymmetricKeyType !== 'ed25519') {
        throw new Error('not_ed25519');
      }
    } catch {
      throw new Error('signed_runner_private_key_invalid');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.actorBootstrapToken;
    this.kid = options.signingKid;
    this.purpose = options.executionPurpose;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private signature<T>(domain: string, binding: T): ActorSignature<T> {
    const kid = this.kid;
    return { kid, binding, signature: sign(
      null, Buffer.from(canonical({ domain, kid, binding })),
      this.privateKey,
    ).toString('base64url') };
  }
  private async getNext(): Promise<string | null> {
    const response = await this.fetcher(
      this.baseUrl + '/engineering/supervisor/worker/signed/next?purpose=' +
        encodeURIComponent(this.purpose),
      { method: 'GET', headers: {
        authorization: 'Bearer ' + this.token,
      } },
    );
    if (response.status === 204) return null;
    if (!response.ok) {
      throw new Error('signed_queue_discovery_failed:' + response.status);
    }
    const value = await response.json() as
      { executionId?: unknown } | null;
    if (value === null) return null;
    if (!value || typeof value.executionId !== 'string' ||
        !value.executionId.trim()) {
      throw new Error('signed_queue_response_invalid');
    }
    return value.executionId;
  }
  private async post<T>(
    step: string, value: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(
        this.baseUrl + '/engineering/supervisor/worker/signed/' + step,
        { method: 'POST', headers: {
          authorization: 'Bearer ' + this.token,
          'content-type': 'application/json',
        }, body: JSON.stringify(value) },
      );
    } catch (error) {
      // A timeout after a claim or completion is ambiguous. Never retry it.
      throw new AmbiguousSupervisorMutationError('signed_' + step, error);
    }
    if (!response.ok) {
      if (response.status >= 500 || response.status === 408 ||
          response.status === 429) {
        // An upstream gateway may lose the response AFTER the DB committed.
        throw new AmbiguousSupervisorMutationError('signed_' + step);
      }
      throw new Error('signed_' + step + '_failed:' + response.status);
    }
    try {
      return await response.json() as T;
    } catch (error) {
      // A 2xx without a parseable receipt does NOT prove mutation failure.
      throw new AmbiguousSupervisorMutationError('signed_' + step, error);
    }
  }

  async claimNext(): Promise<ClaimedExecutionSession | null> {
    const executionId = await this.getNext();
    if (executionId === null) return null;
    const purpose = this.purpose;
    const offer = await this.post<ExactOffer>('offer', {
      executionId, purpose,
    });
    if (!offer?.challenge || offer.challenge.kid !== this.kid ||
        offer.challenge.purpose !== purpose ||
        offer.challenge.nonce !== offer.claimBinding?.claimNonce ||
        offer.challenge.issuedAt !== offer.claimBinding?.authenticatedAt) {
      throw new Error('signed_offer_challenge_invalid');
    }
    assertBinding(offer.claimBinding, executionId, purpose);
    const reviewerCandidate = purpose === 'INDEPENDENT_VERIFICATION'
      ? assertCandidate(offer.reviewCandidate,
          offer.claimBinding.frozenBaseSha) : undefined;
    const branch = offer.candidateBranch;
    if (reviewerCandidate &&
        (typeof branch !== 'string' ||
         !/^atlas\/candidate\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/.test(branch) ||
         !branch.startsWith('atlas/candidate/' +
           offer.claimBinding.taskId + '/'))) {
      throw new Error('signed_verifier_candidate_ref_invalid');
    }
    const preclaimProof = {
      kid: this.kid, challengeId: offer.challenge.id,
      signature: sign(null, Buffer.from(canonical({
        domain: 'atlas.actor.preclaim.v1',
        challenge: offer.challenge,
      })), this.privateKey).toString('base64url'),
    };
    const claimProof = this.signature(
      'atlas.actor.claim.v1', offer.claimBinding,
    );
    const execution = await this.post<ExecutionResponse>('claim', {
      challengeId: offer.challenge.id, preclaimProof, claimProof,
    });
    try {
      assertClaim(execution, offer.claimBinding);
    } catch (error) {
      throw new AmbiguousSupervisorMutationError('signed_claim', error);
    }
    const sessionAssignment: WorkerAssignment = reviewerCandidate
      ? { ...execution.assignment, reviewCandidate: reviewerCandidate,
          candidateBranch: branch }
      : execution.assignment;
    const claimProofDigest = digest(claimProof);
    const binding = offer.claimBinding;
    let lastIssuedAt = Date.parse(offer.challenge.issuedAt);
    let terminalRecorded = false;
    let heartbeatInFlight: Promise<unknown> | undefined;
    const heartbeat = async (): Promise<unknown> => {
      if (terminalRecorded) {
        throw new Error('signed_worker_already_terminal');
      }
      // A second tick joins the first request instead of sending a later
      // signed timestamp that may reach the strict anti-replay CAS first.
      if (heartbeatInFlight) return heartbeatInFlight;
      const pending = (async () => {
        lastIssuedAt = Math.max(Date.now(), lastIssuedAt + 1);
        const heartbeatBinding = {
          taskId: binding.taskId,
          executionId: binding.executionId,
          claimEpoch: binding.claimEpoch,
          runnerId: binding.runnerId, leaseId: binding.leaseId,
          claimNonce: binding.claimNonce,
          issuedAt: new Date(lastIssuedAt).toISOString(),
        };
        return this.post('heartbeat', {
          executionId, proof: this.signature(
            'atlas.actor.heartbeat.v1', heartbeatBinding),
        });
      })();
      heartbeatInFlight = pending;
      try {
        return await pending;
      } finally {
        if (heartbeatInFlight === pending) heartbeatInFlight = undefined;
      }
    };
    const complete = async (result: WorkerExecutionResult):
      Promise<unknown> => {
      if (terminalRecorded) {
        throw new Error('signed_worker_already_terminal');
      }
      // Do not race a final transition with a signed heartbeat in flight.
      if (heartbeatInFlight) await heartbeatInFlight;
      const candidate = assertCandidate(
        result?.evidence?.reviewCandidate ?? offer.reviewCandidate,
        binding.frozenBaseSha,
      );
      if (reviewerCandidate &&
          canonical(candidate) !== canonical(reviewerCandidate)) {
        throw new Error('signed_verifier_candidate_mismatch');
      }
      // READY validates persisted verifier evidence as well as Ed25519:
      // frozen candidate must appear in BOTH, not only the proof binding.
      // Hash EXACT JSON wire representation: JSON.stringify omits undefined
      // object values, while canonical(value) would encode their key.
      const submitted = JSON.parse(JSON.stringify(reviewerCandidate
        ? { ...result, evidence: { ...result.evidence,
            reviewCandidate: reviewerCandidate } }
        : result)) as WorkerExecutionResult;
      const completionBinding = {
        taskId: binding.taskId,
        executionId: binding.executionId,
        claimProofDigest, resultDigest: digest(submitted),
        completedAt: new Date().toISOString(),
        candidate,
      };
      const proof = this.signature(
        'atlas.actor.completion.v1', completionBinding);
      const response = await this.post<ExecutionResponse>('complete', {
        executionId, result: submitted, completionProof: proof,
      });
      if (response.status !== 'COMPLETED' ||
          response.id !== executionId) {
        throw new AmbiguousSupervisorMutationError('signed_complete');
      }
      terminalRecorded = true;
      return response;
    };
    const terminate = async (
      status: 'FAILED' | 'CANCELLED', reason: string,
    ): Promise<unknown> => {
      if (terminalRecorded) {
        throw new Error('signed_worker_already_terminal');
      }
      if (heartbeatInFlight) await heartbeatInFlight.catch(() => undefined);
      if (typeof reason !== 'string' || !reason.trim() ||
          reason.length > 1024) {
        throw new Error('signed_terminal_reason_invalid');
      }
      const terminalBinding = {
        taskId: binding.taskId, executionId: binding.executionId,
        claimEpoch: binding.claimEpoch,
        runnerId: binding.runnerId, leaseId: binding.leaseId,
        claimNonce: binding.claimNonce, status,
        reason: reason.trim(), issuedAt: new Date().toISOString(),
      };
      const response = await this.post<ExecutionResponse>('terminate', {
        executionId, proof: this.signature(
          'atlas.actor.terminal.v1', terminalBinding),
      });
      if (response.status !== status || response.id !== executionId) {
        throw new AmbiguousSupervisorMutationError('signed_terminate');
      }
      terminalRecorded = true;
      return response;
    };
    return Object.freeze({
      assignment: sessionAssignment,
      purpose,
      heartbeat, complete,
      fail: (reason: string) => terminate('FAILED', reason),
      cancel: (reason: string) => terminate('CANCELLED', reason),
    });
  }
}
