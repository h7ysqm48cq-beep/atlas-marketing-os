import type { ExecutionContext } from '@nestjs/common';
import { SupervisorWorkerBootstrapGuard } from './supervisor-worker-bootstrap.guard';
import { SupervisorWorkerBootstrapController } from './supervisor-worker-bootstrap.controller';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { mapExecutionRecord } from '../persistence/supervisor-persistence.mapper';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { AuthenticatedBootstrapActor } from './supervisor-bootstrap-actor-registry';

const tokenA = 'actor-credential-aaaaaaaaaaaaaaaaaaaaaaaa';
const tokenB = 'actor-credential-bbbbbbbbbbbbbbbbbbbbbbbb';
const tokenLegacy = 'legacy-credential-cccccccccccccccccccccccc';
const actors = [
  { kid: 'kid-A', principalId: 'principal-A',
    controllingPrincipalId: 'operator-A', workerRole: 'engineering',
    purposes: ['IMPLEMENTATION'], token: tokenA },
  { kid: 'kid-B', principalId: 'principal-B',
    controllingPrincipalId: 'operator-B', workerRole: 'engineering',
    purposes: ['INDEPENDENT_VERIFICATION'], token: tokenB },
];

function bootstrap(values: Record<string, string> = {}) {
  return new SupervisorWorkerBootstrapGuard({
    get: (name: string) => values[name],
  } as never);
}
function request(token: string, body: Record<string, unknown> = {}) {
  return { headers: { authorization: 'Bearer ' + token },
    body, supervisorWorkerBootstrapRole: undefined as string | undefined,
    supervisorAuthenticatedActor: undefined as AuthenticatedBootstrapActor | undefined };
}
function context(req: ReturnType<typeof request>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as never;
}
const config = { ATLAS_SUPERVISOR_WORKER_ACTORS_JSON: JSON.stringify(actors),
  ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN: tokenLegacy,
  ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_ROLE: 'engineering' };

function queued(): SupervisorExecution {
  const now = new Date('2026-09-21T00:00:00.000Z');
  return { id: 'exec-140', taskId: 'task-140', workerRole: 'engineering',
    status: 'QUEUED', assignment: {
      executionId: 'exec-140', taskId: 'task-140', workerRole: 'engineering',
      executionPurpose: 'IMPLEMENTATION', objective: 'actor claim', allowedPaths: ['x.ts'],
      forbiddenActions: [], dependencies: [], acceptance: [], requiredEvidence: [],
      manifestHash: 'a'.repeat(64), frozenBaseSha: 'b'.repeat(40),
    }, result: null, error: null, createdAt: now,
    startedAt: null, completedAt: null, runnerId: null,
    claimEpoch: 0, lastHeartbeatAt: null, leaseExpiresAt: null };
}

