import { generateKeyPairSync } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import {
  InMemoryAuthorityKeyRegistry,
  SupervisorAuthorityService,
} from './supervisor-authority.service';
import {
  VerifierCapabilityService,
  type VerifierCapabilityInput,
} from './verifier-capability.service';

const NOW = new Date('2026-09-11T00:00:00.000Z');

function authority(): SupervisorAuthorityService {
  const fixture = () => {
    const pair = generateKeyPairSync('ed25519');
    return {
      privateKeyPem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      publicKeyPem: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    };
  };
  return new SupervisorAuthorityService({ get: jest.fn() } as never, new InMemoryAuthorityKeyRegistry({
    SUPERVISOR_SYSTEM: fixture(),
    WORKER_CAPABILITY: fixture(),
    VERIFIER_CAPABILITY: fixture(),
    MERGE_APPROVAL: fixture(),
    DEPLOY_APPROVAL: fixture(),
  }));
}

function input(): VerifierCapabilityInput {
  return {
    taskId: 'task-1',
    executionId: 'execution-1',
    manifestHash: 'a'.repeat(64),
    claimEpoch: 3,
    allowedPaths: ['apps/api/src/example.ts'],
    leaseId: 'lease-1',
    runnerId: 'verifier-1',
  };
}

describe('VerifierCapabilityService', () => {
  it('issues and authorizes only an independent verification capability', () => {
    const service = new VerifierCapabilityService(authority());
    const token = service.issue(input(), NOW);

    expect(
      service.authorize(token, {
        ...input(),
        operation: 'submit_verification',
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).toMatchObject({
      actorType: 'VERIFIER_EXECUTION',
      tokenType: 'VERIFIER_CAPABILITY',
      purpose: 'INDEPENDENT_VERIFICATION',
    });
  });

  it('authorizes heartbeat as an execution-bound verifier operation', () => {
    const service = new VerifierCapabilityService(authority());
    const token = service.issue(input(), NOW);

    expect(
      service.authorize(token, {
        ...input(),
        operation: 'heartbeat' as never,
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).toMatchObject({
      taskId: input().taskId,
      executionId: input().executionId,
      claimEpoch: input().claimEpoch,
      leaseId: input().leaseId,
      runnerId: input().runnerId,
      allowedActions: expect.arrayContaining(['heartbeat']),
    });
  });

  it('fails closed when the verifier binding is incomplete', () => {
    const service = new VerifierCapabilityService(authority());
    expect(() => service.issue({ ...input(), manifestHash: '' }, NOW)).toThrow(
      ForbiddenException,
    );
  });

  it('binds the verifier capability to the server-persisted actor claim', () => {
    const service = new VerifierCapabilityService(authority());
    const actor = {
      kid: 'kid-B', principalId: 'principal-B',
      controllingPrincipalId: 'operator-B', workerRole: 'engineering' as const,
      purposes: ['INDEPENDENT_VERIFICATION' as const],
      claimNonce: 'nonce-b', authenticatedAt: NOW.toISOString(),
    };
    const assigned = { ...input(), bootstrapActor: actor };
    const token = service.issue(assigned, NOW);
    const authorize = (overrides: object = {}) => service.authorize(token, {
      ...assigned, operation: 'submit_verification',
      now: new Date(NOW.getTime() + 1000), ...overrides,
    });
    expect(authorize().actorBindingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(() => authorize({ bootstrapActor: undefined }))
      .toThrow('verifier_capability_actor_binding_mismatch');
    expect(() => authorize({ bootstrapActor: {
      ...actor, controllingPrincipalId: 'other-operator',
    } })).toThrow('verifier_capability_actor_binding_mismatch');
    expect(() => authorize({ bootstrapActor: {
      ...actor, claimNonce: 'stale-claim',
    } })).toThrow('verifier_capability_actor_binding_mismatch');

    const legacyToken = service.issue(input(), NOW);
    expect(() => service.authorize(legacyToken, {
      ...assigned, operation: 'submit_verification',
      now: new Date(NOW.getTime() + 1000),
    })).toThrow('verifier_capability_actor_binding_mismatch');
  });

  it('rejects a forged actor claim for the wrong execution purpose', () => {
    const service = new VerifierCapabilityService(authority());
    expect(() => service.issue({ ...input(), bootstrapActor: {
      kid: 'kid-A', principalId: 'principal-A',
      controllingPrincipalId: 'operator-A', workerRole: 'engineering',
      purposes: ['IMPLEMENTATION'],
      claimNonce: 'nonce-a', authenticatedAt: NOW.toISOString(),
    } }, NOW)).toThrow('verifier_capability_actor_binding_invalid');
  });

  it('does not accept implementation mutation as a verifier operation', () => {
    const service = new VerifierCapabilityService(authority());
    const token = service.issue(input(), NOW);

    expect(() =>
      service.authorize(token, {
        ...input(),
        operation: 'submit_verification',
        now: new Date(NOW.getTime() + 1_000),
        allowedPaths: ['apps/api/src/other.ts'],
      }),
    ).toThrow('verifier_capability_scope_mismatch');
  });
});
