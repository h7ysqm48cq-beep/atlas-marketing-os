import { SupervisorAdmissionManifestService } from '../authority/supervisor-admission-manifest.service';
import { issueWorkerExactClaimOffer } from '../verification/worker-exact-claim-offer';
import { WorkerDispatcherService } from './worker-dispatcher.service';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const PATH = 'apps/api/src/example.ts';
const NOW = new Date('2026-09-22T00:00:00.000Z');
const candidate = {
  action: 'merge', targetBranch: 'production/atlas',
  baseSha: BASE, headSha: HEAD, changedFiles: [PATH],
};
const actor = {
  kid: 'signed-verifier-key', principalId: 'signed-verifier',
  controllingPrincipalId: 'independent-custodian',
  workerRole: 'engineering' as const,
  purposes: ['INDEPENDENT_VERIFICATION' as const],
};
function harness(
  purpose: 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION',
  overrides: Record<string, unknown> = {},
) {
  const task = {
    id: 'TASK-ISSUE140-FROZEN', status: purpose === 'IMPLEMENTATION'
      ? 'WORKING' : 'VERIFYING',
    owner: 'engineering', objective: 'freeze signed candidate',
    allowedPaths: [PATH], forbiddenActions: [], dependsOn: [],
    acceptance: [], createdAt: NOW, updatedAt: NOW,
    evidence: { changedFiles: [PATH], reviewCandidate: candidate },
    ...overrides,
  };
  const supervisor = {
    getTask: jest.fn().mockResolvedValue(task),
    dependenciesReady: jest.fn().mockResolvedValue(true),
    ownsAllowedPaths: jest.fn().mockResolvedValue(true),
    checkPermission: jest.fn().mockReturnValue({ allowed: true, reason: null }),
  };
  const store = {
    listByTask: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async execution => execution),
  };
  const dispatcher = new WorkerDispatcherService(
    supervisor as never, store as never, undefined as never,
    new SupervisorAdmissionManifestService(),
    { get: (name: string) => name ===
      'ATLAS_SUPERVISOR_SIGNED_ATTESTATION_MODE'
      ? 'required' : undefined } as never,
  );
  return { task, store, dispatcher };
}
describe('Issue #140 actual dispatcher -> exact signed claim compatibility', () => {
  it('refuses implementation without a signed-claim frozen base', async () => {
    const { task, store, dispatcher } = harness('IMPLEMENTATION');
    await expect(dispatcher.dispatch(task.id, 'IMPLEMENTATION'))
      .rejects.toThrow('signed_implementation_frozen_base_required');
    expect(store.create).not.toHaveBeenCalled();
  });
  it('uses normalized implementation base in signed admission manifest', async () => {
    const { task, dispatcher } = harness('IMPLEMENTATION');
    const queued = await dispatcher.dispatch(task.id, 'IMPLEMENTATION', {
      frozenBaseSha: BASE.toUpperCase(),
    });
    expect(queued.assignment.frozenBaseSha).toBe(BASE);
    expect(queued.assignment.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('server derives verifier frozen base from persisted candidate, not caller', async () => {
    const { task, dispatcher } = harness('INDEPENDENT_VERIFICATION');
    const queued = await dispatcher.dispatch(
      task.id, 'INDEPENDENT_VERIFICATION',
    );
    expect(queued.assignment.frozenBaseSha).toBe(BASE);
    expect(queued.assignment.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    const offer = issueWorkerExactClaimOffer({
      actor, task: task as never, execution: queued.execution,
      purpose: 'INDEPENDENT_VERIFICATION',
      runnerId: 'server-runner', leaseId: 'server-lease', now: NOW,
    });
    expect(offer.claimBinding.frozenBaseSha).toBe(BASE);
    expect(offer.claimBinding.executionId).toBe(queued.execution.id);
  });
  it('never accepts a caller-picked verifier frozen base', async () => {
    const { task, store, dispatcher } = harness('INDEPENDENT_VERIFICATION');
    await expect(dispatcher.dispatch(
      task.id, 'INDEPENDENT_VERIFICATION',
      { frozenBaseSha: BASE },
    )).rejects.toThrow('frozen_base_sha_not_allowed_for_verification');
    expect(store.create).not.toHaveBeenCalled();
  });
  it('refuses verifier when persisted candidate is absent or not frozen', async () => {
    for (const evidence of [
      { changedFiles: [PATH] },
      { changedFiles: [PATH], reviewCandidate: { ...candidate,
        baseSha: 'not-a-SHA' } },
      { changedFiles: [PATH], reviewCandidate: { ...candidate,
        headSha: 'not-a-SHA' } },
      { changedFiles: [PATH], reviewCandidate: { ...candidate,
        changedFiles: ['different.ts'] } },
      { changedFiles: [PATH], reviewCandidate: { ...candidate,
        targetBranch: 'other/branch' } },
    ]) {
      const { task, store, dispatcher } = harness(
        'INDEPENDENT_VERIFICATION', { evidence },
      );
      await expect(dispatcher.dispatch(
        task.id, 'INDEPENDENT_VERIFICATION',
      )).rejects.toThrow('signed_verifier_frozen_candidate_required');
      expect(store.create).not.toHaveBeenCalled();
    }
  });
});
