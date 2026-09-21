import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { canonicalizeAuthorityValue } from '../authority/supervisor-authority.service';
import { testOnlySeparatedExecutions } from '../testing/independent-verifier.test-fixture';
import type { TrustedActorKey, TrustedActorRegistry } from './actor-provenance';
import { parseTrustedActorRegistry } from './config-trusted-actor-registry';
import {
  ACTOR_ATTESTATION_DOMAIN,
  requireSignedIndependentExecutionPair,
  type ActorSignature,
  type PersistedActorAttestation,
  type SignedClaimBinding,
  type SignedCompletionBinding,
} from './signed-execution-attestation';

const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const path = 'apps/api/src/issue140.ts';
const canonical = canonicalizeAuthorityValue;
const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const time = new Date('2026-09-21T10:00:00.000Z');

function task(): SupervisorTask {
  const reviewCandidate = { action: 'merge' as const,
    targetBranch: 'production/atlas', baseSha, headSha,
    changedFiles: [path] };
  return {
    id: 'ISSUE140-SIGNED-PROOF', status: 'VERIFYING',
    objective: 'only real signed independent work can review',
    owner: 'engineering', allowedPaths: [path],
    forbiddenActions: [], dependsOn: [], acceptance: [],
    evidence: {
      rootCause: 'isolated test', changedFiles: [path],
      tests: ['PASS'], build: 'PASS', regression: [],
      deploymentState: 'NOT_DEPLOYED', gitState: 'TEST_ONLY',
      remainingRisk: [], reviewCandidate,
    },
    blockingReason: null, failureReason: null,
    createdAt: new Date(time.getTime() - 1000), updatedAt: time,
  };
}

function makeKey(kid: string, principalId: string,
  controllingPrincipalId: string,
  purpose: SignedClaimBinding['purpose']) {
  const pair = generateKeyPairSync('ed25519');
  const key: TrustedActorKey = {
    kid, principalId, controllingPrincipalId,
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    status: 'ACTIVE', permittedPurposes: [purpose],
  };
  const signed = <T>(domain: string, binding: T): ActorSignature<T> => ({
    kid, binding,
    signature: sign(null, Buffer.from(canonical({
      domain, kid, binding,
    }), 'utf8'), pair.privateKey).toString('base64url'),
  });
  return { key, signed };
}

function signedFixture() {
  const source = task();
  const [implementation, verifier] = testOnlySeparatedExecutions(
    source, new Date(time.getTime() + 1000),
  );
  for (const execution of [implementation, verifier]) {
    execution.assignment.frozenBaseSha = baseSha;
  }
  const implKey = makeKey('KID-IMPL', 'PRINCIPAL-IMPL', 'CONTROL-IMPL', 'IMPLEMENTATION');
  const verifierKey = makeKey('KID-VERIFIER', 'PRINCIPAL-VERIFIER',
    'CONTROL-VERIFIER', 'INDEPENDENT_VERIFICATION');
  implementation.assignment.bootstrapActor = {
    ...implementation.assignment.bootstrapActor!,
    kid: implKey.key.kid, principalId: implKey.key.principalId,
    controllingPrincipalId: implKey.key.controllingPrincipalId,
  };
  verifier.assignment.bootstrapActor = {
    ...verifier.assignment.bootstrapActor!,
    kid: verifierKey.key.kid, principalId: verifierKey.key.principalId,
    controllingPrincipalId: verifierKey.key.controllingPrincipalId,
  };
  const attest = (execution: SupervisorExecution,
    key: ReturnType<typeof makeKey>): PersistedActorAttestation => {
    const actor = execution.assignment.bootstrapActor!;
    const claimBinding: SignedClaimBinding = {
      taskId: execution.taskId, executionId: execution.id,
      purpose: execution.assignment.executionPurpose as SignedClaimBinding['purpose'],
      manifestHash: execution.assignment.manifestHash!,
      claimEpoch: execution.claimEpoch,
      runnerId: execution.runnerId!,
      leaseId: execution.assignment.leaseId!,
      claimNonce: actor.claimNonce,
      authenticatedAt: actor.authenticatedAt,
      frozenBaseSha: baseSha,
    };
    const claim = key.signed(ACTOR_ATTESTATION_DOMAIN.claim, claimBinding);
    const completionBinding: SignedCompletionBinding = {
      taskId: execution.taskId, executionId: execution.id,
      claimProofDigest: digest(claim),
      resultDigest: digest(execution.result),
      completedAt: execution.completedAt!.toISOString(),
      candidate: { ...source.evidence!.reviewCandidate!,
        changedFiles: [path] },
    };
    return {
      claim,
      completion: key.signed(ACTOR_ATTESTATION_DOMAIN.completion, completionBinding),
    };
  };
  const keys = new Map([[implKey.key.kid, implKey.key],
    [verifierKey.key.kid, verifierKey.key]]);
  const registry: TrustedActorRegistry = {
    resolve: kid => keys.get(kid) ?? null,
  };
  const input = {
    task: source, implementation, verifier,
    implementationAttestation: attest(implementation, implKey),
    verifierAttestation: attest(verifier, verifierKey), registry,
  };
  return { input, keys };
}
function denied(run: () => void): void {
  expect(run).toThrow('independent_verifier_attestation_required');
}

