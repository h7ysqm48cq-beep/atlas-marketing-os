import type {
  AssignmentExecutor,
  CandidatePublicationReceipt,
  SupervisorClientLike,
  WorkspaceInspector,
} from './types.ts';
import { CandidateSourceRepository } from './candidate-source-repository.ts';


interface CandidateWorkspaceLeaseLike {
  path: string;
  baseSha: string;
  verifiedHeadSha?: string;
  verifiedChangedPaths?: string[];
  verifyProductionBaseline?: () => Promise<void>;
  workspace: WorkspaceInspector;
  cleanup(): Promise<void>;
}

interface CandidateWorkspaceManagerLike {
  prepare(input: {
    taskId: string;
    executionId: string;
    frozenBaseSha?: string;
    candidateBaseSha?: string;
    candidateHeadSha?: string;
    productionBaselineSha?: string;
    allowedPaths: string[];
  }): Promise<CandidateWorkspaceLeaseLike>;
}

interface CandidatePublisherLike {
  publish(input: {
    taskId: string;
    executionId: string;
    executionPurpose: 'IMPLEMENTATION';
    workspace: string;
    frozenBaseSha: string;
    targetBranch: 'production/atlas';
    changedFiles: string[];
  }): Promise<CandidatePublicationReceipt>;
}

interface ScopeGuardLike {
  assertImplementationScope(changed: string[], allowed: string[]): void;
  assertVerificationNoDrift(before: string[], after: string[]): void;
}

export interface EngineeringRunnerOptions {
  client: SupervisorClientLike;
  executor: AssignmentExecutor;
  workspace: WorkspaceInspector;
  scopeGuard: ScopeGuardLike;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  candidateWorkspaceManager?: CandidateWorkspaceManagerLike;
  candidatePublisher?: CandidatePublisherLike;
  executorFactory?: (cwd: string) => AssignmentExecutor;
  verifyProductionHead?: (sha: string) => Promise<void>;
  preflight?: () => Promise<void>;
  singleShot?: boolean;
}

function errorReason(error: unknown): string {
  if (error instanceof Error) return `${error.name}:${error.message}`;
  return String(error);
}

class RetryableSupervisorClaimError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error));
    this.name = 'RetryableSupervisorClaimError';
  }
}

function isRetryableSupervisorClaimFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;

  const match = /^supervisor_claim_failed:(\d{3})$/.exec(error.message);
  if (!match) return false;

  const status = Number(match[1]);
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );
}

function isAmbiguousMutation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ((error as { ambiguous?: unknown }).ambiguous === true ||
        (error as { name?: unknown }).name === 'AmbiguousSupervisorMutationError'),
  );
}

