import { generateKeyPairSync } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import {
  InMemoryAuthorityKeyRegistry,
  SupervisorAuthorityService,
} from './supervisor-authority.service';
import {
  SupervisorAdmissionManifestService,
  type SupervisorAdmissionManifestInput,
} from './supervisor-admission-manifest.service';
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
    candidateHeadSha: 'b'.repeat(40),
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

  it('binds scope through the immutable admission manifest hash', () => {
    const admission = new SupervisorAdmissionManifestService();
    const base = {
      executionId: 'execution-1',
      taskId: 'task-1',
      workerRole: 'engineering' as const,
      executionPurpose: 'INDEPENDENT_VERIFICATION' as const,
      objective: 'Verify exact candidate',
      forbiddenActions: ['merge'],
      dependencies: [],
      acceptance: ['exact scope'],
      requiredEvidence: [],
    };

    const firstInput: SupervisorAdmissionManifestInput = {
      ...base,
      allowedPaths: ['apps/api/src/example.ts'],
    };
    const secondInput: SupervisorAdmissionManifestInput = {
      ...base,
      allowedPaths: ['apps/api/src/other.ts'],
    };
    const first = admission.createBinding(firstInput);
    const second = admission.createBinding(secondInput);

    expect(second.manifestHash).not.toBe(first.manifestHash);
  });

  it('rejects heartbeat, fail, and submit verification when manifest authority drifts', () => {
    const service = new VerifierCapabilityService(authority());
    const token = service.issue(input(), NOW);

    for (const operation of ['heartbeat', 'fail', 'submit_verification'] as const) {
      expect(() =>
        service.authorize(token, {
          ...input(),
          manifestHash: 'f'.repeat(64),
          operation,
          now: new Date(NOW.getTime() + 1_000),
        }),
      ).toThrow();
    }
  });

  it('keeps verifier capability size bounded for a 381-path assignment', () => {
    const service = new VerifierCapabilityService(authority());
    const small = service.issue(input(), NOW);
    const large = service.issue({
      ...input(),
      allowedPaths: Array.from(
        { length: 381 },
        (_, index) => 'apps/api/src/generated/path-' + index + '.ts',
      ),
    }, NOW);

    expect(Math.abs(large.length - small.length)).toBeLessThan(256);
    expect(large.length).toBeLessThan(8_000);
  });

  it('rejects immutable candidate head drift', () => {
    const service = new VerifierCapabilityService(authority());
    const token = service.issue(input(), NOW);
    expect(() => service.authorize(token, {
      ...input(), candidateHeadSha: 'c'.repeat(40),
      operation: 'read_assignment', now: new Date(NOW.getTime() + 1_000),
    })).toThrow('verifier_capability_candidate_mismatch');
  });
});