describe('Issue #140 split claim/completion cryptographic attestation (offline only)', () => {
  it('verifies distinct independently registered signed claim AND completion proofs', () => {
    const { input } = signedFixture();
    expect(() => requireSignedIndependentExecutionPair(input)).not.toThrow();
  });
  it('verifies both signatures using freshly parsed SERVER-CONFIGURED public keys', () => {
    const { input, keys } = signedFixture();
    input.registry = parseTrustedActorRegistry(JSON.stringify([...keys.values()]));
    expect(() => requireSignedIndependentExecutionPair(input)).not.toThrow();
    const edited = [...keys.values()].map(key => key.kid === 'KID-VERIFIER'
      ? { ...key, controllingPrincipalId: 'SELF-DECLARED-OWNER' } : key);
    input.registry = parseTrustedActorRegistry(JSON.stringify(edited));
    denied(() => requireSignedIndependentExecutionPair(input));
  });
  it('rejects absent trusted registry and historical unsigned executions', () => {
    const { input } = signedFixture();
    denied(() => requireSignedIndependentExecutionPair({
      ...input, registry: null,
    }));
    denied(() => requireSignedIndependentExecutionPair({
      ...input, implementationAttestation: null,
    }));
    denied(() => requireSignedIndependentExecutionPair({
      ...input, verifierAttestation: null,
    }));
  });
  it('rejects valid completion signature without the original claim signature', () => {
    const { input } = signedFixture();
    denied(() => requireSignedIndependentExecutionPair({
      ...input, verifierAttestation: {
        ...input.verifierAttestation!, claim: {
          ...input.verifierAttestation!.claim, signature: 'AAAA',
        },
      },
    }));
  });
  it('rejects claim replay with different execution/epoch/lease/runner/nonce', () => {
    for (const changed of [
      { claimEpoch: 2 }, { id: 'other' }, { runnerId: 'other-runner' },
    ]) {
      const { input } = signedFixture();
      Object.assign(input.verifier, changed);
      denied(() => requireSignedIndependentExecutionPair(input));
    }
    for (const changed of [
      { leaseId: 'other-lease' }, { manifestHash: '0'.repeat(64) },
    ]) {
      const { input } = signedFixture();
      Object.assign(input.verifier.assignment, changed);
      denied(() => requireSignedIndependentExecutionPair(input));
    }
    const { input } = signedFixture();
    input.verifier.assignment.bootstrapActor!.claimNonce = 'replayed-nonce';
    denied(() => requireSignedIndependentExecutionPair(input));
  });
  it('rejects changed result content even when both actor IDs still match', () => {
    const { input } = signedFixture();
    input.verifier.result = { ...input.verifier.result!,
      summary: 'tampered after completion' };
    denied(() => requireSignedIndependentExecutionPair(input));
  });
  it('rejects a swapped candidate head or files after both signatures', () => {
    for (const changed of [
      { headSha: '0'.repeat(40) },
      { changedFiles: ['other.ts'] },
    ]) {
      const { input } = signedFixture();
      Object.assign(input.task.evidence!.reviewCandidate!, changed);
      denied(() => requireSignedIndependentExecutionPair(input));
    }
  });
  it('rejects a completion proof swapped onto another claim', () => {
    const { input } = signedFixture();
    input.verifierAttestation = {
      ...input.verifierAttestation!,
      claim: input.implementationAttestation!.claim,
    };
    denied(() => requireSignedIndependentExecutionPair(input));
  });
  it('rejects a valid signature in the WRONG claim/completion domain', () => {
    const { input } = signedFixture();
    input.verifierAttestation = {
      ...input.verifierAttestation!,
      claim: { ...input.verifierAttestation!.claim,
        signature: input.verifierAttestation!.completion.signature },
    };
    denied(() => requireSignedIndependentExecutionPair(input));
  });
  it('rejects revoked and unknown public keys', () => {
    const { input, keys } = signedFixture();
    keys.get('KID-VERIFIER')!.status = 'REVOKED';
    denied(() => requireSignedIndependentExecutionPair(input));
    keys.delete('KID-VERIFIER');
    denied(() => requireSignedIndependentExecutionPair(input));
  });
  it('rejects same principal or controlling principal despite valid distinct signatures', () => {
    for (const field of ['principalId', 'controllingPrincipalId'] as const) {
      const { input, keys } = signedFixture();
      const verifier = keys.get('KID-VERIFIER')!;
      const implementation = keys.get('KID-IMPL')!;
      verifier[field] = implementation[field];
      input.verifier.assignment.bootstrapActor![field] = implementation[field];
      denied(() => requireSignedIndependentExecutionPair(input));
    }
  });
  it('rejects duplicate public keys despite different kid and principal', () => {
    const { input, keys } = signedFixture();
    keys.get('KID-VERIFIER')!.publicKeyPem = keys.get('KID-IMPL')!.publicKeyPem;
    denied(() => requireSignedIndependentExecutionPair(input));
  });
  it('rejects a forged bootstrapActor with syntactically correct but unsigned labels', () => {
    const { input } = signedFixture();
    input.verifier.assignment.bootstrapActor!.principalId = 'SELF-DECLARED';
    denied(() => requireSignedIndependentExecutionPair(input));
  });
  it('fails closed for malformed or null stored proofs rather than throwing TypeError', () => {
    for (const corrupt of [
      { claim: { binding: null } },
      { completion: { binding: { candidate: null } } },
      { completion: { binding: { candidate: { changedFiles: null } } } },
    ]) {
      const { input } = signedFixture();
      input.verifierAttestation = {
        ...input.verifierAttestation!, ...corrupt,
        claim: { ...input.verifierAttestation!.claim,
          ...(corrupt.claim ?? {}) },
        completion: { ...input.verifierAttestation!.completion,
          ...(corrupt.completion ?? {}) },
      } as never;
      denied(() => requireSignedIndependentExecutionPair(input));
    }
  });
  it('rejects an invalid public key without skipping authorization', () => {
    const { input, keys } = signedFixture();
    keys.get('KID-VERIFIER')!.publicKeyPem = 'invalid public key';
    denied(() => requireSignedIndependentExecutionPair(input));
  });
  it('rejects wrong frozen base, stale verifier ordering and missing review candidate', () => {
    const { input } = signedFixture();
    input.verifier.assignment.frozenBaseSha = '0'.repeat(40);
    denied(() => requireSignedIndependentExecutionPair(input));
    const next = signedFixture();
    next.input.implementation.completedAt = new Date(
      next.input.verifier.startedAt!.getTime() + 1);
    denied(() => requireSignedIndependentExecutionPair(next.input));
    const missing = signedFixture();
    delete missing.input.task.evidence!.reviewCandidate;
    denied(() => requireSignedIndependentExecutionPair(missing.input));
  });
});
