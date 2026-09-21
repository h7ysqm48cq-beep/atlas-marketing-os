import { createPublicKey, randomBytes, randomUUID, verify as verifySignature } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { canonicalizeAuthorityValue } from '../authority/supervisor-authority.service';
import type { SupervisorWorkerRole } from '../execution/supervisor-execution.types';
import type { AuthenticatedBootstrapActor } from '../worker/supervisor-bootstrap-actor-registry';
import type { ActorPurpose, TrustedActorRegistry } from './actor-provenance';

export const PRECLAIM_DOMAIN = 'atlas.actor.preclaim.v1';
export const PRECLAIM_TTL_MS = 60_000;

/**
 * Entire challenge MUST be issued/persisted by the control plane, never read
 * from a caller-provided object. Server-side DB CAS consumes it atomically
 * with RUNNING execution claim and the append-only claim proof.
 */
export interface WorkerPreclaimChallenge {
  id: string;
  nonce: string;
  kid: string;
  workerRole: SupervisorWorkerRole;
  purpose: ActorPurpose;
  issuedAt: string;
  expiresAt: string;
}

export interface SignedWorkerPreclaimProof {
  kid: string;
  challengeId: string;
  signature: string;
}

function deny(): never {
  throw new ForbiddenException('worker_preclaim_proof_required');
}

export function issueWorkerPreclaimChallenge(input: {
  actor: AuthenticatedBootstrapActor;
  purpose: ActorPurpose;
  now: Date;
}): WorkerPreclaimChallenge {
  const { actor, now, purpose } = input;
  if (!Number.isFinite(now.getTime()) ||
      !actor.kid?.trim() ||
      !actor.purposes?.includes(purpose)) deny();
  return {
    id: randomUUID(),
    nonce: randomBytes(32).toString('base64url'),
    kid: actor.kid,
    workerRole: actor.workerRole,
    purpose,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PRECLAIM_TTL_MS).toISOString(),
  };
}

export function workerPreclaimSignablePayload(
  challenge: WorkerPreclaimChallenge,
): string {
  return canonicalizeAuthorityValue({
    domain: PRECLAIM_DOMAIN,
    challenge,
  });
}

/**
 * Offline signature+policy verifier. DOES NOT consume the challenge and MUST
 * NOT be treated as admission authorization without a DB challenge CAS.
 * actor is derived from the authenticated bootstrap credential, and expected
 * is loaded from the server-controlled challenge row (never request body).
 */
export function verifyWorkerPreclaimProof(input: {
  actor: AuthenticatedBootstrapActor | null | undefined;
  expected: WorkerPreclaimChallenge | null | undefined;
  proof: SignedWorkerPreclaimProof | null | undefined;
  registry: TrustedActorRegistry | null | undefined;
  now: Date;
}): AuthenticatedBootstrapActor {
  try {
    const { actor, expected, proof, registry, now } = input;
    if (!actor || !expected || !proof || !registry ||
        !Number.isFinite(now.getTime()) ||
        !/^[0-9a-f-]{36}$/i.test(expected.id) ||
        !/^[A-Za-z0-9_-]{43}$/.test(expected.nonce) ||
        typeof expected.issuedAt !== 'string' ||
        typeof expected.expiresAt !== 'string' ||
        typeof expected.kid !== 'string' ||
        !proof.challengeId ||
        proof.challengeId !== expected.id ||
        proof.kid !== expected.kid ||
        actor.kid !== expected.kid ||
        actor.workerRole !== expected.workerRole ||
        !actor.purposes.includes(expected.purpose) ||
        !['IMPLEMENTATION', 'INDEPENDENT_VERIFICATION'].includes(expected.purpose) ||
        !/^[A-Za-z0-9_-]+$/.test(proof.signature)) deny();

    const issuedAt = Date.parse(expected.issuedAt);
    const expiresAt = Date.parse(expected.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
        now.getTime() < issuedAt || now.getTime() >= expiresAt ||
        expiresAt - issuedAt !== PRECLAIM_TTL_MS ||
        new Date(issuedAt).toISOString() !== expected.issuedAt ||
        new Date(expiresAt).toISOString() !== expected.expiresAt) deny();

    const key = registry.resolve(expected.kid);
    if (!key || key.status !== 'ACTIVE' ||
        key.principalId !== actor.principalId ||
        key.controllingPrincipalId !== actor.controllingPrincipalId ||
        !key.permittedPurposes.includes(expected.purpose)) deny();

    const pub = createPublicKey(key.publicKeyPem);
    if (pub.asymmetricKeyType !== 'ed25519') deny();
    const signature = Buffer.from(proof.signature, 'base64url');
    if (signature.length !== 64 ||
        signature.toString('base64url') !== proof.signature ||
        !verifySignature(null,
          Buffer.from(workerPreclaimSignablePayload(expected), 'utf8'),
          pub, signature)) deny();

    return {
      kid: key.kid,
      principalId: key.principalId,
      controllingPrincipalId: key.controllingPrincipalId,
      workerRole: expected.workerRole,
      purposes: [...actor.purposes],
    };
  } catch {
    deny();
  }
}
