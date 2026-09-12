import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  resolveSupervisorExecutionLivenessConfig,
  type SupervisorExecutionLivenessConfig,
} from '../execution/supervisor-execution-liveness.config';
import {
  SUPERVISOR_EXECUTION_RECONCILIATION_STORE,
  type SupervisorExecutionReconciliationStore,
} from '../stores/supervisor-execution.store';
import {
  SUPERVISOR_EXECUTION_RECOVERY_STORE,
  type SupervisorExecutionRecoveryStore,
} from '../stores/supervisor-lifecycle.store';

const RECONCILIATION_BATCH_LIMIT = 50;

function isLivenessConfig(value: unknown): value is SupervisorExecutionLivenessConfig {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'queuedClaimTimeoutMs' in value &&
      'reconciliationIntervalMs' in value,
  );
}

@Injectable()
export class SupervisorExecutionReconcilerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly config: SupervisorExecutionLivenessConfig;
  private timer: ReturnType<typeof setInterval> | undefined;
  private cycleInProgress = false;
  private overlapObserved = false;

  constructor(
    @Inject(SUPERVISOR_EXECUTION_RECONCILIATION_STORE)
    private readonly reconciliationStore: SupervisorExecutionReconciliationStore,
    @Inject(SUPERVISOR_EXECUTION_RECOVERY_STORE)
    private readonly recoveryStore: SupervisorExecutionRecoveryStore,
    @Optional() @Inject(ConfigService)
    configSource?: ConfigService | SupervisorExecutionLivenessConfig,
  ) {
    this.config = isLivenessConfig(configSource)
      ? resolveSupervisorExecutionLivenessConfig(configSource)
      : resolveSupervisorExecutionLivenessConfig();
  }

  async onModuleInit(): Promise<void> {
    await this.reconcileNow();
    this.timer = setInterval(() => {
      void this.reconcileNow();
    }, this.config.reconciliationIntervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async reconcileNow(): Promise<unknown> {
    if (this.cycleInProgress) {
      this.overlapObserved = true;
      return;
    }
    this.cycleInProgress = true;
    this.overlapObserved = false;
    let lastRecoveryResult: unknown;

    try {
      const now = new Date();
      const candidates = await this.reconciliationStore.findReconciliationCandidates({
        now,
        queuedBefore: new Date(
          now.getTime() - this.config.queuedClaimTimeoutMs,
        ),
        limit: RECONCILIATION_BATCH_LIMIT,
      });

      for (const candidate of candidates.slice(0, RECONCILIATION_BATCH_LIMIT)) {
        try {
          lastRecoveryResult = await this.recoveryStore.recoverExecutionAndBlockTask({
            candidate,
            now,
          });
        } catch (error) {
          console.warn('Supervisor reconciliation candidate failed', {
            executionId: candidate.executionId,
            kind: candidate.kind,
            error: error instanceof Error ? error.name : 'unknown_error',
          });
        }
      }
    } catch {
      // The next scheduled cycle is the retry boundary.
    } finally {
      this.cycleInProgress = false;
    }

    if (this.overlapObserved) return lastRecoveryResult;
  }
}
