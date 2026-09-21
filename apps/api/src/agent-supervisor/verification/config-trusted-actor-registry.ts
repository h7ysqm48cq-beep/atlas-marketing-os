import { createPublicKey } from 'node:crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  TrustedActorKey, TrustedActorRegistry, ActorPurpose,
} from './actor-provenance';

const purposes: ActorPurpose[] = [
  'IMPLEMENTATION', 'INDEPENDENT_VERIFICATION',
];

function invalid(): never {
  throw new ForbiddenException('trusted_actor_key_registry_invalid');
}

/**
 * Server-owned public key map only. Never take registry data from HTTP input.
 * The config owner must verify credential custody/independent operators outside
 * this parser; labels alone cannot establish organizational independence.
 */
export function parseTrustedActorRegistry(
  raw: string | null | undefined,
): TrustedActorRegistry {
  const keys = new Map<string, TrustedActorKey>();
  if (raw === undefined || raw === null) {
    return { resolve: () => null };
  }
  let entries: unknown;
  try { entries = JSON.parse(raw); } catch { invalid(); }
  if (!Array.isArray(entries) || entries.length === 0) invalid();
  const publicKeys = new Set<string>();
  for (const value of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).some(k => ![
      'kid', 'principalId', 'controllingPrincipalId',
      'publicKeyPem', 'status', 'permittedPurposes',
    ].includes(k))) invalid();
    for (const property of [
      'kid', 'principalId', 'controllingPrincipalId', 'publicKeyPem',
    ]) {
      if (typeof entry[property] !== 'string' ||
          !(entry[property] as string).trim()) invalid();
    }
    if (entry.status !== 'ACTIVE' && entry.status !== 'REVOKED') invalid();
    if (!Array.isArray(entry.permittedPurposes) ||
        entry.permittedPurposes.length === 0 ||
        entry.permittedPurposes.some(p => !purposes.includes(p)) ||
        new Set(entry.permittedPurposes).size !== entry.permittedPurposes.length) {
      invalid();
    }
    const kid = entry.kid as string;
    if (keys.has(kid)) invalid();
    const pem = entry.publicKeyPem as string;
    if (!pem.startsWith('-----BEGIN PUBLIC KEY-----\n') ||
        !pem.trimEnd().endsWith('-----END PUBLIC KEY-----')) invalid();
    let spki: string;
    try {
      const pub = createPublicKey(pem);
      if (pub.asymmetricKeyType !== 'ed25519') invalid();
      spki = pub.export({ format: 'der', type: 'spki' }).toString('base64');
    } catch { invalid(); }
    if (publicKeys.has(spki)) invalid();
    publicKeys.add(spki);
    keys.set(kid, Object.freeze({
      kid,
      principalId: entry.principalId as string,
      controllingPrincipalId: entry.controllingPrincipalId as string,
      publicKeyPem: pem,
      status: entry.status as TrustedActorKey['status'],
      permittedPurposes: Object.freeze(
        [...entry.permittedPurposes] as ActorPurpose[],
      ) as unknown as ActorPurpose[],
    }));
  }
  return {
    resolve(kid: string) {
      const key = keys.get(kid);
      return key ? { ...key,
        permittedPurposes: [...key.permittedPurposes],
      } : null;
    },
  };
}

@Injectable()
export class ConfigTrustedActorRegistry implements TrustedActorRegistry {
  private readonly registry: TrustedActorRegistry;

  constructor(config: ConfigService) {
    this.registry = parseTrustedActorRegistry(
      config.get<string>('ATLAS_SUPERVISOR_ACTOR_SIGNING_PUBLIC_KEYS_JSON'),
    );
  }

  resolve(kid: string): TrustedActorKey | null {
    return this.registry.resolve(kid);
  }
}
