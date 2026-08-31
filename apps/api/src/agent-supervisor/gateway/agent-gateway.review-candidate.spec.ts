import { AgentSupervisorService } from '../agent-supervisor.service';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { AgentGatewayService } from './agent-gateway.service';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';
const OTHER_ALLOWED_FILE = 'apps/api/src/other.ts';

async function makeReadyCandidate(includeReviewCandidate = true) {
  const taskStore = new MemorySupervisorTaskStore();
  const fileStore = new MemoryFileOwnershipStore();
  const executionStore = new MemorySupervisorExecutionStore();
  const supervisor = new AgentSupervisorService(taskStore, fileStore);
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
      ...(includeReviewCandidate
        ? {
            reviewCandidate: {
              action: 'merge' as const,
              targetBranch: 'production/atlas',
              baseSha: BASE_SHA,
              headSha: HEAD_SHA,
              changedFiles: [CHANGED_FILE],
            },
          }
        : {}),
    },
  });
  await gateway.submitImplementationFromExecution(task.id, completed.id);
  await supervisor.beginVerification(task.id);
  await supervisor.markReadyForReview(task.id);

  return { task, completed, gateway };
}

describe('AgentGatewayService review candidate', () => {
  it('validates the exact persisted READY_FOR_REVIEW canonical candidate without fabricating merge authorization', async () => {
    const { task, completed, gateway } = await makeReadyCandidate();

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        changedFiles: [CHANGED_FILE],
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
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: BASE_SHA,
        headSha: 'c'.repeat(40),
        changedFiles: [CHANGED_FILE],
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
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        changedFiles: [OTHER_ALLOWED_FILE],
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'review_candidate_mismatch' },
    });
  });

  it('fails closed for legacy evidence that never recorded an exact review candidate', async () => {
    const { task, completed, gateway } = await makeReadyCandidate(false);

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        changedFiles: [CHANGED_FILE],
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'review_candidate_not_recorded' },
    });
  });
});
