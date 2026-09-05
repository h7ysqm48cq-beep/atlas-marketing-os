import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from '../agent-supervisor.service';
import type {
  ProductionDeploymentService,
  SupervisorReviewCandidate,
} from '../agent-supervisor.types';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const OWNER_TOKEN = 'service-binding-owner-token';
const CHANGED_FILE = 'apps/api/src/example.ts';

describe('Owner production deployment authorization service binding', () => {
  let supervisor: AgentSupervisorService;
  let taskStore: MemorySupervisorTaskStore;

  beforeEach(() => {
    taskStore = new MemorySupervisorTaskStore();
    const config = {
      get: jest.fn((key: string) =>
        key === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? OWNER_TOKEN : undefined,
      ),
    } as unknown as ConfigService;
    supervisor = new AgentSupervisorService(
      taskStore,
      new MemoryFileOwnershipStore(),
      undefined,
      config,
    );
  });

  async function readyTask() {
    const task = await supervisor.createTask({
      objective: 'Prepare production deployment authorization',
      owner: 'infra',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['service-bound authorization'],
    });
    await supervisor.startTask(task.id);
    const candidate: SupervisorReviewCandidate = {
      action: 'deploy_production',
      targetBranch: 'production/atlas',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFiles: [CHANGED_FILE],
    };
    await supervisor.submitImplementation(task.id, {
      rootCause: 'Deployment authorization was not service-bound',
      changedFiles: [CHANGED_FILE],
      tests: ['service binding'],
      build: 'PASS',
      regression: [],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'NO_INTEGRATION_PERFORMED',
      remainingRisk: [],
      reviewCandidate: candidate,
    });
    await supervisor.beginVerification(task.id);
    await supervisor.markReadyForReview(task.id);
    return { task, candidate };
  }

  async function authorize(
    taskId: string,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
  ) {
    const method = (
      supervisor as unknown as {
        authorizeProductionDeployment?: (...args: unknown[]) => Promise<unknown>;
      }
    ).authorizeProductionDeployment;
    expect(method).toEqual(expect.any(Function));
    await method!.call(
      supervisor,
      taskId,
      candidate,
      service,
      'owner-user-1',
    );
    return supervisor.getTask(taskId);
  }

  function assertAuthorization(
    task: Awaited<ReturnType<AgentSupervisorService['getTask']>>,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
  ) {
    const method = (
      supervisor as unknown as {
        assertOwnerDeploymentAuthorization?: (...args: unknown[]) => void;
      }
    ).assertOwnerDeploymentAuthorization;
    expect(method).toEqual(expect.any(Function));
    return method!.call(supervisor, task, candidate, service);
  }

  it('persists the authorized production service alongside the exact candidate', async () => {
    const { task, candidate } = await readyTask();
    const authorized = await authorize(task.id, candidate, 'api');

    expect(
      (
        authorized.evidence?.ownerDeploymentAuthorization as
          | { service?: string }
          | undefined
      )?.service,
    ).toBe('api');
  });

  it('rejects using a valid api authorization for another service', async () => {
    const { task, candidate } = await readyTask();
    const authorized = await authorize(task.id, candidate, 'api');

    expect(() => assertAuthorization(authorized, candidate, 'web')).toThrow();
    try {
      assertAuthorization(authorized, candidate, 'web');
    } catch (error) {
      expect(error).toMatchObject({
        response: { code: 'owner_deployment_authorization_service_mismatch' },
      });
    }
  });

  it('detects service tampering because service participates in the HMAC', async () => {
    const { task, candidate } = await readyTask();
    const authorized = await authorize(task.id, candidate, 'api');
    const authorization = authorized.evidence?.ownerDeploymentAuthorization as
      | ({ service?: ProductionDeploymentService } & Record<string, unknown>)
      | undefined;
    expect(authorization).toBeDefined();
    if (!authorization) return;

    authorization.service = 'web';
    const expectedUpdatedAt =
      new Date(authorized.updatedAt);

    authorized.updatedAt =
      new Date(
        expectedUpdatedAt.getTime() + 1,
      );

    await expect(
      taskStore.saveIfUnchanged(
        authorized,
        expectedUpdatedAt,
      ),
    ).resolves.not.toBeNull();
    const tampered = await supervisor.getTask(task.id);

    expect(() => assertAuthorization(tampered, candidate, 'web')).toThrow();
    try {
      assertAuthorization(tampered, candidate, 'web');
    } catch (error) {
      expect(error).toMatchObject({
        response: { code: 'owner_deployment_authorization_invalid' },
      });
    }
  });
});
