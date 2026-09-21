import type {
  AssignmentExecutor,
  CandidatePublicationReceipt,
  SupervisorClientLike,
  WorkspaceInspector,
} from './types.ts';


interface CandidateWorkspaceLeaseLike {
  path: string;
  baseSha: string;
  workspace: WorkspaceInspector;
  cleanup(): Promise<void>;
}

interface CandidateWorkspaceManagerLike {
  prepare(input: {
    taskId: string;
    executionId: string;
    frozenBaseSha: string;
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
  verifierWorkspaceManager?: {
    prepare(input: {
      taskId: string; executionId: string;
      frozenBaseSha: string; candidateHeadSha: string;
      candidateBranch: string; allowedPaths: string[];
    }): Promise<CandidateWorkspaceLeaseLike>;
  };
  executorFactory?: (cwd: string) => AssignmentExecutor;
  preflight?: () => Promise<void>;
}

function errorReason(error: unknown): string {
  // Signed terminal's immutable reason is capped at 1,024 characters.
  // Build/tool errors can be arbitrarily long; never lose FAILED entirely
  // because an oversized diagnostic cannot pass server validation.
  const raw = error instanceof Error
    ? `${error.name}:${error.message}` : String(error);
  const reason = raw.trim() || 'unknown_execution_error';
  return reason.length > 1024
    ? reason.slice(0, 1021) + '...' : reason;
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
  private readonly verifierWorkspaceManager?: EngineeringRunnerOptions['verifierWorkspaceManager'];
  private readonly executorFactory?: (cwd: string) => AssignmentExecutor;
  private readonly preflight?: () => Promise<void>;

  constructor(options: EngineeringRunnerOptions) {
    this.client = options.client;
    this.executor = options.executor;
    this.workspace = options.workspace;
    this.scopeGuard = options.scopeGuard;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000;
    this.candidateWorkspaceManager = options.candidateWorkspaceManager;
    this.candidatePublisher = options.candidatePublisher;
    this.verifierWorkspaceManager = options.verifierWorkspaceManager;
    this.executorFactory = options.executorFactory;
    this.preflight = options.preflight;
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
      // Claim lease starts before Git fetch/worktree setup. Keep it alive
      // throughout frozen-head preparation, not only executor runtime.
      await session.heartbeat();
      heartbeatTimer = setInterval(() => {
        void session.heartbeat().catch((error) => {
          heartbeatError ??= error;
        });
      }, this.heartbeatIntervalMs);
      let activeWorkspace = this.workspace;
      let activeExecutor = this.executor;
      const frozenBaseSha = session.assignment.frozenBaseSha;
      const useCandidateFlow =
        session.purpose === 'IMPLEMENTATION' && Boolean(frozenBaseSha);

      if (session.purpose === 'INDEPENDENT_VERIFICATION' &&
          session.assignment.reviewCandidate) {
        const review = session.assignment.reviewCandidate;
        const branch = session.assignment.candidateBranch;
        if (!this.verifierWorkspaceManager ||
            !this.executorFactory || !branch ||
            review.baseSha !== frozenBaseSha) {
          throw new Error('verifier_frozen_workspace_required');
        }
        candidateLease = await this.verifierWorkspaceManager.prepare({
          taskId: session.assignment.taskId,
          executionId: session.assignment.executionId,
          frozenBaseSha: review.baseSha,
          candidateHeadSha: review.headSha,
          candidateBranch: branch,
          allowedPaths: session.assignment.allowedPaths,
        });
        activeWorkspace = candidateLease.workspace;
        activeExecutor = this.executorFactory(candidateLease.path);
      }

      if (useCandidateFlow) {
        if (
          !this.candidateWorkspaceManager ||
          !this.candidatePublisher ||
          !this.executorFactory
        ) {
          throw new Error('candidate_flow_configuration_missing');
        }
        candidateLease = await this.candidateWorkspaceManager.prepare({
          taskId: session.assignment.taskId,
          executionId: session.assignment.executionId,
          frozenBaseSha: frozenBaseSha!,
          allowedPaths: session.assignment.allowedPaths,
        });
        activeWorkspace = candidateLease.workspace;
        activeExecutor = this.executorFactory(candidateLease.path);
      }

      const before = await activeWorkspace.listChangedFiles();

      const executionResult = await activeExecutor.execute(
        session.assignment,
        signal,
      );
      const after = await activeWorkspace.listChangedFiles();

      if (heartbeatError) throw heartbeatError;
      if (session.purpose === 'INDEPENDENT_VERIFICATION') {
        this.scopeGuard.assertVerificationNoDrift(before, after);
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

      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      await session.complete(completionResult);
      terminalRecorded = true;
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
    while (!signal.aborted) {
      await this.runOnce(signal);
      if (signal.aborted) break;
      await delay(this.pollIntervalMs, signal);
    }
  }
}