function assertImplementationEvidenceMatches(
  observed: string[],
  reported: string[],
): void {
  const observedSorted = [...observed].sort();
  const reportedSorted = [...reported].sort();
  if (
    observedSorted.length !== reportedSorted.length ||
    observedSorted.some((value, index) => value !== reportedSorted[index])
  ) {
    throw new Error('implementation_evidence_changed_files_mismatch');
  }
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export class EngineeringRunner {
  private readonly client: SupervisorClientLike;
  private readonly executor: AssignmentExecutor;
  private readonly workspace: WorkspaceInspector;
  private readonly scopeGuard: ScopeGuardLike;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly candidateWorkspaceManager?: CandidateWorkspaceManagerLike;
  private readonly candidatePublisher?: CandidatePublisherLike;
  private readonly executorFactory?: (cwd: string) => AssignmentExecutor;
  private readonly verifyProductionHead: (sha: string) => Promise<void>;
  private readonly preflight?: () => Promise<void>;
  private readonly singleShot: boolean;

  constructor(options: EngineeringRunnerOptions) {
    this.client = options.client;
    this.executor = options.executor;
    this.workspace = options.workspace;
    this.scopeGuard = options.scopeGuard;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000;
    this.candidateWorkspaceManager = options.candidateWorkspaceManager;
    this.candidatePublisher = options.candidatePublisher;
    this.executorFactory = options.executorFactory;
    this.verifyProductionHead = options.verifyProductionHead ?? (async (sha) => {
      const repositoryRoot = process.env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY;
      const remote = process.env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE;
      if (!repositoryRoot || !remote) throw new Error('runtime_refresh_source_unconfigured');
      await new CandidateSourceRepository({
        repositoryRoot, remote,
        sourceToken: process.env.ATLAS_ENGINEERING_RUNNER_SOURCE_TOKEN,
      }).ensureProductionHead(sha);
    });
    this.preflight = options.preflight;
    this.singleShot = options.singleShot === true;
    if (this.pollIntervalMs < 0 || this.heartbeatIntervalMs <= 0) {
      throw new Error('runner_timing_invalid');
    }
  }

  async runOnce(signal?: AbortSignal): Promise<'idle' | 'completed' | 'failed' | 'cancelled'> {
    let session;
    try {
      session = await this.client.claimNext();
    } catch (error) {
      if (isRetryableSupervisorClaimFailure(error)) {
        throw new RetryableSupervisorClaimError(error);
      }
      throw error;
    }
    if (!session) return 'idle';

    let heartbeatError: unknown;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let candidateLease: CandidateWorkspaceLeaseLike | undefined;
    let terminalRecorded = false;

    try {
      let activeWorkspace = this.workspace;
      let activeExecutor = this.executor;
      const frozenBaseSha = session.assignment.frozenBaseSha;
      const useCandidateFlow =
        session.purpose === 'IMPLEMENTATION' && Boolean(frozenBaseSha);
      const useExistingCandidateFlow =
        session.purpose === 'INDEPENDENT_VERIFICATION' &&
        session.assignment.verificationMode === 'EXISTING_CANDIDATE' &&
        Boolean(session.assignment.candidateBaseSha) &&
        Boolean(session.assignment.candidateHeadSha) &&
        Boolean(session.assignment.productionBaselineSha) &&
        session.assignment.candidateBaseSha !== session.assignment.candidateHeadSha;
      const useRuntimeRefreshFlow =
        session.purpose === 'INDEPENDENT_VERIFICATION' &&
        session.assignment.verificationMode === 'EXISTING_CANDIDATE' &&
        Boolean(session.assignment.candidateBaseSha) &&
        session.assignment.candidateBaseSha === session.assignment.candidateHeadSha &&
        session.assignment.candidateHeadSha === session.assignment.productionBaselineSha;
      const useImplementationResultFlow =
        session.purpose === 'INDEPENDENT_VERIFICATION' &&
        session.assignment.verificationMode === 'IMPLEMENTATION_RESULT' &&
        Boolean(session.assignment.candidateBaseSha) &&
        session.assignment.candidateBaseSha === session.assignment.candidateHeadSha &&
        session.assignment.candidateHeadSha === session.assignment.productionBaselineSha;

      if (session.assignment.verificationMode &&
          !useExistingCandidateFlow && !useRuntimeRefreshFlow &&
          !useImplementationResultFlow) {
        throw new Error('verification_candidate_identity_incomplete');
      }
      if (useCandidateFlow || useExistingCandidateFlow || useRuntimeRefreshFlow ||
          useImplementationResultFlow) {
        if (
          !this.candidateWorkspaceManager ||
          (useCandidateFlow && !this.candidatePublisher) ||
          !this.executorFactory
        ) {
          throw new Error('candidate_flow_configuration_missing');
        }
        candidateLease = await this.candidateWorkspaceManager.prepare({
          taskId: session.assignment.taskId,
          executionId: session.assignment.executionId,
          ...(useCandidateFlow || useRuntimeRefreshFlow ||
              useImplementationResultFlow ? {
            frozenBaseSha: (useRuntimeRefreshFlow || useImplementationResultFlow
              ? session.assignment.candidateHeadSha : frozenBaseSha)!,
          } : {
            candidateBaseSha: session.assignment.candidateBaseSha!,
            candidateHeadSha: session.assignment.candidateHeadSha!,
            productionBaselineSha: session.assignment.productionBaselineSha!,
          }),
          allowedPaths: session.assignment.allowedPaths,
        });
        activeWorkspace = candidateLease.workspace;
        activeExecutor = this.executorFactory(candidateLease.path);
      }

      if (useExistingCandidateFlow &&
          (!candidateLease?.verifiedHeadSha ||
           candidateLease.verifiedHeadSha !== session.assignment.candidateHeadSha ||
           !candidateLease.verifiedChangedPaths ||
           !candidateLease.verifyProductionBaseline ||
           !activeWorkspace.fingerprint)) {
        throw new Error('existing_candidate_source_identity_unverified');
      }
      if (useRuntimeRefreshFlow || useImplementationResultFlow) {
        if (!activeWorkspace.fingerprint ||
            candidateLease?.baseSha !== session.assignment.candidateHeadSha) {
          throw new Error('same_sha_verification_workspace_identity_unverified');
        }
        await this.verifyProductionHead(session.assignment.candidateHeadSha!);
      }
      const before = await activeWorkspace.listChangedFiles();
      const beforeFingerprint = useExistingCandidateFlow || useRuntimeRefreshFlow ||
        useImplementationResultFlow
        ? await activeWorkspace.fingerprint!() : undefined;
      await session.heartbeat();
      heartbeatTimer = setInterval(() => {
        void session.heartbeat().catch((error) => {
          heartbeatError ??= error;
        });
      }, this.heartbeatIntervalMs);

      const executionResult = await activeExecutor.execute(
        session.assignment,
        signal,
      );
      const after = await activeWorkspace.listChangedFiles();
      const afterFingerprint = useExistingCandidateFlow || useRuntimeRefreshFlow ||
        useImplementationResultFlow
        ? await activeWorkspace.fingerprint!() : undefined;

      if (heartbeatError) throw heartbeatError;
      if (useExistingCandidateFlow && beforeFingerprint !== afterFingerprint) {
        throw new Error('existing_candidate_git_fingerprint_drift');
      }
      if ((useRuntimeRefreshFlow || useImplementationResultFlow) &&
          (before.length !== 0 || after.length !== 0 ||
           beforeFingerprint !== afterFingerprint ||
           executionResult.evidence.changedFiles.length !== 0 ||
           executionResult.evidence.candidatePublication ||
           executionResult.evidence.existingCandidateVerification ||
           executionResult.evidence.reviewCandidate)) {
        throw new Error('same_sha_verification_evidence_or_workspace_drift');
      }
      if (session.purpose === 'INDEPENDENT_VERIFICATION') {
        this.scopeGuard.assertVerificationNoDrift(before, after);
        if (useExistingCandidateFlow) {
          if (executionResult.evidence.candidatePublication) {
            throw new Error('existing_candidate_publication_forbidden');
          }
          const verified = [...candidateLease!.verifiedChangedPaths!].sort();
          const reported = [...new Set(executionResult.evidence.changedFiles)].sort();
          if (verified.length !== reported.length ||
              verified.some((path, index) => path !== reported[index])) {
            throw new Error('existing_candidate_evidence_scope_mismatch');
          }
        }
      } else {
        this.scopeGuard.assertImplementationScope(
          after,
          session.assignment.allowedPaths,
        );
        assertImplementationEvidenceMatches(
          after,
          executionResult.evidence.changedFiles,
        );
      }

      let completionResult = executionResult;
      if (useExistingCandidateFlow) {
        const changedFiles = [...candidateLease!.verifiedChangedPaths!];
        completionResult = {
          summary: executionResult.summary,
          evidence: {
            ...executionResult.evidence,
            changedFiles,
            // This is a genuine verifier observation. No implementation or
            // candidatePublication receipt is manufactured for the old SHA.
            existingCandidateVerification: {
              mode: 'EXISTING_CANDIDATE',
              taskId: session.assignment.taskId,
              executionId: session.assignment.executionId,
              baseSha: session.assignment.candidateBaseSha!,
              headSha: session.assignment.candidateHeadSha!,
              productionBaselineSha: session.assignment.productionBaselineSha!,
              changedFiles,
              gitFingerprint: beforeFingerprint!,
              sourceVerified: true,
            },
            reviewCandidate: {
              action: 'merge',
              targetBranch: 'production/atlas',
              baseSha: session.assignment.candidateBaseSha!,
              headSha: session.assignment.candidateHeadSha!,
              changedFiles,
            },
          },
        };
      }
      if (useRuntimeRefreshFlow) {
        const sha = session.assignment.candidateHeadSha!;
        completionResult = {
          summary: executionResult.summary,
          evidence: {
            ...executionResult.evidence,
            existingCandidateVerification: {
              mode: 'EXISTING_CANDIDATE',
              taskId: session.assignment.taskId,
              executionId: session.assignment.executionId,
              baseSha: sha, headSha: sha, productionBaselineSha: sha,
              changedFiles: [], gitFingerprint: beforeFingerprint!,
              sourceVerified: true,
            },
            reviewCandidate: {
              action: 'deploy_production', targetBranch: 'production/atlas',
              baseSha: sha, headSha: sha, changedFiles: [],
            },
          },
        };
      }
      if (useCandidateFlow && after.length > 0) {
        const receipt = await this.candidatePublisher!.publish({
          taskId: session.assignment.taskId,
          executionId: session.assignment.executionId,
          executionPurpose: 'IMPLEMENTATION',
          workspace: candidateLease!.path,
          frozenBaseSha: frozenBaseSha!,
          targetBranch: 'production/atlas',
          changedFiles: [...after],
        });
        completionResult = {
          summary: executionResult.summary,
          evidence: {
            ...executionResult.evidence,
            candidatePublication: receipt,
            reviewCandidate: {
              action: 'merge',
              targetBranch: receipt.targetBranch,
              baseSha: receipt.baseSha,
              headSha: receipt.headSha,
              changedFiles: [...receipt.changedFiles],
            },
          },
        };
      } else if (useCandidateFlow) {
        const {
          candidatePublication: _candidatePublication,
          existingCandidateVerification: _existingCandidateVerification,
          reviewCandidate: _reviewCandidate,
          ...boundedEvidence
        } = executionResult.evidence;
        completionResult = {
          summary: executionResult.summary,
          evidence: {
            ...boundedEvidence,
            changedFiles: [],
          },
        };
      }

      // Keep heartbeats active until completion. The final remote source
      // check can otherwise exceed the remaining Supervisor execution lease.
      // Verification may outlive the Git source snapshot. A second canonical
      // remote read immediately before submission rejects production drift.
      if (useExistingCandidateFlow) {
        await candidateLease!.verifyProductionBaseline!();
      }
      if (useRuntimeRefreshFlow || useImplementationResultFlow) {
        await this.verifyProductionHead(session.assignment.candidateHeadSha!);
      }
      await session.complete(completionResult);
      terminalRecorded = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      return 'completed';
    } catch (error) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);

      if (isAmbiguousMutation(error)) {
        throw error;
      }

      if (signal?.aborted) {
        try {
          await session.cancel('runner_aborted');
          terminalRecorded = true;
        } catch (cancelError) {
          if (isAmbiguousMutation(cancelError)) throw cancelError;
          throw cancelError;
        }
        return 'cancelled';
      }

      try {
        await session.fail(errorReason(error));
        terminalRecorded = true;
      } catch (failError) {
        if (isAmbiguousMutation(failError)) throw failError;
        throw failError;
      }
      return 'failed';
    } finally {
      if (terminalRecorded && candidateLease) {
        try {
          await candidateLease.cleanup();
        } catch {
          // Terminal Supervisor state is authoritative; cleanup is best-effort.
        }
      }
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    if (this.preflight) {
      await this.preflight();
    }
    if (this.singleShot) {
      await this.runOnce(signal);
      return;
    }
    while (!signal.aborted) {
      try {
        await this.runOnce(signal);
      } catch (error) {
        if (!(error instanceof RetryableSupervisorClaimError)) {
          throw error;
        }
      }
      if (signal.aborted) break;
      await delay(this.pollIntervalMs, signal);
    }
  }
}
