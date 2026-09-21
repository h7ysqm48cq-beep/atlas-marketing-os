import { generateKeyPairSync, sign as signMessage } from 'node:crypto';
import { canonicalizeAuthorityValue } from '../authority/supervisor-authority.service';
import {
  requireIndependentActorProvenance,
  type ActorExecutionBinding, type SignedActorProof,
  type TrustedActorKey, type TrustedActorRegistry,
} from './actor-provenance';

const sha = (c: string, length: number) => c.repeat(length);
const candidate = { taskId: 'task-140', frozenBaseSha: sha('a', 40),
  headSha: sha('b', 40), changedFiles: ['x.ts', 'y.ts'] };

function binding(purpose: ActorExecutionBinding['purpose']): ActorExecutionBinding {
  const impl = purpose === 'IMPLEMENTATION';
  return { ...candidate, purpose, executionId: impl ? 'impl-1' : 'verify-1',
    manifestHash: sha(impl ? 'c' : 'd', 64), claimEpoch: 1,
    leaseId: impl ? 'impl-lease' : 'verifier-lease',
    runnerId: impl ? 'impl-runner' : 'verifier-runner',
    claimNonce: impl ? 'impl-nonce' : 'verifier-nonce',
    resultDigest: sha(impl ? 'e' : 'f', 64) };
}

function fixture(kid: string, principalId: string, controllingPrincipalId: string,
  purpose: ActorExecutionBinding['purpose']) {
  const pair = generateKeyPairSync('ed25519');
  const key: TrustedActorKey = { kid, principalId, controllingPrincipalId,
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    status: 'ACTIVE', permittedPurposes: [purpose] };
  const proof = (b: ActorExecutionBinding, signedKid = kid): SignedActorProof => ({
    kid: signedKid, binding: b,
    signature: signMessage(null, Buffer.from(canonicalizeAuthorityValue({
      version: 1, kid: signedKid, binding: b,
    })), pair.privateKey).toString('base64url'),
  });
  return { key, proof };
}

function setup() {
  const implementation = binding('IMPLEMENTATION');
  const verification = binding('INDEPENDENT_VERIFICATION');
  const impl = fixture('impl-key', 'principal-A', 'operator-A', 'IMPLEMENTATION');
  const verifier = fixture('verifier-key', 'principal-B', 'operator-B', 'INDEPENDENT_VERIFICATION');
  const keys = new Map([[impl.key.kid, impl.key], [verifier.key.kid, verifier.key]]);
  const registry: TrustedActorRegistry = { resolve: kid => keys.get(kid) ?? null };
  const proofs = { registry, implementation: impl.proof(implementation),
    verifier: verifier.proof(verification),
    expectedImplementation: implementation, expectedVerifier: verification };
  return { impl, verifier, keys, proofs };
}

describe('Issue #140 trusted actor provenance primitive (isolated, not production gate)', () => {
  it('accepts two authentically signed and separately registered principals', () => {
    expect(() => requireIndependentActorProvenance(setup().proofs)).not.toThrow();
  });
  it('fails closed when registry or historical claim proof is missing', () => {
    const { proofs } = setup();
    expect(() => requireIndependentActorProvenance({ ...proofs, registry: undefined }))
      .toThrow('independent_verifier_identity_required');
    expect(() => requireIndependentActorProvenance({ ...proofs, implementation: null }))
      .toThrow('independent_verifier_identity_required');
    expect(() => requireIndependentActorProvenance({ ...proofs, verifier: null }))
      .toThrow('independent_verifier_identity_required');
  });
  it('rejects same controlling principal even with different keys and runner IDs', () => {
    const { keys, proofs } = setup();
    keys.get('verifier-key')!.controllingPrincipalId = 'operator-A';
    expect(() => requireIndependentActorProvenance(proofs))
      .toThrow('independent_verifier_identity_required');
  });
  it('rejects same principal using distinct keys and runners', () => {
    const { keys, proofs } = setup();
    keys.get('verifier-key')!.principalId = 'principal-A';
    expect(() => requireIndependentActorProvenance(proofs))
      .toThrow('independent_verifier_identity_required');
  });
  it('rejects two registered identities backed by the same signing key', () => {
    const { keys, proofs, impl } = setup();
    keys.get('verifier-key')!.publicKeyPem = keys.get('impl-key')!.publicKeyPem;
    const verifierProof = impl.proof(proofs.expectedVerifier, 'verifier-key');
    expect(() => requireIndependentActorProvenance({ ...proofs, verifier: verifierProof }))
      .toThrow('independent_verifier_identity_required');
  });
  it('rejects a forged signed claim, swapped SHA and changed files', () => {
    const { proofs } = setup();
    expect(() => requireIndependentActorProvenance({ ...proofs,
      verifier: { ...proofs.verifier!, binding: {
        ...proofs.verifier!.binding, headSha: sha('0', 40) } } }))
      .toThrow('independent_verifier_identity_required');
    expect(() => requireIndependentActorProvenance({ ...proofs,
      expectedVerifier: { ...proofs.expectedVerifier, changedFiles: ['x.ts'] } }))
      .toThrow('independent_verifier_identity_required');
  });
  it('rejects revoked or unknown registered credentials', () => {
    const { keys, proofs } = setup();
    keys.get('verifier-key')!.status = 'REVOKED';
    expect(() => requireIndependentActorProvenance(proofs))
      .toThrow('independent_verifier_identity_required');
    keys.delete('verifier-key');
    expect(() => requireIndependentActorProvenance(proofs))
      .toThrow('independent_verifier_identity_required');
  });
  it('rejects replayed claim epoch/lease and mismatched manifest or result', () => {
    const { proofs } = setup();
    for (const change of [
      { claimEpoch: 2 }, { leaseId: 'other' }, { manifestHash: sha('0', 64) },
      { resultDigest: sha('0', 64) }, { claimNonce: 'replayed' },
    ]) {
      expect(() => requireIndependentActorProvenance({ ...proofs,
        expectedVerifier: { ...proofs.expectedVerifier, ...change } }))
        .toThrow('independent_verifier_identity_required');
    }
  });
  it('rejects mismatched task or purpose', () => {
    const { proofs } = setup();
    expect(() => requireIndependentActorProvenance({ ...proofs,
      expectedVerifier: { ...proofs.expectedVerifier, taskId: 'other' } }))
      .toThrow('independent_verifier_identity_required');
    expect(() => requireIndependentActorProvenance({ ...proofs,
      expectedVerifier: { ...proofs.expectedVerifier, purpose: 'IMPLEMENTATION' } }))
      .toThrow('independent_verifier_identity_required');
  });
});
