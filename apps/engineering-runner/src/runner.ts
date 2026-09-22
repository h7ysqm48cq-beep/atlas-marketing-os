import type {
  AssignmentExecutor,
  CandidatePublicationReceipt,
  SupervisorClientLike,
  WorkspaceInspector,
} from './types.ts';


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
  preflight?: () => Promise<void>;
  singleShot?: boolean;
}

function errorReason(error: unknown): string {
  if (error instanceof Error) return `${error.name}:${error.message}`;
  return String(error);
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
    this.preflight = options.preflight;
    this.singleShot = options.singleShot === true;
    if (this.pollIntervalMs < 0 || this.heartbeatIntervalMs <= 0) {
      throw new Error('runner_timing_invalid');
    }
  }

  async runOnce(signal?: AbortSignal): Promise<'idle' | 'completed' | 'failed' | 'cancelled'> {
    const session = await this.client.claimNext();
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
        Boolean(session.assignment.productionBaselineSha);

      if (session.assignment.verificationMode === 'EXISTING_CANDIDATE' &&
          !useExistingCandidateFlow) {
        throw new Error('existing_candidate_identity_incomplete');
      }
      if (useCandidateFlow || useExistingCandidateFlow) {
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
          ...(useCandidateFlow ? { frozenBaseSha: frozenBaseSha! } : {
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
      const before = await activeWorkspace.listChangedFiles();
      const beforeFingerprint = useExistingCandidateFlow
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
      const afterFingerprint = useExistingCandidateFlow
        ? await activeWorkspace.fingerprint!() : undefined;

      if (heartbeatError) throw heartbeatError;
      if (useExistingCandidateFlow && beforeFingerprint !== afterFingerprint) {
        throw new Error('existing_candidate_git_fingerprint_drift');
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
      if (useCandidateFlow) {
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
      }

      // Keep heartbeats active until completion. The final remote source
      // check can otherwise exceed the remaining Supervisor execution lease.
      // Verification may outlive the Git source snapshot. A second canonical
      // remote read immediately before submission rejects production drift.
      if (useExistingCandidateFlow) {
        await candidateLease!.verifyProductionBaseline!();
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
      await this.runOnce(signal);
      if (signal.aborted) break;
      await delay(this.pollIntervalMs, signal);
    }
  }
}
