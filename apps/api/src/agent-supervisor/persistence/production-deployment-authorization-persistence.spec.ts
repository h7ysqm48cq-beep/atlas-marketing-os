import { mapTaskRecord } from './supervisor-persistence.mapper';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const SIGNATURE = 'c'.repeat(64);

function record(ownerDeploymentAuthorization: unknown) {
  const candidate = {
    action: 'deploy_production',
    targetBranch: 'production/atlas',
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    changedFiles: ['apps/api/src/example.ts'],
  };
  return {
    id: 'ATLAS-20260902-persistence',
    objective: 'Persist service-bound deployment authorization',
    owner: 'infra',
    status: 'APPROVED',
    allowedPaths: ['apps/api/src/example.ts'],
    forbiddenActions: ['merge'],
    dependsOn: [],
    acceptance: ['service binding'],
    evidence: {
      rootCause: 'Deployment authorization service was not persisted',
      changedFiles: ['apps/api/src/example.ts'],
      tests: ['persistence mapping'],
      build: 'PASS',
      regression: [],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'NO_INTEGRATION_PERFORMED',
      remainingRisk: [],
      reviewCandidate: candidate,
      ownerDeploymentAuthorization,
    },
    blockingReason: null,
    failureReason: null,
    createdAt: new Date('2026-09-02T00:00:00.000Z'),
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
  };
}

function authorization(service: unknown = 'api') {
  return {
    candidate: {
      action: 'deploy_production',
      targetBranch: 'production/atlas',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFiles: ['apps/api/src/example.ts'],
    },
    service,
    authorizedBy: 'owner-user-1',
    authorizedAt: '2026-09-02T00:00:00.000Z',
    signature: SIGNATURE,
  };
}

describe('production deployment authorization persistence', () => {
  it('round-trips the authorized production service', () => {
    const task = mapTaskRecord(record(authorization()));

    expect(
      (
        task.evidence?.ownerDeploymentAuthorization as
          | { service?: string }
          | undefined
      )?.service,
    ).toBe('api');
  });

  it.each([undefined, 'unknown-service']) (
    'fails closed for invalid persisted deployment service %p',
    (service) => {
      const value = authorization(service);
      if (service === undefined) delete (value as { service?: unknown }).service;

      expect(() => mapTaskRecord(record(value))).toThrow();
      try {
        mapTaskRecord(record(value));
      } catch (error) {
        expect(error).toMatchObject({
          response: { code: 'supervisor_persistence_error' },
        });
      }
    },
  );
});
