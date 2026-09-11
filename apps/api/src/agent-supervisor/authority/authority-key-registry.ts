import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUTHORITY_KEY_DOMAINS,
  type AuthorityKeyDomain,
  type AuthorityKeyRecord,
  type AuthorityKeyRegistry,
} from './authority.types';

function envBase(domain: AuthorityKeyDomain): string {
  return `ATLAS_SUPERVISOR_${domain}`;
}

type PublicKeyEntry = {
  publicKeyPem: string;
  status?: AuthorityKeyRecord['status'];
  notBefore?: string;
  notAfter?: string;
};

export class ConfigAuthorityKeyRegistry implements AuthorityKeyRegistry {
  constructor(private readonly config: ConfigService) {}

  getSigningKey(domain: AuthorityKeyDomain): AuthorityKeyRecord {
    const base = envBase(domain);
    const kid = this.config.get<string>(`${base}_SIGNING_KID`);
    const privateKeyPem = this.config.get<string>(
      `${base}_SIGNING_PRIVATE_KEY`,
    );
    const record = kid ? this.findVerificationKey(domain, kid) : undefined;

    if (!kid || !privateKeyPem) {
      throw new ServiceUnavailableException(
        'authority_signing_material_unavailable',
      );
    }
    if (record?.status === 'REVOKED') {
      throw new UnauthorizedException('authority_signing_material_revoked');
    }
    if (!record?.publicKeyPem) {
      throw new ServiceUnavailableException(
        'authority_verification_material_unavailable',
      );
    }

    return { ...record, privateKeyPem, status: 'ACTIVE' };
  }

  getVerificationKey(
    domain: AuthorityKeyDomain,
    kid: string,
  ): AuthorityKeyRecord {
    const record = this.findVerificationKey(domain, kid);
    if (!record) {
      throw new UnauthorizedException('authority_unknown_kid');
    }
    if (record.status === 'REVOKED') {
      throw new UnauthorizedException('authority_key_revoked');
    }
    return record;
  }

  private findVerificationKey(
    domain: AuthorityKeyDomain,
    kid: string,
  ): AuthorityKeyRecord | undefined {
    const base = envBase(domain);
    const keyring = this.config.get<string>(
      `${base}_VERIFYING_KEYS_JSON`,
    );
    if (keyring) {
      let parsed: Record<string, PublicKeyEntry>;
      try {
        parsed = JSON.parse(keyring) as Record<string, PublicKeyEntry>;
      } catch {
        throw new ServiceUnavailableException(
          'authority_verification_material_invalid',
        );
      }
      const entry = parsed[kid];
      if (entry?.publicKeyPem) {
        return {
          domain,
          kid,
          publicKeyPem: entry.publicKeyPem,
          status: entry.status ?? 'VERIFY_ONLY',
          notBefore: entry.notBefore,
          notAfter: entry.notAfter,
        };
      }
    }

    const activeKid = this.config.get<string>(`${base}_SIGNING_KID`);
    const publicKeyPem = this.config.get<string>(
      `${base}_VERIFYING_PUBLIC_KEY`,
    );
    if (kid === activeKid && publicKeyPem) {
      return { domain, kid, publicKeyPem, status: 'ACTIVE' };
    }
    return undefined;
  }
}

export class InMemoryAuthorityKeyRegistry implements AuthorityKeyRegistry {
  private readonly records = new Map<AuthorityKeyDomain, AuthorityKeyRecord>();

  constructor(records: Record<AuthorityKeyDomain, { privateKeyPem: string; publicKeyPem: string }>) {
    for (const domain of AUTHORITY_KEY_DOMAINS) {
      this.records.set(domain, {
        domain,
        kid: `${domain.toLowerCase()}-v1`,
        privateKeyPem: records[domain].privateKeyPem,
        publicKeyPem: records[domain].publicKeyPem,
        status: 'ACTIVE',
      });
    }
  }

  getSigningKey(domain: AuthorityKeyDomain): AuthorityKeyRecord {
    const record = this.records.get(domain);
    if (!record?.privateKeyPem) {
      throw new ServiceUnavailableException(
        'authority_signing_material_unavailable',
      );
    }
    if (record.status === 'REVOKED') {
      throw new UnauthorizedException('authority_signing_material_revoked');
    }
    return record;
  }

  getVerificationKey(
    domain: AuthorityKeyDomain,
    kid: string,
  ): AuthorityKeyRecord {
    const record = this.records.get(domain);
    if (!record || record.kid !== kid) {
      throw new UnauthorizedException('authority_unknown_kid');
    }
    if (record.status === 'REVOKED') {
      throw new UnauthorizedException('authority_key_revoked');
    }
    return record;
  }

  revoke(domain: AuthorityKeyDomain): void {
    const record = this.records.get(domain);
    if (record) {
      record.status = 'REVOKED';
    }
  }
}

export type HumanOwnerApprovalKeyDomain =
  | 'MERGE_APPROVAL'
  | 'DEPLOY_APPROVAL';

export interface HumanOwnerApprovalKeyRegistry {
  getSigningKey(
    domain: HumanOwnerApprovalKeyDomain,
  ): AuthorityKeyRecord;
}

/**
 * Generic Supervisor/system signing must never gain access to
 * Human Owner Merge/Deploy private signing keys.
 *
 * Verification remains available through the inherited
 * getVerificationKey() path so gates can validate Owner approvals.
 */
export class SupervisorAuthorityKeyRegistry
  extends ConfigAuthorityKeyRegistry
{
  override getSigningKey(
    domain: AuthorityKeyDomain,
  ): AuthorityKeyRecord {
    if (
      domain === 'MERGE_APPROVAL' ||
      domain === 'DEPLOY_APPROVAL'
    ) {
      throw new ForbiddenException(
        'human_owner_approval_signer_required',
      );
    }

    return super.getSigningKey(domain);
  }
}

/**
 * Dedicated private-key boundary for Human Owner approvals.
 * This registry accepts only the two action-specific approval
 * domains at both the TypeScript and runtime boundaries.
 */
export class ConfigHumanOwnerApprovalKeyRegistry
  implements HumanOwnerApprovalKeyRegistry
{
  private readonly delegate: ConfigAuthorityKeyRegistry;

  constructor(config: ConfigService) {
    this.delegate =
      new ConfigAuthorityKeyRegistry(config);
  }

  getSigningKey(
    domain: HumanOwnerApprovalKeyDomain,
  ): AuthorityKeyRecord {
    if (
      domain !== 'MERGE_APPROVAL' &&
      domain !== 'DEPLOY_APPROVAL'
    ) {
      throw new ForbiddenException(
        'human_owner_approval_domain_invalid',
      );
    }

    return this.delegate.getSigningKey(domain);
  }
}

export const HUMAN_OWNER_APPROVAL_KEYRING =
  Symbol('HUMAN_OWNER_APPROVAL_KEYRING');
