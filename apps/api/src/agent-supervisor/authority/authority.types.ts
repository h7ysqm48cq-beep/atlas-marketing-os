export const AUTHORITY_KEY_DOMAINS = [
  'SUPERVISOR_SYSTEM',
  'WORKER_CAPABILITY',
  'VERIFIER_CAPABILITY',
  'MERGE_APPROVAL',
  'DEPLOY_APPROVAL',
] as const;

export type AuthorityKeyDomain = (typeof AUTHORITY_KEY_DOMAINS)[number];

export type AuthorityActorType =
  | 'HUMAN_OWNER'
  | 'EXECUTIVE_SUPERVISOR'
  | 'WORKER_EXECUTION'
  | 'VERIFIER_EXECUTION';

export type AuthorityTokenType =
  | 'SYSTEM_ASSERTION'
  | 'WORKER_CAPABILITY'
  | 'VERIFIER_CAPABILITY'
  | 'MERGE_APPROVAL'
  | 'DEPLOY_APPROVAL';

export type AuthorityPurpose =
  | 'TASK_LIFECYCLE'
  | 'ADMISSION'
  | 'DISPATCH'
  | 'REPLAN'
  | 'CANCEL'
  | 'VERIFICATION_COORDINATION'
  | 'IMPLEMENTATION'
  | 'INDEPENDENT_VERIFICATION'
  | 'APPROVE_MERGE'
  | 'APPROVE_DEPLOY';

export interface AuthorityClaims {
  iss: string;
  sub: string;
  aud: string;
  actorType: AuthorityActorType;
  tokenType: AuthorityTokenType;
  purpose: AuthorityPurpose;
  iat: string;
  exp: string;
  jti: string;
  claimEpoch: number;
  [claim: string]: unknown;
}

export interface AuthorityEnvelopeHeader {
  typ: 'ATLAS_AUTHORITY';
  alg: 'EdDSA';
  kid: string;
}

export interface AuthorityKeyRecord {
  domain: AuthorityKeyDomain;
  kid: string;
  publicKeyPem: string;
  privateKeyPem?: string;
  status: 'ACTIVE' | 'VERIFY_ONLY' | 'REVOKED';
  notBefore?: string;
  notAfter?: string;
}

export interface AuthorityKeyRegistry {
  getSigningKey(domain: AuthorityKeyDomain): AuthorityKeyRecord;
  getVerificationKey(
    domain: AuthorityKeyDomain,
    kid: string,
  ): AuthorityKeyRecord;
}

export interface AuthorityVerificationExpectation {
  domain: AuthorityKeyDomain;
  audience: string;
  actorType: AuthorityActorType;
  tokenType: AuthorityTokenType;
  purpose: AuthorityPurpose;
  now?: Date;
  claimEpoch?: number;
  taskId?: string;
  executionId?: string;
  manifestHash?: string;
  candidateHash?: string;
}
