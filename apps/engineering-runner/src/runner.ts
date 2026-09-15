import type {
  AssignmentExecutor,
  SupervisorClientLike,
  WorkspaceInspector,
} from './types.ts';

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

  constructor(options: EngineeringRunnerOptions) {
    this.client = options.client;
    this.executor = options.executor;
    this.workspace = options.workspace;
    this.scopeGuard = options.scopeGuard;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000;
    if (this.pollIntervalMs < 0 || this.heartbeatIntervalMs <= 0) {
      throw new Error('runner_timing_invalid');
    }
  }

  async runOnce(signal?: AbortSignal): Promise<'idle' | 'completed' | 'failed' | 'cancelled'> {
    const session = await this.client.claimNext();
    if (!session) return 'idle';

    let heartbeatError: unknown;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

    try {
      const before = await this.workspace.listChangedFiles();
      await session.heartbeat();
      heartbeatTimer = setInterval(() => {
        void session.heartbeat().catch((error) => {
          heartbeatError ??= error;
        });
      }, this.heartbeatIntervalMs);

      const executionResult = await this.executor.execute(
        session.assignment,
        signal,
      );
      const after = await this.workspace.listChangedFiles();

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

      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      await session.complete(executionResult);
      return 'completed';
    } catch (error) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);

      if (isAmbiguousMutation(error)) {
        throw error;
      }

      if (signal?.aborted) {
        try {
          await session.cancel('runner_aborted');
        } catch (cancelError) {
          if (isAmbiguousMutation(cancelError)) throw cancelError;
          throw cancelError;
        }
        return 'cancelled';
      }

      try {
        await session.fail(errorReason(error));
      } catch (failError) {
        if (isAmbiguousMutation(failError)) throw failError;
        throw failError;
      }
      return 'failed';
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.runOnce(signal);
      if (signal.aborted) break;
      await delay(this.pollIntervalMs, signal);
    }
  }
}
