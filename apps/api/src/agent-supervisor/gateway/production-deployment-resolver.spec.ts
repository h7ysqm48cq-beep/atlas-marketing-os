import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { AgentGatewayService } from './agent-gateway.service';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';
const OWNER_TOKEN = 'resolver-owner-token';
const CANONICAL_GITHUB = {
  repositoryOwner: 'h7ysqm48cq-beep',
  repositoryName: 'atlas-marketing-os',
  branch: 'production/atlas',
  commitSha: HEAD_SHA,
};

describe('Production deployment resolver', () => {
  let supervisor: AgentSupervisorService;
  let dispatcher: WorkerDispatcherService;
  let executionStore: MemorySupervisorExecutionStore;
  let gateway: AgentGatewayService;

  beforeEach(() => {
    const taskStore = new MemorySupervisorTaskStore();
    const fileStore = new MemoryFileOwnershipStore();
    executionStore = new MemorySupervisorExecutionStore();
    const config = {
      get: jest.fn((key: string) =>
        key === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? OWNER_TOKEN : undefined,
      ),
    } as unknown as ConfigService;
    supervisor = new AgentSupervisorService(
      taskStore,
      fileStore,
      undefined,
      config,
    );
    dispatcher = new WorkerDispatcherService(supervisor, executionStore);
    gateway = new AgentGatewayService(supervisor, executionStore);
  });

  async function createApprovedDeployment(service: 'api' | 'web' | 'browser-worker' = 'api') {
    const task = await supervisor.createTask({
      objective: `Authorize exact ${service} production deployment`,
      owner: 'infra',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['production deployment resolver passes'],
    });
    await supervisor.startTask(task.id);
    const dispatched = await dispatcher.dispatch(task.id);
    const running = await dispatcher.markRunning(dispatched.execution.id);
    const reviewCandidate = {
      action: 'deploy_production' as const,
      targetBranch: 'production/atlas',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFiles: [CHANGED_FILE],
    };
    const completed = await dispatcher.complete(running.id, {
      summary: 'Prepared exact deployment receipt',
      evidence: {
        rootCause: 'Railway requires automatic Supervisor receipt resolution',
        changedFiles: [CHANGED_FILE],
        tests: ['resolver contract'],
        build: 'PASS',
        regression: [],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'NO_INTEGRATION_PERFORMED',
        remainingRisk: [],
        reviewCandidate,
      },
    });
    await gateway.submitImplementationFromExecution(task.id, completed.id);
    await supervisor.beginVerification(task.id);
    await supervisor.markReadyForReview(task.id);

    const authorize = (
      supervisor as unknown as {
        authorizeProductionDeployment?: (...args: unknown[]) => Promise<unknown>;
      }
    ).authorizeProductionDeployment;
    expect(authorize).toEqual(expect.any(Function));
    await authorize!.call(
      supervisor,
      task.id,
      reviewCandidate,
      service,
      'owner-user-1',
    );
    await supervisor.approveTask(task.id, true);
    return { task: await supervisor.getTask(task.id), execution: completed };
  }

  function resolve(input: unknown) {
    const contract = gateway as unknown as {
      resolveProductionDeployment?: (value: unknown) => Promise<unknown>;
    };
    expect(contract.resolveProductionDeployment).toEqual(expect.any(Function));
    return contract.resolveProductionDeployment!(input);
  }

  it('resolves the unique approved service-bound receipt from canonical provenance', async () => {
    const { task, execution } = await createApprovedDeployment('api');

    await expect(
      resolve({ service: 'api', github: CANONICAL_GITHUB }),
    ).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: execution.id,
    });
  });

  it('rejects when no approved deployment receipt matches the provenance', async () => {
    await expect(
      resolve({ service: 'api', github: CANONICAL_GITHUB }),
    ).rejects.toMatchObject({
      response: { code: 'production_deployment_resolution_not_found' },
    });
  });

  it('rejects ambiguous matching deployment tasks instead of choosing one', async () => {
    await createApprovedDeployment('api');
    await createApprovedDeployment('api');

    await expect(
      resolve({ service: 'api', github: CANONICAL_GITHUB }),
    ).rejects.toMatchObject({
      response: { code: 'production_deployment_resolution_ambiguous' },
    });
  });

  it('does not reuse an api deployment authorization for web', async () => {
    await createApprovedDeployment('api');

    await expect(
      resolve({ service: 'web', github: CANONICAL_GITHUB }),
    ).rejects.toMatchObject({
      response: { code: 'owner_deployment_authorization_service_mismatch' },
    });
  });

  it('rejects duplicate matching completed executions instead of picking one', async () => {
    const { execution } = await createApprovedDeployment('api');
    await executionStore.create({
      ...execution,
      id: `${execution.id}-duplicate`,
      createdAt: new Date(execution.createdAt.getTime() + 1),
      completedAt: execution.completedAt
        ? new Date(execution.completedAt.getTime() + 1)
        : new Date(),
    });

    await expect(
      resolve({ service: 'api', github: CANONICAL_GITHUB }),
    ).rejects.toMatchObject({
      response: { code: 'production_deployment_resolution_ambiguous' },
    });
  });

  it('rejects noncanonical provenance before resolving a receipt', async () => {
    await createApprovedDeployment('api');

    await expect(
      resolve({
        service: 'api',
        github: { ...CANONICAL_GITHUB, branch: 'feature/not-production' },
      }),
    ).rejects.toMatchObject({
      response: { code: 'canonical_production_branch_required' },
    });
  });
});
