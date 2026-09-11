import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import {
  ConfigAuthorityKeyRegistry,
  InMemoryAuthorityKeyRegistry,
} from './authority-key-registry';
import {
  AUTHORITY_KEY_DOMAINS,
  type AuthorityActorType,
  type AuthorityClaims,
  type AuthorityEnvelopeHeader,
  type AuthorityKeyDomain,
  type AuthorityKeyRegistry,
  type AuthorityPurpose,
  type AuthorityTokenType,
  type AuthorityVerificationExpectation,
} from './authority.types';

export const SUPERVISOR_AUTHORITY_KEYRING = Symbol(
  'SUPERVISOR_AUTHORITY_KEYRING',
);

export { InMemoryAuthorityKeyRegistry };
export type {
  AuthorityActorType,
  AuthorityClaims,
  AuthorityKeyDomain,
  AuthorityPurpose,
  AuthorityTokenType,
  AuthorityVerificationExpectation,
} from './authority.types';

const DOMAIN_RULES: Record<
  AuthorityKeyDomain,
  { actorType: AuthorityActorType; tokenType: AuthorityTokenType; purposes: AuthorityPurpose[] }
> = {
  SUPERVISOR_SYSTEM: {
    actorType: 'EXECUTIVE_SUPERVISOR',
    tokenType: 'SYSTEM_ASSERTION',
    purposes: [
      'TASK_LIFECYCLE',
      'ADMISSION',
      'DISPATCH',
      'REPLAN',
      'CANCEL',
      'VERIFICATION_COORDINATION',
    ],
  },
  WORKER_CAPABILITY: {
    actorType: 'WORKER_EXECUTION',
    tokenType: 'WORKER_CAPABILITY',
    purposes: ['IMPLEMENTATION'],
  },
  VERIFIER_CAPABILITY: {
    actorType: 'VERIFIER_EXECUTION',
    tokenType: 'VERIFIER_CAPABILITY',
    purposes: ['INDEPENDENT_VERIFICATION'],
  },
  MERGE_APPROVAL: {
    actorType: 'HUMAN_OWNER',
    tokenType: 'MERGE_APPROVAL',
    purposes: ['APPROVE_MERGE'],
  },
  DEPLOY_APPROVAL: {
    actorType: 'HUMAN_OWNER',
    tokenType: 'DEPLOY_APPROVAL',
    purposes: ['APPROVE_DEPLOY'],
  },
};

const AUTHORITY_ISSUER = 'atlas.supervisor.control-plane';

export function canonicalizeAuthorityValue(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeAuthorityValue).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeAuthorityValue(object[key])}`)
    .join(',')}}`;
}

function encode(value: unknown): string {
  return Buffer.from(canonicalizeAuthorityValue(value), 'utf8').toString(
    'base64url',
  );
}

function decode<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

@Injectable()
export class SupervisorAuthorityService {
  private readonly keyRegistry: AuthorityKeyRegistry;

  constructor(
    config: ConfigService,
    @Optional()
    @Inject(SUPERVISOR_AUTHORITY_KEYRING)
    keyRegistry?: AuthorityKeyRegistry,
  ) {
    this.keyRegistry =
      keyRegistry ?? new ConfigAuthorityKeyRegistry(config);
  }

  sign(domain: AuthorityKeyDomain, claims: AuthorityClaims): string {
    this.validateDomainClaims(domain, claims);

    if (
      domain === 'MERGE_APPROVAL' ||
      domain === 'DEPLOY_APPROVAL'
    ) {
      throw new ForbiddenException(
        'human_owner_approval_signer_required',
      );
    }
    const key = this.keyRegistry.getSigningKey(domain);
    if (!key.privateKeyPem) {
      throw new ServiceUnavailableException(
        'authority_signing_material_unavailable',
      );
    }

    const header: AuthorityEnvelopeHeader = {
      typ: 'ATLAS_AUTHORITY',
      alg: 'EdDSA',
      kid: key.kid,
    };
    const encodedHeader = encode(header);
    const encodedClaims = encode(claims);
    const signingInput = `${encodedHeader}.${encodedClaims}`;
    const signature = cryptoSign(
      null,
      Buffer.from(signingInput, 'utf8'),
      createPrivateKey(key.privateKeyPem),
    ).toString('base64url');
    return `${signingInput}.${signature}`;
  }

