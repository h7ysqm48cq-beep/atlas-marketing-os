import { AgentSupervisorService } from '../agent-supervisor.service';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { AgentGatewayService } from './agent-gateway.service';

describe('AgentGatewayService review candidate', () => {
  it('validates a READY_FOR_REVIEW canonical candidate without fabricating merge authorization', async () => {
    const taskStore = new MemorySupervisorTaskStore();
    const fileStore = new MemoryFileOwnershipStore();
    const executionStore = new MemorySupervisorExecutionStore();
    const supervisor = new AgentSupervisorService(taskStore, fileStore);
    const dispatcher = new WorkerDispatcherService(supervisor, executionStore);
    const gateway = new AgentGatewayService(supervisor, executionStore);

    const task = await supervisor.createTask({
      objective: 'Review supervised candidate',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
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
        changedFiles: ['apps/api/src/example.ts'],
        tests: ['PASS'],
        build: 'PASS',
        regression: ['PASS'],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'NO_INTEGRATION_PERFORMED',
        remainingRisk: [],
      },
    });
    await gateway.submitImplementationFromExecution(task.id, completed.id);
    await supervisor.beginVerification(task.id);
    await supervisor.markReadyForReview(task.id);

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        changedFiles: ['apps/api/src/example.ts'],
        explicitUserAuthorization: false,
      }),
    ).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: completed.id,
    });
  });
});
