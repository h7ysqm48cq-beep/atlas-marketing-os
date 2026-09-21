import { generateKeyPairSync, sign } from 'node:crypto';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { AuthenticatedBootstrapActor } from '../worker/supervisor-bootstrap-actor-registry';
import { canonicalizeAuthorityValue } from '../authority/supervisor-authority.service';
import type { TrustedActorRegistry } from './actor-provenance';
import { workerPreclaimSignablePayload } from './worker-preclaim-proof';
import { ACTOR_ATTESTATION_DOMAIN } from './signed-execution-attestation';
import {
  issueWorkerExactClaimOffer, verifyWorkerExactClaimOffer,
} from './worker-exact-claim-offer';

const NOW = new Date('2026-09-22T00:40:00.000Z');
const kid = 'registered-worker-A';
function fixture() {
  const pair = generateKeyPairSync('ed25519');
  const actor: AuthenticatedBootstrapActor = {
    kid, principalId: 'principal-A',
    controllingPrincipalId: 'owner-A',
    workerRole: 'engineering',
    purposes: ['INDEPENDENT_VERIFICATION'],
  };
  const task: SupervisorTask = {
    id: 'task-140-offer', status: 'VERIFYING', owner: 'engineering',
    objective: 'exact claim offer test', allowedPaths: ['x.ts'],
    forbiddenActions: [], dependsOn: [], acceptance: [],
    evidence: null, blockingReason: null, failureReason: null,
    createdAt: new Date(NOW.getTime() - 1000), updatedAt: NOW,
  };
  const execution: SupervisorExecution = {
    id: 'execution-140-offer', taskId: task.id,
    workerRole: 'engineering', status: 'QUEUED',
    assignment: {
      executionId: 'execution-140-offer', taskId: task.id,
      workerRole: 'engineering',
      executionPurpose: 'INDEPENDENT_VERIFICATION',
      objective: 'verify frozen head',
      allowedPaths: ['x.ts'], forbiddenActions: [],
      dependencies: [], acceptance: [], requiredEvidence: [],
      manifestHash: 'c'.repeat(64), frozenBaseSha: 'a'.repeat(40),
    },
    result: null, error: null,
    createdAt: task.createdAt, startedAt: null, completedAt: null,
    runnerId: null, claimEpoch: 0,
    lastHeartbeatAt: null, leaseExpiresAt: null,
  };
  const expected = issueWorkerExactClaimOffer({
    actor, task, execution, purpose: 'INDEPENDENT_VERIFICATION',
    runnerId: 'runner-reserved-123', leaseId: 'lease-reserved-123',
    now: NOW,
  });
  const preclaimProof = {
    kid, challengeId: expected.challenge.id,
    signature: sign(null, Buffer.from(
      workerPreclaimSignablePayload(expected.challenge),
    ), pair.privateKey).toString('base64url'),
  };
  const claimProof = {
    kid, binding: expected.claimBinding,
    signature: sign(null, Buffer.from(canonicalizeAuthorityValue({
      domain: ACTOR_ATTESTATION_DOMAIN.claim,
      kid, binding: expected.claimBinding,
    })), pair.privateKey).toString('base64url'),
  };
  const registry: TrustedActorRegistry = { resolve: keyId =>
    keyId === kid ? {
      kid, principalId: actor.principalId,
      controllingPrincipalId: actor.controllingPrincipalId,
      publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' })
        .toString(),
      status: 'ACTIVE',
      permittedPurposes: ['INDEPENDENT_VERIFICATION'],
    } : null };
  const input = {
    actor, task, execution, expected, preclaimProof, claimProof, registry,
    now: new Date(NOW.getTime() + 1000),
  };
  return { input, pair };
}
const deny = (run: () => void) =>
  expect(run).toThrow('worker_exact_claim_offer_required');

