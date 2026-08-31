import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from '../agent-supervisor.service';
import type { SupervisorReviewCandidate } from '../agent-supervisor.types';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { AgentGatewayService } from './agent-gateway.service';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';
const OTHER_ALLOWED_FILE = 'apps/api/src/other.ts';
const OWNER_TOKEN = 'test-owner-merge-token';

function candidate(
  overrides: Partial<SupervisorReviewCandidate> = {},
): SupervisorReviewCandidate {
  return {
    action: 'merge',
    targetBranch: 'production/atlas',
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    changedFiles: [CHANGED_FILE],
    ...overrides,
  };
}

function configService() {
  return {
    get: jest.fn((key: string) =>
      key === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? OWNER_TOKEN : undefined,
    ),
  } as unknown as ConfigService;
}

async function makeReadyCandidate(includeReviewCandidate = true) {
  const taskStore = new MemorySupervisorTaskStore();
  const fileStore = new MemoryFileOwnershipStore();
  const executionStore = new MemorySupervisorExecutionStore();
  const supervisor = new AgentSupervisorService(
    taskStore,
    fileStore,
    undefined,
    configService(),
  );
  const dispatcher = new WorkerDispatcherService(supervisor, executionStore);
  const gateway = new AgentGatewayService(supervisor, executionStore);

  const task = await supervisor.createTask({
    objective: 'Review supervised candidate',
    owner: 'backend',
    allowedPaths: [CHANGED_FILE, OTHER_ALLOWED_FILE],
    forbiddenActions: ['merge', 'deploy_production'],
    dependsOn: [],
    acceptance: ['candidate is verified'],
  });
  await supervisor.startTask(task.id);
  const dispatched = await dispatcher.dispatch(task.id);
  await dispatcher.markRunning(dispatched.execution.id);
  const completed = await dispatcher.complete(dispatched.execution.id, {
    summary: 'Candidate implemented',
    evidence: {
      rootCause: 'Known cause',
      changedFiles: [CHANGED_FILE],
      tests: ['PASS'],
      build: 'PASS',
      regression: ['PASS'],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'NO_INTEGRATION_PERFORMED',
      remainingRisk: [],
      ...(includeReviewCandidate ? { reviewCandidate: candidate() } : {}),
    },
  });
  await gateway.submitImplementationFromExecution(task.id, completed.id);
  await supervisor.beginVerification(task.id);
  await supervisor.markReadyForReview(task.id);

  return {
    task,
    completed,
    gateway,
    supervisor,
    taskStore,
    executionStore,
  };
}

describe('AgentGatewayService review candidate', () => {
  it('fails closed after review validation when exact owner merge authorization is missing', async () => {
    const { task, completed, gateway } = await makeReadyCandidate();

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate(),
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_required' },
    });
  });

  it('passes only after the owner authorizes the exact reviewed candidate', async () => {
    const { task, completed, gateway, supervisor } =
      await makeReadyCandidate();
    await supervisor.authorizeMerge(task.id, candidate(), 'owner-user-1');

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate(),
        explicitUserAuthorization: false,
      }),
    ).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: completed.id,
    });
  });

  it('rejects a different head SHA even when the task, execution, target, and file scope are otherwise valid', async () => {
    const { task, completed, gateway } = await makeReadyCandidate();

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate({ headSha: 'c'.repeat(40) }),
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'review_candidate_mismatch' },
    });
  });

  it('rejects a different changed-file set even when every file is inside the assignment scope', async () => {
    const { task, completed, gateway } = await makeReadyCandidate();

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate({ changedFiles: [OTHER_ALLOWED_FILE] }),
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'review_candidate_mismatch' },
    });
  });

  it('rejects a stale owner authorization after review evidence is consistently moved to a new head SHA', async () => {
    const {
      task,
      completed,
      gateway,
      supervisor,
      taskStore,
      executionStore,
    } = await makeReadyCandidate();
    await supervisor.authorizeMerge(task.id, candidate(), 'owner-user-1');

    const nextCandidate = candidate({ headSha: 'c'.repeat(40) });
    const persistedTask = await taskStore.get(task.id);
    persistedTask!.evidence!.reviewCandidate = nextCandidate;
    await taskStore.save(persistedTask!);
    const persistedExecution = await executionStore.get(completed.id);
    persistedExecution!.result!.evidence.reviewCandidate = nextCandidate;
    await executionStore.save(persistedExecution!);

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...nextCandidate,
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_mismatch' },
    });
  });

  it('rejects a stale owner authorization after review evidence is consistently moved to another allowed changed-file set', async () => {
    const {
      task,
      completed,
      gateway,
      supervisor,
      taskStore,
      executionStore,
    } = await makeReadyCandidate();
    await supervisor.authorizeMerge(task.id, candidate(), 'owner-user-1');

    const nextCandidate = candidate({ changedFiles: [OTHER_ALLOWED_FILE] });
    const persistedTask = await taskStore.get(task.id);
    persistedTask!.evidence!.changedFiles = [OTHER_ALLOWED_FILE];
    persistedTask!.evidence!.reviewCandidate = nextCandidate;
    await taskStore.save(persistedTask!);
    const persistedExecution = await executionStore.get(completed.id);
    persistedExecution!.result!.evidence.changedFiles = [OTHER_ALLOWED_FILE];
    persistedExecution!.result!.evidence.reviewCandidate = nextCandidate;
    await executionStore.save(persistedExecution!);

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...nextCandidate,
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_mismatch' },
    });
  });

  it('rejects a forged owner authorization even when its candidate fields match exactly', async () => {
    const { task, completed, gateway, taskStore } = await makeReadyCandidate();
    const persistedTask = await taskStore.get(task.id);
    persistedTask!.evidence!.ownerMergeAuthorization = {
      candidate: candidate(),
      authorizedBy: 'attacker',
      authorizedAt: '2026-09-01T00:00:00.000Z',
      signature: '0'.repeat(64),
    };
    await taskStore.save(persistedTask!);

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate(),
        explicitUserAuthorization: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_invalid' },
    });
  });

  it('fails closed for legacy evidence that never recorded an exact review candidate', async () => {
    const { task, completed, gateway } = await makeReadyCandidate(false);

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate(),
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'review_candidate_not_recorded' },
    });
  });
});
