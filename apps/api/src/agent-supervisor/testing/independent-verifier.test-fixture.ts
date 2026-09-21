import { AgentSupervisorService } from '../agent-supervisor.service';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';

// TEST ONLY: synthetic actor metadata, no signed claim/completion proof.
// This fixture is NOT an independent verifier or production receipt.
const verifierStores = new WeakMap<
  AgentSupervisorService, MemorySupervisorExecutionStore
>();

export function testSupervisorWithVerifier(
  ...args: ConstructorParameters<typeof AgentSupervisorService>
): AgentSupervisorService {
  const store = new MemorySupervisorExecutionStore();
  const service = new AgentSupervisorService(
    args[0], args[1], args[2], args[3], args[4], args[5], store,
  );
  verifierStores.set(service, store);
  return service;
}

export function testOnlySeparatedExecutions(
  task: SupervisorTask, at = new Date(Math.max(
    Date.now(), task.updatedAt.getTime() + 1,
  )),
): [SupervisorExecution, SupervisorExecution] {
  if (!task.evidence) throw new Error('test_fixture_evidence_missing');
  const implementationId = 'TEST-ONLY-IMPLEMENTATION-' + task.id;
  const verifierId = 'TEST-ONLY-VERIFIER-' + task.id;
  const implementationTime = new Date(at.getTime() - 1);
  const claimActor = (purpose: 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION') => {
    const implementation = purpose === 'IMPLEMENTATION';
    return {
      kid: implementation ? 'TEST-IMPL-KID' : 'TEST-VERIFIER-KID',
      principalId: implementation ? 'TEST-IMPL-PRINCIPAL' : 'TEST-VERIFIER-PRINCIPAL',
      controllingPrincipalId: implementation ? 'TEST-IMPL-OWNER' : 'TEST-VERIFIER-OWNER',
      workerRole: task.owner,
      purposes: [purpose],
      authenticatedAt: implementationTime.toISOString(),
      claimNonce: implementation ? 'TEST-IMPL-NONCE' : 'TEST-VERIFIER-NONCE',
    };
  };
  const make = (
    id: string,
    purpose: 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION',
    date: Date,
  ): SupervisorExecution => ({
    id, taskId: task.id, workerRole: task.owner, status: 'COMPLETED',
    assignment: {
      executionId: id, taskId: task.id, workerRole: task.owner,
      executionPurpose: purpose,
      objective: 'TEST ONLY; NO AUTHENTIC CLAIM OR SIGNED ATTESTATION',
      allowedPaths: [...task.allowedPaths],
      forbiddenActions: [...task.forbiddenActions],
      dependencies: [...task.dependsOn],
      acceptance: [...task.acceptance],
      requiredEvidence: [],
      manifestHash: 'a'.repeat(64), claimEpoch: 1,
      leaseId: purpose === 'IMPLEMENTATION' ? 'TEST-IMPL-LEASE' : 'TEST-VERIFIER-LEASE',
      runnerId: purpose === 'IMPLEMENTATION' ? 'TEST-IMPL-RUNNER' : 'TEST-VERIFIER-RUNNER',
      bootstrapActor: claimActor(purpose),
    },
    result: { summary: 'TEST ONLY synthetic evidence', evidence: task.evidence! },
    error: null, createdAt: date, startedAt: date, completedAt: date,
    runnerId: purpose === 'IMPLEMENTATION' ? 'TEST-IMPL-RUNNER' : 'TEST-VERIFIER-RUNNER',
    claimEpoch: 1, lastHeartbeatAt: date, leaseExpiresAt: date,
  });
  return [
    make(implementationId, 'IMPLEMENTATION', implementationTime),
    make(verifierId, 'INDEPENDENT_VERIFICATION', at),
  ];
}

export async function completeTestOnlyVerifier(
  service: AgentSupervisorService,
  taskId: string,
): Promise<void> {
  const task = await service.getTask(taskId);
  if (task.status !== 'VERIFYING' || !task.evidence) {
    throw new Error('test_fixture_requires_verifying_evidence');
  }
  const store = verifierStores.get(service);
  if (!store) throw new Error('test_fixture_execution_store_missing');
  for (const execution of testOnlySeparatedExecutions(task)) {
    await store.create(execution);
  }
}
