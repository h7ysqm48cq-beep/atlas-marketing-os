import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from './agent-supervisor.service';
import type { SupervisorReviewCandidate } from './agent-supervisor.types';
import { MemoryFileOwnershipStore } from './stores/memory-file-ownership.store';
import { MemorySupervisorTaskStore } from './stores/memory-supervisor-task.store';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';
const OWNER_TOKEN = 'test-owner-token';

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

function ownerConfig() {
  return {
    get: jest.fn((key: string) =>
      key === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? OWNER_TOKEN : undefined,
    ),
  } as unknown as ConfigService;
}

function createOwnerService() {
  return new AgentSupervisorService(
    new MemorySupervisorTaskStore(),
    new MemoryFileOwnershipStore(),
    undefined,
    ownerConfig(),
  );
}

async function makeReadyTask(service: AgentSupervisorService) {
  const task = await service.createTask({
    objective: 'Owner authorization test',
    owner: 'backend',
    allowedPaths: [CHANGED_FILE],
    forbiddenActions: ['merge', 'deploy_production'],
    dependsOn: [],
    acceptance: ['passes'],
  });
  await service.startTask(task.id);
  await service.submitImplementation(task.id, {
    rootCause: 'Confirmed cause',
    changedFiles: [CHANGED_FILE],
    tests: ['PASS'],
    build: 'PASS',
    regression: ['PASS'],
    deploymentState: 'NOT_DEPLOYED',
    gitState: 'NO_INTEGRATION_PERFORMED',
    remainingRisk: [],
    reviewCandidate: candidate(),
  });
  await service.beginVerification(task.id);
  await service.markReadyForReview(task.id);
  return service.getTask(task.id);
}

