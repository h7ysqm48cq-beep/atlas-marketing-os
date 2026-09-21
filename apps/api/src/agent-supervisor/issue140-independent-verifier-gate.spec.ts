import { AgentSupervisorService } from './agent-supervisor.service';
import { MemorySupervisorTaskStore } from './stores/memory-supervisor-task.store';
import { MemoryFileOwnershipStore } from './stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from './stores/memory-supervisor-execution.store';

const path = 'apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.ts';

describe('Issue #140: independent verification required before ready', () => {
  it('rejects READY_FOR_REVIEW when only implementation evidence exists; retains status and lock', async () => {
    const fileStore = new MemoryFileOwnershipStore();
    const executionStore = new MemorySupervisorExecutionStore();
    const service = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      fileStore,
      undefined,
      undefined,
      undefined,
      undefined,
      executionStore,
    );
    const task = await service.createTask({
      objective: 'Issue140 isolated missing verifier demonstration',
      owner: 'engineering',
      allowedPaths: [path],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['a distinct verifier completes'],
    });
    await service.startTask(task.id);
    await service.submitImplementation(task.id, {
      rootCause: 'mapper receipt readback',
      changedFiles: [path],
      tests: ['PASS'],
      build: 'PASS',
      regression: ['PASS'],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'ISOLATED',
      remainingRisk: [],
    });
    await service.beginVerification(task.id);
    expect(await fileStore.findOwner(path)).toBe(task.id);
    await expect(service.markReadyForReview(task.id)).rejects.toMatchObject({
      response: { code: 'independent_verification_required' },
    });
    expect((await service.getTask(task.id)).status).toBe('VERIFYING');
    expect(await fileStore.findOwner(path)).toBe(task.id);
  });

  it('preserves lock when no verifier execution exists', async () => {
    const fileStore = new MemoryFileOwnershipStore();
    const executionStore = new MemorySupervisorExecutionStore();
    const service = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      fileStore,
      undefined,
      undefined,
      undefined,
      undefined,
      executionStore,
    );
    const task = await service.createTask({
      objective: 'Issue140 lock release observation',
      owner: 'engineering',
      allowedPaths: [path],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['independent verifier completed'],
    });
    await service.startTask(task.id);
    await service.submitImplementation(task.id, {
      rootCause: 'missing verifier gate',
      changedFiles: [path],
      tests: ['PASS'],
      build: 'PASS',
      regression: [],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'ISOLATED',
      remainingRisk: [],
    });
    await service.beginVerification(task.id);
    await expect(service.markReadyForReview(task.id)).rejects.toMatchObject({
      response: { code: 'independent_verification_required' },
    });
    expect((await service.getTask(task.id)).status).toBe('VERIFYING');
    expect(await fileStore.findOwner(path)).toBe(task.id);
  });

  it('accepts a test-only completed verifier record with consistent task binding', async () => {
    // This fixture is LOCAL ONLY, not a signed verifier, real claim, or production receipt.
    const fileStore = new MemoryFileOwnershipStore();
    const executionStore = new MemorySupervisorExecutionStore();
    const service = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      fileStore,
      undefined,
      undefined,
      undefined,
      undefined,
      executionStore,
    );
    const task = await service.createTask({
      objective: 'Issue140 simulated completed verifier',
      owner: 'engineering',
      allowedPaths: [path],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['test-only verifier result'],
    });
    await service.startTask(task.id);
    const implementation = {
      rootCause: 'receipt readback',
      changedFiles: [path],
      tests: ['PASS'],
      build: 'PASS',
      regression: ['PASS'],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'ISOLATED',
      remainingRisk: [],
    };
    await service.submitImplementation(task.id, implementation);
    await service.beginVerification(task.id);
    const now = new Date(Math.max(Date.now(), (await service.getTask(task.id)).updatedAt.getTime() + 1));
    const verifierExecutionId = 'TEST-VERIFIER-COMPLETED-1';
    await executionStore.create({
      id: verifierExecutionId,
      taskId: task.id,
      workerRole: 'engineering',
      status: 'COMPLETED',
      assignment: {
        executionId: verifierExecutionId,
        taskId: task.id,
        workerRole: 'engineering',
        executionPurpose: 'INDEPENDENT_VERIFICATION',
        objective: 'test-only verifier check',
        allowedPaths: [path],
        forbiddenActions: [],
        dependencies: [],
        acceptance: [],
        requiredEvidence: [],
        manifestHash: 'a'.repeat(64),
        claimEpoch: 1,
        runnerId: 'TEST-ONLY-VERIFIER',
        leaseId: 'TEST-ONLY-LEASE',
      },
      result: {
        summary: 'test-only completed verifier',
        evidence: implementation,
      },
      error: null,
      createdAt: now,
      startedAt: now,
      completedAt: now,
      runnerId: 'TEST-ONLY-VERIFIER',
      claimEpoch: 1,
      lastHeartbeatAt: now,
      leaseExpiresAt: now,
    });
    await expect(service.markReadyForReview(task.id)).rejects.toMatchObject({
      response: { code: 'independent_verifier_identity_required' },
    });
    expect((await service.getTask(task.id)).status).toBe('VERIFYING');
    expect(await fileStore.findOwner(path)).toBe(task.id);
  });
});