  verify(
    token: string,
    expected: AuthorityVerificationExpectation,
  ): AuthorityClaims {
    const parts = token?.split('.') ?? [];
    if (parts.length !== 3 || parts.some((part) => !part)) {
      throw new UnauthorizedException('authority_token_malformed');
    }

    let header: AuthorityEnvelopeHeader;
    let claims: AuthorityClaims;
    try {
      header = decode<AuthorityEnvelopeHeader>(parts[0]);
      claims = decode<AuthorityClaims>(parts[1]);
    } catch {
      throw new UnauthorizedException('authority_token_malformed');
    }

    if (
      header.typ !== 'ATLAS_AUTHORITY' ||
      header.alg !== 'EdDSA' ||
      !header.kid
    ) {
      throw new UnauthorizedException('authority_header_invalid');
    }

    const key = this.keyRegistry.getVerificationKey(
      expected.domain,
      header.kid,
    );
    const validSignature = cryptoVerify(
      null,
      Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'),
      createPublicKey(key.publicKeyPem),
      Buffer.from(parts[2], 'base64url'),
    );
    if (!validSignature) {
      throw new UnauthorizedException('authority_signature_invalid');
    }

    this.validateDomainClaims(expected.domain, claims);
    if (claims.aud !== expected.audience) {
      throw new ForbiddenException('authority_audience_mismatch');
    }
    if (claims.actorType !== expected.actorType) {
      throw new ForbiddenException('authority_actor_type_mismatch');
    }
    if (claims.tokenType !== expected.tokenType) {
      throw new ForbiddenException('authority_token_type_mismatch');
    }
    if (claims.purpose !== expected.purpose) {
      throw new ForbiddenException('authority_purpose_mismatch');
    }
    if (
      expected.claimEpoch !== undefined &&
      claims.claimEpoch !== expected.claimEpoch
    ) {
      throw new ForbiddenException('authority_claim_epoch_stale');
    }
    if (expected.taskId !== undefined && claims.taskId !== expected.taskId) {
      throw new ForbiddenException('authority_task_mismatch');
    }
    if (
      expected.executionId !== undefined &&
      claims.executionId !== expected.executionId
    ) {
      throw new ForbiddenException('authority_execution_mismatch');
    }
    if (
      expected.manifestHash !== undefined &&
      claims.manifestHash !== expected.manifestHash
    ) {
      throw new ForbiddenException('authority_manifest_mismatch');
    }
    if (
      expected.candidateHash !== undefined &&
      claims.candidateHash !== expected.candidateHash
    ) {
      throw new ForbiddenException(
        'authority_candidate_mismatch',
      );
    }


    const now = expected.now ?? new Date();
    if (now.getTime() >= Date.parse(claims.exp)) {
      throw new UnauthorizedException('authority_token_expired');
    }
    if (now.getTime() < Date.parse(claims.iat)) {
      throw new UnauthorizedException('authority_token_not_yet_valid');
    }
    return claims;
  }

  private validateDomainClaims(
    domain: AuthorityKeyDomain,
    claims: AuthorityClaims,
  ): void {
    const rule = DOMAIN_RULES[domain];
    if (
      claims.actorType !== rule.actorType ||
      claims.tokenType !== rule.tokenType ||
      !rule.purposes.includes(claims.purpose)
    ) {
      throw new ForbiddenException('authority_domain_claim_mismatch');
    }
    if (claims.iss !== AUTHORITY_ISSUER) {
      throw new ForbiddenException('authority_issuer_mismatch');
    }
    const expectedSubject =
      domain === 'SUPERVISOR_SYSTEM'
        ? 'atlas:executive-supervisor'
        : domain === 'WORKER_CAPABILITY'
          ? 'atlas:worker-execution'
          : domain === 'VERIFIER_CAPABILITY'
            ? 'atlas:verifier-execution'
            : typeof claims.authorizedBy === 'string' && claims.authorizedBy.trim()
              ? `atlas:human-owner:${claims.authorizedBy}`
              : undefined;
    if (!expectedSubject || claims.sub !== expectedSubject) {
      throw new ForbiddenException('authority_subject_mismatch');
    }
    if (
      !claims.iss ||
      !claims.sub ||
      !claims.aud ||
      !claims.jti ||
      !Number.isInteger(claims.claimEpoch) ||
      claims.claimEpoch < 0 ||
      !Number.isFinite(Date.parse(claims.iat)) ||
      !Number.isFinite(Date.parse(claims.exp)) ||
      Date.parse(claims.exp) <= Date.parse(claims.iat)
    ) {
      throw new ForbiddenException('authority_claims_invalid');
    }
    if (
      (domain === 'WORKER_CAPABILITY' || domain === 'VERIFIER_CAPABILITY') &&
      (!claims.taskId || !claims.executionId || !claims.manifestHash)
    ) {
      throw new ForbiddenException('authority_execution_binding_required');
    }
  }
}
