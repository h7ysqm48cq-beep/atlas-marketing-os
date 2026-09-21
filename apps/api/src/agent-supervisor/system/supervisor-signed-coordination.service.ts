import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  OnModuleDestroy, OnModuleInit, Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { AgentGatewayService } from '../gateway/agent-gateway.service';
import { PrismaSupervisorSignedReviewStore } from
  '../persistence/prisma-supervisor-signed-review.store';

type Action = 'IMPLEMENTATION_SUBMITTED' | 'VERIFICATION_STARTED' |
  'VERIFIER_QUEUED' | 'READY_FOR_REVIEW' | 'IDLE' | 'BLOCKED';
export interface SignedCoordinationOutcome {
  taskId: string; action: Action;
  executionId?: string;
}

/**
 * Control plane only: no worker token, signer private key, owner credential,
 * merge/deploy permission or synthetic verifier evidence. One durable
 * transition per pass; subsequent polls recover partial progress.
 */
@Injectable()
export class SupervisorSignedCoordinationService
  implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private scanning = false;
  private scanCursor = 0;
  private readonly inFlight = new Set<string>();
  constructor(
    private readonly supervisor: AgentSupervisorService,
    private readonly gateway: AgentGatewayService,
    private readonly dispatcher: WorkerDispatcherService,
    private readonly signed: PrismaSupervisorSignedReviewStore,
    private readonly config: ConfigService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  private enabled(): boolean {
    return this.config.get<string>(
      'ATLAS_SUPERVISOR_SIGNED_ATTESTATION_MODE',
    ) === 'required' && this.config.get<string>(
      'ATLAS_SUPERVISOR_SIGNED_COORDINATION_MODE',
    ) === 'enabled';
  }

  async onModuleInit(): Promise<void> {
    // Production rollout is opt-in and MUST explicitly assert singleton
    // operation; keep default OFF across all existing Railway replicas.
    if (!this.enabled() || this.config.get<string>(
      'ATLAS_SUPERVISOR_SIGNED_COORDINATION_SINGLETON_CONFIRMED',
    ) !== 'true') return;
    const rawInterval = Number(this.config.get<string>(
      'ATLAS_SUPERVISOR_SIGNED_COORDINATION_INTERVAL_MS',
    ) ?? '30000');
    if (!Number.isInteger(rawInterval) || rawInterval < 5000 ||
        rawInterval > 300000) {
      throw new BadRequestException('signed_coordination_interval_invalid');
    }
    await this.tickNow();
    this.timer = setInterval(() => { void this.tickNow(); }, rawInterval);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Production: query ONLY 50 live IDs; no periodic full task-table load. */
  private async nextBatch(): Promise<string[]> {
    if (this.prisma) {
      const query = () => this.prisma!.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "SupervisorTask" WHERE "status" IN ' +
        "('WORKING','IMPLEMENTED','VERIFYING') " +
        'ORDER BY "createdAt","id" LIMIT 50 OFFSET $1',
        this.scanCursor,
      );
      let rows = await query();
      if (rows.length === 0 && this.scanCursor > 0) {
        this.scanCursor = 0;
        rows = await query();
      }
      this.scanCursor = rows.length < 50
        ? 0 : this.scanCursor + rows.length;
      return rows.map(row => row.id);
    }
    // Isolated in-memory testing only; the Nest production module injects
    // PrismaService and therefore always uses the bounded query above.
    const tasks = (await this.supervisor.listTasks()).filter(task =>
      ['WORKING', 'IMPLEMENTED', 'VERIFYING'].includes(task.status));
    const start = tasks.length ? this.scanCursor % tasks.length : 0;
    const batch = [...tasks.slice(start),
      ...tasks.slice(0, start)].slice(0, 50);
    this.scanCursor = tasks.length
      ? (start + batch.length) % tasks.length : 0;
    return batch.map(task => task.id);
  }

  async tickNow(): Promise<SignedCoordinationOutcome[]> {
    if (!this.enabled() || this.scanning) return [];
    this.scanning = true;
    const outcomes: SignedCoordinationOutcome[] = [];
    try {
      for (const taskId of await this.nextBatch()) {
        try {
          outcomes.push(await this.advanceTask(taskId));
        } catch (error) {
          // A failed task is not silently moved to a success state.
          console.warn('Signed coordination task blocked', {
            taskId,
            cause: error instanceof Error ? error.name : 'unknown',
          });
          outcomes.push({ taskId, action: 'BLOCKED' });
        }
      }
    } catch {
      // Retry on next tick; NEVER reinterpret discovery failure as success.
    } finally {
      this.scanning = false;
    }
    return outcomes;
  }

  async advanceTask(taskId: string): Promise<SignedCoordinationOutcome> {
    if (!this.enabled()) {
      throw new ForbiddenException('signed_coordination_not_enabled');
    }
    if (typeof taskId !== 'string' || !taskId.trim()) {
      throw new BadRequestException('signed_coordination_task_required');
    }
    if (this.inFlight.has(taskId)) {
      throw new ConflictException('signed_coordination_already_running');
    }
    this.inFlight.add(taskId);
    try {
      const task = await this.supervisor.getTask(taskId);
      if (task.status === 'READY_FOR_REVIEW') {
        return { taskId, action: 'IDLE' };
      }
      if (!['WORKING', 'IMPLEMENTED', 'VERIFYING'].includes(task.status)) {
        return { taskId, action: 'BLOCKED' };
      }
      const executions = await this.dispatcher.listByTask(taskId);
      const implementations = executions.filter(execution =>
        (execution.assignment.executionPurpose ?? 'IMPLEMENTATION') ===
          'IMPLEMENTATION');
      const verifiers = executions.filter(execution =>
        execution.assignment.executionPurpose ===
          'INDEPENDENT_VERIFICATION');
      if (task.status === 'WORKING') {
        if (verifiers.length ||
            implementations.length !== 1 ||
            implementations[0].status !== 'COMPLETED') {
          return { taskId, action: 'IDLE' };
        }
        const execution = implementations[0];
        // Worker-reported COMPLETE is NOT sufficient to advance: load the
        // insert-only claim+completion ledger and independently verify both.
        await this.signed.assertCompletedImplementation({
          taskId, executionId: execution.id,
        });
        await this.gateway.submitImplementationFromExecution(
          taskId, execution.id,
        );
        return { taskId, action: 'IMPLEMENTATION_SUBMITTED',
          executionId: execution.id };
      }
      if (task.status === 'IMPLEMENTED') {
        if (implementations.length !== 1 ||
            implementations[0].status !== 'COMPLETED' ||
            verifiers.length) {
          return { taskId, action: 'BLOCKED' };
        }
        await this.supervisor.beginVerification(taskId);
        return { taskId, action: 'VERIFICATION_STARTED' };
      }
      if (implementations.length !== 1 ||
          implementations[0].status !== 'COMPLETED' ||
          verifiers.length > 1) {
        return { taskId, action: 'BLOCKED' };
      }
      if (verifiers.length === 0) {
        const queued = await this.dispatcher.dispatch(
          taskId, 'INDEPENDENT_VERIFICATION',
        );
        return { taskId, action: 'VERIFIER_QUEUED',
          executionId: queued.execution.id };
      }
      const verifier = verifiers[0];
      if (['QUEUED', 'DISPATCHED', 'RUNNING'].includes(verifier.status)) {
        return { taskId, action: 'IDLE' };
      }
      if (verifier.status !== 'COMPLETED') {
        // No automatic retries or replacement verifier on signed failure.
        return { taskId, action: 'BLOCKED' };
      }
      const expectedTaskVersion =
        await this.signed.currentTaskVersion(taskId);
      const ready = await this.signed.releaseReady({
        taskId, expectedTaskVersion,
      });
      if (ready.status !== 'READY_FOR_REVIEW') {
        throw new ForbiddenException('signed_coordination_ready_failed');
      }
      return { taskId, action: 'READY_FOR_REVIEW',
        executionId: verifier.id };
    } finally {
      this.inFlight.delete(taskId);
    }
  }
}
