import { resolveSupervisorExecutionLivenessConfig } from '../execution/supervisor-execution-liveness.config';

type Candidate = {
  executionId: string;
  taskId: string;
  status: 'QUEUED' | 'DISPATCHED' | 'RUNNING';
  kind:
    | 'QUEUED_TIMEOUT'
    | 'LEGACY_DISPATCHED_TIMEOUT'
    | 'RUNNING_LEASE_EXPIRED';
  claimEpoch: number;
  runnerId: string | null;
  createdAt: Date;
  leaseExpiresAt: Date | null;
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    executionId: 'EXEC-RECONCILE-1',
    taskId: 'ATLAS-1',
    status: 'RUNNING',
    kind: 'RUNNING_LEASE_EXPIRED',
    claimEpoch: 4,
    runnerId: 'runner-1',
    createdAt: new Date('2026-09-12T23:00:00.000Z'),
    leaseExpiresAt: new Date('2026-09-12T23:59:00.000Z'),
    ...overrides,
  };
}

function loadReconciler(): any {
  try {
    return require('./supervisor-execution-reconciler.service')
      .SupervisorExecutionReconcilerService;
  } catch {
    return undefined;
  }
}

function createReconciler() {
  const Reconciler = loadReconciler();
  expect(Reconciler).toEqual(expect.any(Function));

  const reconciliationStore = {
    findReconciliationCandidates: jest.fn().mockResolvedValue([]),
  };
  const recoveryStore = {
    recoverExecutionAndBlockTask: jest.fn().mockResolvedValue(null),
  };
  const config = resolveSupervisorExecutionLivenessConfig({
    queuedClaimTimeoutMs: 10_000,
    reconciliationIntervalMs: 5_000,
  });
  const service = new Reconciler(
    reconciliationStore,
    recoveryStore,
    config,
  );
  return { service, reconciliationStore, recoveryStore, config };
}

function cycle(service: any): () => Promise<unknown> {
  const run = service.reconcileNow ?? service.reconcileOnce;
  expect(run).toEqual(expect.any(Function));
  return run.bind(service);
}

describe('SupervisorExecutionReconcilerService RED contract', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs one bounded reconciliation cycle during module initialization', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-13T00:00:00.000Z'));
    const { service, reconciliationStore, config } = createReconciler();

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(reconciliationStore.findReconciliationCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        now: expect.any(Date),
        queuedBefore: new Date(
          Date.now() - config.queuedClaimTimeoutMs,
        ),
        limit: expect.any(Number),
      }),
    );
  });

  it('uses the configured liveness interval and cleans up its timer', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-13T00:00:00.000Z'));
    const { service, reconciliationStore, config } = createReconciler();

    await service.onModuleInit();
    expect(reconciliationStore.findReconciliationCandidates).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(config.reconciliationIntervalMs);
    expect(reconciliationStore.findReconciliationCandidates).toHaveBeenCalledTimes(2);

    await service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(config.reconciliationIntervalMs * 2);
    expect(reconciliationStore.findReconciliationCandidates).toHaveBeenCalledTimes(2);
  });

  it('processes only a finite bounded candidate batch per cycle', async () => {
    const { service, reconciliationStore, recoveryStore } = createReconciler();
    const candidates = Array.from({ length: 101 }, (_, index) =>
      candidate({ executionId: `EXEC-${index}` }),
    );
    reconciliationStore.findReconciliationCandidates.mockResolvedValue(candidates);

    await cycle(service)();

    const [{ limit }] = reconciliationStore.findReconciliationCandidates.mock
      .calls[0] as [{ limit: number }];
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(100);
    expect(recoveryStore.recoverExecutionAndBlockTask).toHaveBeenCalledTimes(
      Math.min(limit, candidates.length),
    );
  });

  it('isolates one candidate recovery failure and continues the batch', async () => {
    const { service, reconciliationStore, recoveryStore } = createReconciler();
    const candidates = [
      candidate({ executionId: 'EXEC-A' }),
      candidate({ executionId: 'EXEC-B' }),
      candidate({ executionId: 'EXEC-C' }),
    ];
    reconciliationStore.findReconciliationCandidates.mockResolvedValue(candidates);
    recoveryStore.recoverExecutionAndBlockTask
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('candidate recovery failed'))
      .mockResolvedValueOnce({});

    await expect(cycle(service)()).resolves.toBeUndefined();
    expect(recoveryStore.recoverExecutionAndBlockTask).toHaveBeenCalledTimes(3);
  });

  it('treats a null recovery result as a benign CAS loser', async () => {
    const { service, reconciliationStore, recoveryStore } = createReconciler();
    reconciliationStore.findReconciliationCandidates.mockResolvedValue([
      candidate(),
    ]);
    recoveryStore.recoverExecutionAndBlockTask.mockResolvedValue(null);

    await expect(cycle(service)()).resolves.toBeUndefined();
    expect(recoveryStore.recoverExecutionAndBlockTask).toHaveBeenCalledTimes(1);
  });

  it('does not overlap local reconciliation cycles', async () => {
    const { service, reconciliationStore, recoveryStore } = createReconciler();
    let resolveFirstRecovery!: () => void;
    const firstRecovery = new Promise<null>((resolve) => {
      resolveFirstRecovery = () => resolve(null);
    });
    reconciliationStore.findReconciliationCandidates.mockResolvedValue([
      candidate(),
    ]);
    recoveryStore.recoverExecutionAndBlockTask.mockReturnValue(firstRecovery);

    const run = cycle(service);
    const first = run();
    await Promise.resolve();
    await expect(run()).resolves.toBeUndefined();
    expect(reconciliationStore.findReconciliationCandidates).toHaveBeenCalledTimes(1);
    expect(first).toBeInstanceOf(Promise);
    resolveFirstRecovery();
    await expect(first).resolves.toBeNull();
  });

  it('has no Human Owner, merge, or deploy authority dependencies', () => {
    const Reconciler = loadReconciler();
    expect(Reconciler).toEqual(expect.any(Function));

    const paramTypes = Reflect.getMetadata('design:paramtypes', Reconciler) ?? [];
    const names = paramTypes.map((type: unknown) =>
      typeof type === 'function' ? type.name : String(type),
    );
    expect(names).not.toEqual(
      expect.arrayContaining([
        'HumanOwnerApprovalService',
        'SupervisorOwnerGuard',
        'ProductionDeploymentGateService',
      ]),
    );
  });
});
