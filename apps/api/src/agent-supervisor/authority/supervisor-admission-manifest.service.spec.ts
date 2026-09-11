import { createHash } from 'node:crypto';
import { canonicalizeAuthorityValue } from './supervisor-authority.service';

type AdmissionService = {
  createBinding(input: Record<string, unknown>): {
    manifestHash: string;
    claimEpoch: number;
    leaseId: string;
    runnerId: string;
  };
};

function loadService(): new () => AdmissionService {
  return require('./supervisor-admission-manifest.service')
    .SupervisorAdmissionManifestService;
}

function assignmentInput() {
  return {
    executionId: 'ATLAS-EXEC-20260911-test',
    taskId: 'ATLAS-TASK-20260911-test',
    workerRole: 'engineering',
    executionPurpose: 'IMPLEMENTATION',
    objective: 'R1 bootstrap admission remediation',
    allowedPaths: [
      'apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.ts',
    ],
    forbiddenActions: [
      'merge',
      'deploy_production',
    ],
    dependencies: [],
    acceptance: [
      'server-side immutable admission manifest',
    ],
    requiredEvidence: [
      'rootCause',
      'changedFiles',
      'tests',
    ],
  };
}

describe('SupervisorAdmissionManifestService', () => {
  it('creates a complete server-side execution authority binding', () => {
    const Service = loadService();
    const service = new Service();

    const binding = service.createBinding(assignmentInput());

    expect(binding.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(binding.claimEpoch).toBe(0);
    expect(binding.leaseId).toEqual(expect.any(String));
    expect(binding.leaseId.length).toBeGreaterThan(0);
    expect(binding.runnerId).toEqual(expect.any(String));
    expect(binding.runnerId.length).toBeGreaterThan(0);
  });

  it('hashes the exact immutable admission snapshot including server claim fields', () => {
    const Service = loadService();
    const service = new Service();

    const input = assignmentInput();
    const binding = service.createBinding(input);

    const expectedHash = createHash('sha256')
      .update(
        canonicalizeAuthorityValue({
          version: 1,
          ...input,
          claimEpoch: binding.claimEpoch,
          leaseId: binding.leaseId,
          runnerId: binding.runnerId,
        }),
        'utf8',
      )
      .digest('hex');

    expect(binding.manifestHash).toBe(expectedHash);
  });

  it('does not reuse a lease or runner slot across fresh admissions', () => {
    const Service = loadService();
    const service = new Service();

    const first = service.createBinding(assignmentInput());
    const second = service.createBinding(assignmentInput());

    expect(second.leaseId).not.toBe(first.leaseId);
    expect(second.runnerId).not.toBe(first.runnerId);
    expect(second.manifestHash).not.toBe(first.manifestHash);
  });
});