describe('Issue #140 exact preclaim execution offer (offline, no DB CAS)', () => {
  it('validates actual worker signatures over server-reserved execution/epoch/runner/lease', () => {
    const { input } = fixture();
    expect(input.expected.claimBinding).toMatchObject({
      taskId: input.task.id, executionId: input.execution.id,
      claimEpoch: 1, runnerId: 'runner-reserved-123',
      leaseId: 'lease-reserved-123',
      authenticatedAt: input.expected.challenge.issuedAt,
      claimNonce: input.expected.challenge.nonce,
    });
    expect(() => verifyWorkerExactClaimOffer(input)).not.toThrow();
  });
  it('does not permit claim offers for mismatched or non-QUEUED execution', () => {
    const { input } = fixture();
    for (const status of ['RUNNING', 'FAILED'] as const) {
      deny(() => issueWorkerExactClaimOffer({
        actor: input.actor, task: input.task,
        execution: { ...input.execution, status },
        purpose: 'INDEPENDENT_VERIFICATION',
        runnerId: 'r', leaseId: 'l', now: NOW,
      }));
    }
  });
  it('rejects replacement of chosen execution and any claim epoch drift', () => {
    const { input } = fixture();
    deny(() => verifyWorkerExactClaimOffer({ ...input,
      execution: { ...input.execution, id: 'other-execution' },
    }));
    deny(() => verifyWorkerExactClaimOffer({ ...input,
      execution: { ...input.execution, claimEpoch: 1 },
    }));
  });
  it('rejects edited original assignment and immutable frozen base SHA', () => {
    const { input } = fixture();
    deny(() => verifyWorkerExactClaimOffer({ ...input,
      execution: { ...input.execution, assignment: {
        ...input.execution.assignment, objective: 'changed after offer',
      } },
    }));
    deny(() => verifyWorkerExactClaimOffer({ ...input,
      execution: { ...input.execution, assignment: {
        ...input.execution.assignment, frozenBaseSha: 'b'.repeat(40),
      } },
    }));
  });
  it('rejects task-version drift, task status drift and role changes', () => {
    const { input } = fixture();
    deny(() => verifyWorkerExactClaimOffer({ ...input, task: {
      ...input.task, updatedAt: new Date(NOW.getTime() + 2),
    } }));
    deny(() => verifyWorkerExactClaimOffer({ ...input, task: {
      ...input.task, status: 'READY_FOR_REVIEW',
    } }));
    deny(() => verifyWorkerExactClaimOffer({ ...input,
      actor: { ...input.actor, workerRole: 'backend' },
    }));
  });
  it('rejects attacker-supplied claimNonce, runner, lease or manifest', () => {
    for (const field of ['claimNonce', 'runnerId', 'leaseId', 'manifestHash'] as const) {
      const { input } = fixture();
      deny(() => verifyWorkerExactClaimOffer({ ...input,
        expected: { ...input.expected, claimBinding: {
          ...input.expected.claimBinding, [field]: 'attacker',
        } },
      }));
    }
  });
  it('rejects a forged exact-claim signature even if preclaim signature is valid', () => {
    const { input } = fixture();
    deny(() => verifyWorkerExactClaimOffer({ ...input,
      claimProof: { ...input.claimProof, signature: 'AAAA' },
    }));
    deny(() => verifyWorkerExactClaimOffer({ ...input, claimProof: null }));
    deny(() => verifyWorkerExactClaimOffer({ ...input,
      preclaimProof: { ...input.preclaimProof, signature: 'AAAA' },
    }));
  });
  it('rejects a swapped signed claim from another challenge', () => {
    const { input } = fixture();
    const different = fixture();
    deny(() => verifyWorkerExactClaimOffer({ ...input,
      claimProof: different.input.claimProof,
    }));
  });
  it('rejects a changed registered custodian, revoked key or unknown registry', () => {
    const { input } = fixture();
    deny(() => verifyWorkerExactClaimOffer({ ...input,
      actor: { ...input.actor, controllingPrincipalId: 'changed-owner' },
    }));
    deny(() => verifyWorkerExactClaimOffer({ ...input,
      registry: { resolve: k => {
        const entry = input.registry.resolve(k);
        return entry ? { ...entry, status: 'REVOKED' } : null;
      } },
    }));
    deny(() => verifyWorkerExactClaimOffer({ ...input, registry: null }));
  });
  it('rejects expired offer before claim, without implying DB single-use', () => {
    const { input } = fixture();
    deny(() => verifyWorkerExactClaimOffer({ ...input,
      now: new Date(NOW.getTime() + 60000),
    }));
    // Cryptographic verification is intentionally pure; DB CAS denies replay.
    expect(() => verifyWorkerExactClaimOffer(input)).not.toThrow();
    expect(() => verifyWorkerExactClaimOffer(input)).not.toThrow();
  });
});
