import { GUARDS_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { AgentSupervisorController } from './agent-supervisor.controller';
import { AgentSupervisorModule } from './agent-supervisor.module';
import { AgentSupervisorService } from './agent-supervisor.service';
import { WorkerDispatcherService } from './dispatch/worker-dispatcher.service';
import { SupervisorOwnerActionGuard } from './gateway/supervisor-owner-action.guard';
import { SupervisorOwnerGuard } from './gateway/supervisor-owner.guard';
import { MemoryFileOwnershipStore } from './stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from './stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from './stores/memory-supervisor-task.store';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';

describe('AgentSupervisorController', () => {
  let supervisor: AgentSupervisorService;
  let dispatcher: WorkerDispatcherService;
  let controller: AgentSupervisorController;

  beforeEach(() => {
    supervisor = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
    );
    dispatcher = new WorkerDispatcherService(
      supervisor,
      new MemorySupervisorExecutionStore(),
    );
    controller = new AgentSupervisorController(supervisor, dispatcher);
  });

  it('runs the trusted owner-action boundary before the existing owner guard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AgentSupervisorController,
    ) as unknown[];

    expect(guards).toEqual([SupervisorOwnerActionGuard, SupervisorOwnerGuard]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AgentSupervisorModule),
    ).toContain(SupervisorOwnerActionGuard);
  });

  it('creates merge authorization from authenticated request identity without accepting an approval boolean', async () => {
    const ownerConfig = {
      get: jest.fn((key: string) =>
        key === 'ATLAS_SUPERVISOR_OWNER_TOKEN'
          ? 'controller-owner-token'
          : undefined,
      ),
    } as unknown as ConfigService;
    const ownerSupervisor = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
      undefined,
      ownerConfig,
    );
    const ownerDispatcher = new WorkerDispatcherService(
      ownerSupervisor,
      new MemorySupervisorExecutionStore(),
    );
    const ownerController = new AgentSupervisorController(
      ownerSupervisor,
      ownerDispatcher,
    );
    const reviewCandidate = {
      action: 'merge' as const,
      targetBranch: 'production/atlas',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFiles: [CHANGED_FILE],
    };
    const task = await ownerSupervisor.createTask({
      objective: 'Authorize exact merge candidate',
      owner: 'backend',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['authorized only by owner'],
    });
    await ownerSupervisor.startTask(task.id);
    await ownerSupervisor.submitImplementation(task.id, {
      rootCause: 'Known cause',
      changedFiles: [CHANGED_FILE],
      tests: ['PASS'],
      build: 'PASS',
      regression: ['PASS'],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'NO_INTEGRATION_PERFORMED',
      remainingRisk: [],
      reviewCandidate,
    });
    await ownerSupervisor.beginVerification(task.id);
    await ownerSupervisor.markReadyForReview(task.id);

    const authorized = await ownerController.authorizeMerge(
      task.id,
      { candidate: reviewCandidate },
      { user: { id: 'authenticated-owner-id' } },
    );

    expect(authorized.evidence?.ownerMergeAuthorization).toMatchObject({
      candidate: reviewCandidate,
      authorizedBy: 'authenticated-owner-id',
    });
    expect(
      (
        ownerController as unknown as {
          authorizeMerge: (...args: unknown[]) => unknown;
        }
      ).authorizeMerge.length,
    ).toBe(3);
  });

  it('creates deployment authorization from authenticated owner identity without caller authority fields', async () => {
    const reviewCandidate = {
      action: 'deploy_production' as const,
      targetBranch: 'production/atlas',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFiles: [CHANGED_FILE],
    };
    const decision = { evidence: { ownerDeploymentAuthorization: {} } };
    const authorizeProductionDeployment = jest.fn().mockResolvedValue(decision);
    const ownerController = new AgentSupervisorController(
      { authorizeProductionDeployment } as unknown as AgentSupervisorService,
      {} as WorkerDispatcherService,
    ) as unknown as {
      authorizeProductionDeployment?: (
        id: string,
        body: Record<string, unknown>,
        request: { user?: { id?: string } },
      ) => Promise<unknown>;
    };

    expect(ownerController.authorizeProductionDeployment).toEqual(
      expect.any(Function),
    );
    if (!ownerController.authorizeProductionDeployment) return;
    await expect(
      ownerController.authorizeProductionDeployment(
        'ATLAS-DEPLOY-1',
        {
          candidate: reviewCandidate,
          service: 'api',
          explicitUserAuthorization: true,
          authorizedBy: 'caller-controlled-owner',
          signature: 'f'.repeat(64),
        },
        { user: { id: 'authenticated-owner-id' } },
      ),
    ).resolves.toBe(decision);
    expect(authorizeProductionDeployment).toHaveBeenCalledWith(
      'ATLAS-DEPLOY-1',
      reviewCandidate,
      'api',
      'authenticated-owner-id',
    );
  });

  it('revokes deployment authorization using authenticated owner identity only', async () => {
    const decision = {
      status: 'APPROVED',
      evidence: {
        ownerDeploymentAuthorization: undefined,
      },
    };

    const revokeProductionDeploymentAuthorization = jest
      .fn()
      .mockResolvedValue(decision);

    const ownerController = new AgentSupervisorController(
      {
        revokeProductionDeploymentAuthorization,
      } as unknown as AgentSupervisorService,
      {} as WorkerDispatcherService,
    ) as unknown as {
      revokeProductionDeploymentAuthorization?: (
        id: string,
        body: Record<string, unknown>,
        request: { user?: { id?: string } },
      ) => Promise<unknown>;
    };

    expect(ownerController.revokeProductionDeploymentAuthorization).toEqual(
      expect.any(Function),
    );

    if (!ownerController.revokeProductionDeploymentAuthorization) {
      return;
    }

    await expect(
      ownerController.revokeProductionDeploymentAuthorization(
        'ATLAS-DEPLOY-1',
        {
          reason: 'superseded candidate',
          revokedBy: 'caller-controlled-owner',
        },
        {
          user: {
            id: 'authenticated-owner-id',
          },
        },
      ),
    ).resolves.toBe(decision);

    expect(revokeProductionDeploymentAuthorization).toHaveBeenCalledWith(
      'ATLAS-DEPLOY-1',
      'superseded candidate',
      'authenticated-owner-id',
    );
  });

  it('dispatches a task without accepting role or permission overrides', async () => {
    const task = await supervisor.createTask({
      objective: 'Backend task',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['passes'],
    });
    await supervisor.startTask(task.id);

    const result = await controller.dispatchTask(task.id);

    expect(result.assignment.workerRole).toBe('backend');
    expect(result.assignment.forbiddenActions).toContain('merge');
  });

  it('lists execution history for a task', async () => {
    const task = await supervisor.createTask({
      objective: 'Backend task',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    });
    await supervisor.startTask(task.id);
    await dispatcher.dispatch(task.id);

    expect(await controller.listExecutions(task.id)).toHaveLength(1);
  });

  it('gets one execution by id', async () => {
    const task = await supervisor.createTask({
      objective: 'Backend task',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    });
    await supervisor.startTask(task.id);
    const dispatched = await dispatcher.dispatch(task.id);

    await expect(
      controller.getExecution(dispatched.execution.id),
    ).resolves.toEqual(dispatched.execution);
  });
});