describe('AgentSupervisorService', () => {
  let service: AgentSupervisorService;

  beforeEach(() => {
    service = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
    );
  });

  it('reports prisma persistence for the runtime supervisor', async () => {
    await expect(service.status()).resolves.toMatchObject({
      persistence: 'prisma',
    });
  });

  it('creates bounded tasks in DRAFT state with restart-safe ids', async () => {
    const task = await service.createTask({
      objective: 'Fix calendar image save',
      owner: 'frontend',
      allowedPaths: ['apps/web/src/components/Calendar.tsx'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['saved image survives reload'],
    });

    expect(task.id).toMatch(
      /^ATLAS-\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(task.status).toBe('DRAFT');
    expect(task.owner).toBe('frontend');
  });

  it('generates different task ids across fresh service instances', async () => {
    const first = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
    );
    const second = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
    );
    const input = {
      objective: 'Restart-safe task id',
      owner: 'backend' as const,
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    };

    const firstTask = await first.createTask(input);
    const secondTask = await second.createTask(input);

    expect(secondTask.id).not.toBe(firstTask.id);
  });

  it('rejects owners outside the worker role whitelist', async () => {
    await expect(
      service.createTask({
        objective: 'Invalid worker task',
        owner: 'unknown-worker' as never,
        allowedPaths: ['apps/api/src/example.ts'],
        forbiddenActions: [],
        dependsOn: [],
        acceptance: ['passes'],
      }),
    ).rejects.toMatchObject({
      response: { code: 'worker_owner_required' },
    });
  });

  it('blocks a second active task that wants the same mutable file with a conflict response', async () => {
    const first = await service.createTask({
      objective: 'First task',
      owner: 'frontend',
      allowedPaths: ['apps/web/src/components/ImageBrandEditor.tsx'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['first'],
    });
    const second = await service.createTask({
      objective: 'Second task',
      owner: 'frontend',
      allowedPaths: ['apps/web/src/components/ImageBrandEditor.tsx'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['second'],
    });

    await service.startTask(first.id);

    await expect(service.startTask(second.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('requires dependencies to be READY_FOR_REVIEW or APPROVED before starting', async () => {
    const upstream = await service.createTask({
      objective: 'Backend contract',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['contract exists'],
    });
    const downstream = await service.createTask({
      objective: 'Frontend integration',
      owner: 'frontend',
      allowedPaths: ['apps/web/src/example.tsx'],
      forbiddenActions: [],
      dependsOn: [upstream.id],
      acceptance: ['integration works'],
    });

    await expect(service.startTask(downstream.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('enforces worker-to-supervisor verification progression', async () => {
    const task = await service.createTask({
      objective: 'State progression',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    });

    await service.startTask(task.id);
    await service.submitImplementation(task.id, {
      rootCause: 'Confirmed cause',
      changedFiles: ['apps/api/src/example.ts'],
      tests: ['focused test PASS'],
      build: 'PASS',
      regression: ['adjacent PASS'],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'NO_INTEGRATION_PERFORMED',
      remainingRisk: [],
    });
    await service.beginVerification(task.id);
    const ready = await service.markReadyForReview(task.id);

    expect(ready.status).toBe('READY_FOR_REVIEW');
  });

  it('persists a signed owner merge authorization only for the exact reviewed candidate', async () => {
    const ownerService = createOwnerService();
    const task = await makeReadyTask(ownerService);

    const authorized = await ownerService.authorizeMerge(
      task.id,
      candidate(),
      'owner-user-1',
    );

    expect(authorized.evidence?.ownerMergeAuthorization).toMatchObject({
      candidate: candidate(),
      authorizedBy: 'owner-user-1',
    });
    expect(authorized.evidence?.ownerMergeAuthorization?.authorizedAt).toEqual(
      expect.any(String),
    );
    expect(authorized.evidence?.ownerMergeAuthorization?.signature).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it.each([
    candidate({ headSha: 'c'.repeat(40) }),
    candidate({ targetBranch: 'main' }),
    candidate({ action: 'deploy_production' }),
  ])('rejects owner authorization for a non-matching or non-canonical candidate', async (requested) => {
    const ownerService = createOwnerService();
    const task = await makeReadyTask(ownerService);

    await expect(
      ownerService.authorizeMerge(task.id, requested, 'owner-user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('strips worker-supplied owner authorization from implementation evidence', async () => {
    const ownerService = createOwnerService();
    const task = await ownerService.createTask({
      objective: 'Reject forged owner evidence',
      owner: 'backend',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['forged auth is stripped'],
    });
    await ownerService.startTask(task.id);

    const implemented = await ownerService.submitImplementation(task.id, {
      rootCause: 'Attempted forged evidence',
      changedFiles: [CHANGED_FILE],
      tests: ['PASS'],
      build: 'PASS',
      regression: ['PASS'],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'NO_INTEGRATION_PERFORMED',
      remainingRisk: [],
      reviewCandidate: candidate(),
      ownerMergeAuthorization: {
        candidate: candidate(),
        authorizedBy: 'attacker',
        authorizedAt: '2026-09-01T00:00:00.000Z',
        signature: '0'.repeat(64),
      },
    });

    expect(implemented.evidence?.ownerMergeAuthorization).toBeUndefined();
  });

  it('revokes owner merge authorization when a reviewed task returns to working', async () => {
    const ownerService = createOwnerService();
    const task = await makeReadyTask(ownerService);
    await ownerService.authorizeMerge(task.id, candidate(), 'owner-user-1');

    const working = await ownerService.returnToWorking(
      task.id,
      'candidate changed',
    );

    expect(working.status).toBe('WORKING');
    expect(working.evidence?.ownerMergeAuthorization).toBeUndefined();
  });

  it('denies protected git actions without explicit user authorization', () => {
    expect(
      service.checkPermission('supervisor', 'merge', {
        explicitUserAuthorization: false,
      }),
    ).toEqual({ allowed: false, reason: 'explicit_user_authorization_required' });

    expect(
      service.checkPermission('supervisor', 'merge', {
        explicitUserAuthorization: true,
      }),
    ).toEqual({ allowed: true, reason: null });
  });

  it('never lets workers perform protected integration actions', () => {
    expect(
      service.checkPermission('frontend', 'merge', {
        explicitUserAuthorization: true,
      }).allowed,
    ).toBe(false);
  });
});
