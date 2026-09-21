import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { canonicalizeAuthorityValue } from '../authority/supervisor-authority.service';

export type ActorPurpose = 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION';

export interface ActorExecutionBinding {
  taskId: string;
  executionId: string;
  purpose: ActorPurpose;
  manifestHash: string;
  claimEpoch: number;
  leaseId: string;
  runnerId: string;
  frozenBaseSha: string;
  headSha: string;
  changedFiles: string[];
  resultDigest: string;
  claimNonce: string;
}

export interface SignedActorProof {
  kid: string;
  binding: ActorExecutionBinding;
  signature: string; // Ed25519 over canonical {version, kid, binding}
}

export interface TrustedActorKey {
  kid: string;
  principalId: string;
  controllingPrincipalId: string;
  publicKeyPem: string;
  status: 'ACTIVE' | 'REVOKED';
  permittedPurposes: ActorPurpose[];
}

export interface TrustedActorRegistry {
  // Authoritative, server-controlled registration; never derived from request body.
  resolve(kid: string): TrustedActorKey | null;
}

function deny(): never {
  throw new ForbiddenException('independent_verifier_identity_required');
}

function canonicalBinding(binding: ActorExecutionBinding): string {
  return canonicalizeAuthorityValue({
    ...binding,
    changedFiles: [...binding.changedFiles].sort(),
  });
}

function verifyProof(
  proof: SignedActorProof | null | undefined,
  expected: ActorExecutionBinding,
  registry: TrustedActorRegistry,
): TrustedActorKey {
  if (!proof || !proof.kid || !proof.signature || !proof.binding ||
      !Array.isArray(proof.binding.changedFiles)) deny();
  const key = registry.resolve(proof.kid);
  if (!key || key.kid !== proof.kid || key.status !== 'ACTIVE' ||
      !key.principalId?.trim() || !key.controllingPrincipalId?.trim() ||
      !key.publicKeyPem || !key.permittedPurposes.includes(expected.purpose)) deny();
  if (!expected.taskId || !expected.executionId ||
      !/^[0-9a-f]{64}$/i.test(expected.manifestHash) ||
      !/^[0-9a-f]{40}$/i.test(expected.frozenBaseSha) ||
      !/^[0-9a-f]{40}$/i.test(expected.headSha) ||
      !/^[0-9a-f]{64}$/i.test(expected.resultDigest) ||
      !Number.isInteger(expected.claimEpoch) || expected.claimEpoch < 1 ||
      !expected.leaseId || !expected.runnerId || !expected.claimNonce ||
      !Array.isArray(expected.changedFiles) ||
      expected.changedFiles.some((p) => typeof p !== 'string' || !p)) deny();
  if (canonicalBinding(proof.binding) !== canonicalBinding(expected)) deny();
  const signed = canonicalizeAuthorityValue({
    version: 1,
    kid: proof.kid,
    binding: proof.binding,
  });
  try {
    if (!verifySignature(
      null, Buffer.from(signed, 'utf8'), createPublicKey(key.publicKeyPem),
      Buffer.from(proof.signature, 'base64url'),
    )) deny();
  } catch {
    deny();
  }
  return key;
}

/**
 * Cryptographic actor-provenance primitive ONLY: caller must load expected
 * bindings and immutable proofs from trusted persisted claim/completion rows.
 * Not a ready-review gate: atomic persistence, one-time claimNonce/replay
 * protection, custody registration, and historical backfill remain separate.
 */
export function requireIndependentActorProvenance(input: {
  registry: TrustedActorRegistry | null | undefined;
  implementation: SignedActorProof | null | undefined;
  verifier: SignedActorProof | null | undefined;
  expectedImplementation: ActorExecutionBinding;
  expectedVerifier: ActorExecutionBinding;
}): void {
  if (!input.registry) deny();
  if (input.expectedImplementation.taskId !== input.expectedVerifier.taskId ||
      input.expectedImplementation.executionId === input.expectedVerifier.executionId ||
      input.expectedImplementation.purpose !== 'IMPLEMENTATION' ||
      input.expectedVerifier.purpose !== 'INDEPENDENT_VERIFICATION' ||
      input.expectedImplementation.frozenBaseSha !== input.expectedVerifier.frozenBaseSha ||
      input.expectedImplementation.headSha !== input.expectedVerifier.headSha ||
      canonicalizeAuthorityValue([...input.expectedImplementation.changedFiles].sort()) !==
      canonicalizeAuthorityValue([...input.expectedVerifier.changedFiles].sort())) deny();
  const impl = verifyProof(input.implementation, input.expectedImplementation, input.registry);
  const verifier = verifyProof(input.verifier, input.expectedVerifier, input.registry);
  if (impl.principalId === verifier.principalId ||
      impl.controllingPrincipalId === verifier.controllingPrincipalId) deny();
  try {
    const implKey = createPublicKey(impl.publicKeyPem).export({ format: 'der', type: 'spki' });
    const verifierKey = createPublicKey(verifier.publicKeyPem).export({ format: 'der', type: 'spki' });
    if (implKey.equals(verifierKey)) deny();
  } catch {
    deny();
  }
}
