import { generateKeyPairSync } from 'node:crypto';
import { ConfigTrustedActorRegistry, parseTrustedActorRegistry } from './config-trusted-actor-registry';

function key(kid: string) {
  return {
    kid, principalId: 'principal-' + kid,
    controllingPrincipalId: 'owner-' + kid,
    publicKeyPem: generateKeyPairSync('ed25519').publicKey.export({
      format: 'pem', type: 'spki',
    }).toString(),
    status: 'ACTIVE',
    permittedPurposes: ['INDEPENDENT_VERIFICATION'],
  };
}
describe('Issue #140 server-owned Ed25519 trust registry', () => {
  it('loads an explicitly registered public-only key without private material', () => {
    const a = key('kid-a');
    const b = { ...key('kid-b'), status: 'REVOKED' };
    const r = parseTrustedActorRegistry(JSON.stringify([a, b]));
    expect(r.resolve('kid-a')).toEqual(a);
    expect(r.resolve('kid-b')).toEqual(b);
    expect(r.resolve('unregistered')).toBeNull();
    expect(JSON.stringify(r.resolve('kid-a'))).not.toContain('PRIVATE KEY');
  });
  it('returns no trusted principal when public registry was not configured', () => {
    expect(parseTrustedActorRegistry(undefined).resolve('kid-a')).toBeNull();
  });
  it('rejects malformed config, unknown keys and duplicate key IDs', () => {
    const a = key('kid-a');
    for (const raw of ['invalid JSON', '[]',
      JSON.stringify([{ ...a, extra: true }]),
      JSON.stringify([a, a])]) {
      expect(() => parseTrustedActorRegistry(raw))
        .toThrow('trusted_actor_key_registry_invalid');
    }
  });
  it('rejects distinct key IDs that secretly share the same signing public key', () => {
    const a = key('kid-a');
    const b = { ...key('kid-b'), publicKeyPem: a.publicKeyPem };
    expect(() => parseTrustedActorRegistry(JSON.stringify([a, b])))
      .toThrow('trusted_actor_key_registry_invalid');
  });
  it('rejects private PEM and non-Ed25519 public keys', () => {
    const a = key('kid-a');
    const privateKey = generateKeyPairSync('ed25519').privateKey.export({
      format: 'pem', type: 'pkcs8',
    }).toString();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
      format: 'pem', type: 'spki',
    }).toString();
    for (const invalidPem of [privateKey, rsa]) {
      expect(() => parseTrustedActorRegistry(JSON.stringify([
        { ...a, publicKeyPem: invalidPem },
      ]))).toThrow('trusted_actor_key_registry_invalid');
    }
  });
  it('rejects unrecognized purpose and status even with valid public key', () => {
    const a = key('kid-a');
    for (const variant of [
      { status: 'TRUST_ME' },
      { permittedPurposes: ['APPROVE_DEPLOY'] },
      { permittedPurposes: ['IMPLEMENTATION', 'IMPLEMENTATION'] },
    ]) {
      expect(() => parseTrustedActorRegistry(JSON.stringify([{ ...a, ...variant }])))
        .toThrow('trusted_actor_key_registry_invalid');
    }
  });
  it('does not accept caller-side mutation of resolved key policy', () => {
    const a = key('kid-a');
    const r = parseTrustedActorRegistry(JSON.stringify([a]));
    r.resolve('kid-a')!.permittedPurposes.push('IMPLEMENTATION');
    expect(r.resolve('kid-a')!.permittedPurposes).toEqual(
      ['INDEPENDENT_VERIFICATION']);
  });
  it('uses ONLY server-provided config at construction', () => {
    const a = key('kid-a');
    const registry = new ConfigTrustedActorRegistry({
      get: (field: string) => field ===
        'ATLAS_SUPERVISOR_ACTOR_SIGNING_PUBLIC_KEYS_JSON'
        ? JSON.stringify([a]) : undefined,
    } as never);
    expect(registry.resolve('kid-a')).toEqual(a);
    expect(registry.resolve('user-claimed-kid')).toBeNull();
  });
});