describe('Issue #140: registry credential -> atomic bootstrap claim (WIP)', () => {
  it('derives principal exclusively from configured credential, not body fields', async () => {
    const req = request(tokenA, { principalId: 'forged', kid: 'forged' });
    await expect(bootstrap(config).canActivate(context(req))).resolves.toBe(true);
    expect(req.supervisorWorkerBootstrapRole).toBe('engineering');
    expect(req.supervisorAuthenticatedActor).toMatchObject({
      kid: 'kid-A', principalId: 'principal-A',
      controllingPrincipalId: 'operator-A',
      purposes: ['IMPLEMENTATION'] });
    expect(JSON.stringify(req.supervisorAuthenticatedActor)).not.toContain(tokenA);
    expect(JSON.stringify(req.supervisorAuthenticatedActor)).not.toContain('forged');
  });

  it('does not attach an actor for legacy role-only credentials', async () => {
    const req = request(tokenLegacy, { principalId: 'forged' });
    await expect(bootstrap(config).canActivate(context(req))).resolves.toBe(true);
    expect(req.supervisorWorkerBootstrapRole).toBe('engineering');
    expect(req.supervisorAuthenticatedActor).toBeUndefined();
  });

  it('rejects duplicate actor/legacy secrets and malformed registry', async () => {
    const req = request(tokenA);
    const duplicate = JSON.stringify([{ ...actors[0], token: tokenLegacy }]);
    await expect(bootstrap({ ...config,
      ATLAS_SUPERVISOR_WORKER_ACTORS_JSON: duplicate,
    }).canActivate(context(req))).rejects
      .toThrow('worker_bootstrap_tokens_not_separated');
    await expect(bootstrap({ ...config,
      ATLAS_SUPERVISOR_WORKER_ACTORS_JSON: '{invalid-json',
    }).canActivate(context(req))).rejects
      .toThrow('worker_actor_registry_invalid');
    await expect(bootstrap({ ...config,
      ATLAS_SUPERVISOR_WORKER_ACTORS_JSON: JSON.stringify([actors[0], actors[0]]),
    }).canActivate(context(req))).rejects
      .toThrow('worker_actor_registry_invalid');
  });

  it('enforces role and purpose before any store claim', async () => {
    const claimNext = jest.fn().mockResolvedValue(null);
    const controller = new SupervisorWorkerBootstrapController(
      { claimNext } as never, {} as never, {} as never, {} as never);
    const req = request(tokenA);
    await bootstrap(config).canActivate(context(req));
    await expect(controller.claimNext(req as never, {
      executionPurpose: 'INDEPENDENT_VERIFICATION',
    })).rejects.toThrow('worker_actor_claim_purpose_denied');
    expect(claimNext).not.toHaveBeenCalled();
  });

  it('passes server-authenticated binding into claim with fresh nonce', async () => {
    const claimNext = jest.fn().mockResolvedValue(null);
    const controller = new SupervisorWorkerBootstrapController(
      { claimNext } as never, {} as never, {} as never, {} as never);
    const req = request(tokenA, { principalId: 'forged', claimNonce: 'forged' });
    await bootstrap(config).canActivate(context(req));
    await controller.claimNext(req as never, { executionPurpose: 'IMPLEMENTATION' });
    expect(claimNext).toHaveBeenCalledTimes(1);
    const claim = claimNext.mock.calls[0][0];
    expect(claim.bootstrapActor).toMatchObject({ kid: 'kid-A',
      principalId: 'principal-A', claimNonce: expect.any(String),
      authenticatedAt: expect.any(String) });
    expect(claim.bootstrapActor.claimNonce).not.toBe('forged');
    expect(claim.bootstrapActor).not.toHaveProperty('token');
  });

  it('persists the new claim identity; mapper does not silently drop it', async () => {
    const store = new MemorySupervisorExecutionStore();
    await store.create(queued());
    const actor = { kid: 'kid-A', principalId: 'principal-A',
      controllingPrincipalId: 'operator-A', workerRole: 'engineering' as const,
      purposes: ['IMPLEMENTATION' as const], claimNonce: 'nonce-one',
      authenticatedAt: '2026-09-21T00:01:00.000Z' };
    const claimed = await store.claimNext({
      workerRole: 'engineering', executionPurpose: 'IMPLEMENTATION',
      runnerId: 'runner-one', leaseId: 'lease-one',
      now: new Date('2026-09-21T00:01:00.000Z'),
      leaseExpiresAt: new Date('2026-09-21T00:02:00.000Z'),
      bootstrapActor: actor,
    });
    expect(claimed?.assignment.bootstrapActor).toEqual(actor);
    const mapped = mapExecutionRecord({
      ...claimed!, assignment: JSON.parse(JSON.stringify(claimed!.assignment)),
    });
    expect(mapped.assignment.bootstrapActor).toEqual(actor);
    expect(JSON.stringify(mapped)).not.toContain(tokenA);
    await expect(Promise.resolve().then(() => mapExecutionRecord({
      ...claimed!, assignment: { ...claimed!.assignment,
        bootstrapActor: { ...actor, token: tokenA } },
    }))).rejects.toMatchObject({
      response: { code: 'supervisor_persistence_error' },
    });
  });

  it('never carries a stale actor claim into a legacy reclaim', async () => {
    const store = new MemorySupervisorExecutionStore();
    const previous = queued();
    previous.assignment.bootstrapActor = {
      kid: 'stale', principalId: 'stale', controllingPrincipalId: 'stale',
      workerRole: 'engineering', purposes: ['IMPLEMENTATION'],
      authenticatedAt: new Date().toISOString(), claimNonce: 'stale-nonce',
    };
    await store.create(previous);
    const result = await store.claimNext({
      workerRole: 'engineering', executionPurpose: 'IMPLEMENTATION',
      runnerId: 'new-runner', leaseId: 'new-lease', now: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60000),
    });
    expect(result?.assignment.bootstrapActor).toBeUndefined();
  });
});
