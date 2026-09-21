import { generateKeyPairSync, sign } from 'node:crypto';
import type { AuthenticatedBootstrapActor } from '../worker/supervisor-bootstrap-actor-registry';
import type { TrustedActorKey, TrustedActorRegistry } from './actor-provenance';
import {
  issueWorkerPreclaimChallenge,
  verifyWorkerPreclaimProof,
  workerPreclaimSignablePayload,
  PRECLAIM_TTL_MS,
} from './worker-preclaim-proof';

const now = new Date('2026-09-21T20:00:00.000Z');
function fixture(purpose: 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION' =
  'INDEPENDENT_VERIFICATION') {
  const pair = generateKeyPairSync('ed25519');
  const actor: AuthenticatedBootstrapActor = {
    kid: 'kid-verifier',
    principalId: 'principal-verifier',
    controllingPrincipalId: 'operator-verifier',
    workerRole: 'engineering',
    purposes: [purpose],
  };
  const key: TrustedActorKey = {
    kid: actor.kid, principalId: actor.principalId,
    controllingPrincipalId: actor.controllingPrincipalId,
    publicKeyPem: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    status: 'ACTIVE', permittedPurposes: [purpose],
  };
  const registry: TrustedActorRegistry = {
    resolve: kid => kid === key.kid ? key : null,
  };
  const expected = issueWorkerPreclaimChallenge({ actor, purpose, now });
  const proof = {
    kid: actor.kid,
    challengeId: expected.id,
    signature: sign(null,
      Buffer.from(workerPreclaimSignablePayload(expected)), pair.privateKey
    ).toString('base64url'),
  };
  const input = { actor, expected, proof, registry,
    now: new Date(now.getTime() + 1) };
  return { input, actor, key, pair };
}
const denied = (run: () => unknown) =>
  expect(run).toThrow('worker_preclaim_proof_required');

describe('Issue #140 Ed25519 worker preclaim PoP (no DB consumption implied)', () => {
  it('verifies signature from configured principal over server-generated random challenge', () => {
    const f = fixture();
    expect(verifyWorkerPreclaimProof(f.input)).toEqual(f.actor);
    expect(f.input.expected.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.input.expected.expiresAt).toBe(
      new Date(now.getTime() + PRECLAIM_TTL_MS).toISOString());
    expect(f.input.expected.id).not.toEqual(f.input.expected.nonce);
  });
  it('requires BOTH bootstrap actor and registered signing key', () => {
    const { input } = fixture();
    denied(() => verifyWorkerPreclaimProof({ ...input, actor: null }));
    denied(() => verifyWorkerPreclaimProof({ ...input, registry: null }));
    denied(() => verifyWorkerPreclaimProof({ ...input, proof: null }));
    denied(() => verifyWorkerPreclaimProof({ ...input, expected: null }));
  });
  it('rejects proof substituted for another challenge even for same signer', () => {
    const { input } = fixture();
    const other = issueWorkerPreclaimChallenge({
      actor: input.actor, purpose: input.expected.purpose, now,
    });
    expect(other.id).not.toBe(input.expected.id);
    denied(() => verifyWorkerPreclaimProof({ ...input, expected: other }));
  });
  it('rejects replayed signature with changed signed nonce, role or purpose', () => {
    for (const change of [
      { nonce: 'x'.repeat(43) },
      { workerRole: 'backend' as const },
      { purpose: 'IMPLEMENTATION' as const },
    ]) {
      const { input } = fixture();
      denied(() => verifyWorkerPreclaimProof({
        ...input, expected: { ...input.expected, ...change },
      }));
    }
  });
  it('rejects actor/body identity, key ID and permission substitutions', () => {
    const { input } = fixture();
    denied(() => verifyWorkerPreclaimProof({ ...input,
      actor: { ...input.actor, principalId: 'self-declared' },
    }));
    denied(() => verifyWorkerPreclaimProof({ ...input,
      actor: { ...input.actor, controllingPrincipalId: 'other-owner' },
    }));
    denied(() => verifyWorkerPreclaimProof({ ...input,
      actor: { ...input.actor, purposes: ['IMPLEMENTATION'] },
    }));
    denied(() => verifyWorkerPreclaimProof({ ...input,
      proof: { ...input.proof, kid: 'other-kid' },
    }));
  });
  it('rejects expired challenge, future challenge and tampered TTL', () => {
    const { input } = fixture();
    denied(() => verifyWorkerPreclaimProof({ ...input,
      now: new Date(now.getTime() + PRECLAIM_TTL_MS),
    }));
    denied(() => verifyWorkerPreclaimProof({ ...input,
      now: new Date(now.getTime() - 1),
    }));
    denied(() => verifyWorkerPreclaimProof({ ...input,
      expected: { ...input.expected,
        expiresAt: new Date(now.getTime() + 120000).toISOString() },
    }));
  });
  it('rejects revoked, unknown and changed controlling key custody', () => {
    const { input, key } = fixture();
    key.status = 'REVOKED';
    denied(() => verifyWorkerPreclaimProof(input));
    key.status = 'ACTIVE';
    key.controllingPrincipalId = 'unknown-operator';
    denied(() => verifyWorkerPreclaimProof(input));
    denied(() => verifyWorkerPreclaimProof({ ...input,
      registry: { resolve: () => null },
    }));
  });
  it('rejects malformed/forged proof and different signer', () => {
    const { input } = fixture();
    denied(() => verifyWorkerPreclaimProof({ ...input,
      proof: { ...input.proof, signature: 'AAAA' },
    }));
    const different = generateKeyPairSync('ed25519');
    const altered = sign(null,
      Buffer.from(workerPreclaimSignablePayload(input.expected)),
      different.privateKey).toString('base64url');
    denied(() => verifyWorkerPreclaimProof({ ...input,
      proof: { ...input.proof, signature: altered },
    }));
    denied(() => verifyWorkerPreclaimProof({ ...input,
      proof: { ...input.proof, signature: input.proof.signature + '=' },
    }));
  });
  it('does not turn a successful signature check into one-time DB consumption', () => {
    const { input, actor } = fixture();
    // By design, validator is pure. Revalidation succeeds; only a DB CAS can
    // enforce single-use, and is tested independently on real PostgreSQL.
    expect(verifyWorkerPreclaimProof(input)).toEqual(actor);
    expect(verifyWorkerPreclaimProof(input)).toEqual(actor);
  });
});
