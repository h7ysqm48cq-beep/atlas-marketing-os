import {
  createHash,
  createPrivateKey,
  randomUUID,
  sign as cryptoSign,
  timingSafeEqual,
} from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  ProductionDeploymentService,
  SupervisorReviewCandidate,
} from '../agent-supervisor.types';
import type {
  AuthorityClaims,
  AuthorityKeyRecord,
} from './authority.types';
import {
  HUMAN_OWNER_APPROVAL_KEYRING,
  type HumanOwnerApprovalKeyDomain,
  type HumanOwnerApprovalKeyRegistry,
} from './authority-key-registry';
import {
  canonicalizeAuthorityValue,
} from './supervisor-authority.service';

const APPROVAL_TTL_MS = 10 * 60 * 1_000;

export type HumanOwnerApprovalAction =
  | 'MERGE'
  | 'DEPLOY';

export interface HumanOwnerAuthenticationEvidence {
  userId: string;
  ownerAction: string;
  ownerToken: string;
}

export type HumanOwnerApprovalIntent =
  | {
      action: 'MERGE';
      candidate: SupervisorReviewCandidate;
    }
  | {
      action: 'DEPLOY';
      candidate: SupervisorReviewCandidate;
      service: ProductionDeploymentService;
    };

export interface HumanOwnerAuthenticationProof {
  readonly ownerId: string;
  readonly action: HumanOwnerApprovalAction;
  readonly intentHash: string;
}

function authorityHash(value: unknown): string {
  return createHash('sha256')
    .update(
      canonicalizeAuthorityValue(value),
      'utf8',
    )
    .digest('hex');
}

function encodeAuthorityValue(
  value: unknown,
): string {
  return Buffer.from(
    canonicalizeAuthorityValue(value),
    'utf8',
  ).toString('base64url');
}

@Injectable()
export class HumanOwnerApprovalService {
  private readonly issuedProofs =
    new WeakSet<HumanOwnerAuthenticationProof>();

  private readonly consumedProofs =
    new WeakSet<HumanOwnerAuthenticationProof>();

  constructor(
    private readonly config: ConfigService,
    @Inject(HUMAN_OWNER_APPROVAL_KEYRING)
    private readonly keyRegistry:
      HumanOwnerApprovalKeyRegistry,
  ) {}

  verifyAuthentication(
    evidence: HumanOwnerAuthenticationEvidence,
    intent: HumanOwnerApprovalIntent,
  ): HumanOwnerAuthenticationProof {
    const configuredOwnerId =
      this.config
        .get<string>(
          'ATLAS_SUPERVISOR_OWNER_USER_ID',
        )
        ?.trim();

    const configuredOwnerToken =
      this.config.get<string>(
        'ATLAS_SUPERVISOR_OWNER_TOKEN',
      );

    if (
      !configuredOwnerId ||
      !configuredOwnerToken ||
      evidence?.userId !== configuredOwnerId ||
      evidence?.ownerAction !== '1' ||
      !this.constantTimeEqual(
        evidence?.ownerToken,
        configuredOwnerToken,
      )
    ) {
      throw new UnauthorizedException(
        'human_owner_authentication_required',
      );
    }

    const proof: HumanOwnerAuthenticationProof =
      Object.freeze({
        ownerId: configuredOwnerId,
        action: intent.action,
        intentHash:
          this.approvalIntentHash(intent),
      });

    this.issuedProofs.add(proof);

    return proof;
  }

  issueMergeApproval(
    proof: HumanOwnerAuthenticationProof,
    candidate: SupervisorReviewCandidate,
    now = new Date(),
  ) {
    const intentHash =
      this.approvalIntentHash({
        action: 'MERGE',
        candidate,
      });

    const ownerId =
      this.requireProof(
        proof,
        'MERGE',
        intentHash,
      );

    const authorizedAt =
      now.toISOString();

    const candidateHash =
      authorityHash(candidate);

    const claims: AuthorityClaims = {
      iss: 'atlas.supervisor.control-plane',
      sub: `atlas:human-owner:${ownerId}`,
      aud: 'atlas:merge-gate',
      actorType: 'HUMAN_OWNER',
      tokenType: 'MERGE_APPROVAL',
      purpose: 'APPROVE_MERGE',
      iat: authorizedAt,
      exp: new Date(
        now.getTime() + APPROVAL_TTL_MS,
      ).toISOString(),
      jti: randomUUID(),
      claimEpoch: 0,
      authorizedBy: ownerId,
      authorizedAt,
      candidateHash,
    };

    const signature =
      this.signApproval(
        'MERGE_APPROVAL',
        claims,
      );

    this.consumedProofs.add(proof);

    return {
      candidate:
        structuredClone(candidate),
      authorizedBy: ownerId,
      authorizedAt,
      signature,
    };
  }

  issueDeployApproval(
    proof: HumanOwnerAuthenticationProof,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
    now = new Date(),
  ) {
    const intentHash =
      this.approvalIntentHash({
        action: 'DEPLOY',
        candidate,
        service,
      });

    const ownerId =
      this.requireProof(
        proof,
        'DEPLOY',
        intentHash,
      );

    const authorizedAt =
      now.toISOString();

    const candidateHash =
      authorityHash(candidate);

    const claims: AuthorityClaims = {
      iss: 'atlas.supervisor.control-plane',
      sub: `atlas:human-owner:${ownerId}`,
      aud: 'atlas:deploy-gate',
      actorType: 'HUMAN_OWNER',
      tokenType: 'DEPLOY_APPROVAL',
      purpose: 'APPROVE_DEPLOY',
      iat: authorizedAt,
      exp: new Date(
        now.getTime() + APPROVAL_TTL_MS,
      ).toISOString(),
      jti: randomUUID(),
      claimEpoch: 0,
      authorizedBy: ownerId,
      authorizedAt,
      service,
      candidateHash,
    };

    const signature =
      this.signApproval(
        'DEPLOY_APPROVAL',
        claims,
      );

    this.consumedProofs.add(proof);

    return {
      candidate:
        structuredClone(candidate),
      service,
      authorizedBy: ownerId,
      authorizedAt,
      signature,
    };
  }

  private requireProof(
    proof: HumanOwnerAuthenticationProof,
    action: HumanOwnerApprovalAction,
    intentHash: string,
  ): string {
    if (
      !proof ||
      typeof proof !== 'object' ||
      !this.issuedProofs.has(proof)
    ) {
      throw new ForbiddenException(
        'human_owner_authentication_proof_required',
      );
    }

    if (
      this.consumedProofs.has(proof)
    ) {
      throw new ForbiddenException(
        'human_owner_authentication_proof_consumed',
      );
    }

    if (
      proof.action !== action ||
      proof.intentHash !== intentHash
    ) {
      throw new ForbiddenException(
        'human_owner_approval_intent_mismatch',
      );
    }

    return proof.ownerId;
  }

  private approvalIntentHash(
    intent: HumanOwnerApprovalIntent,
  ): string {
    if (intent.action === 'MERGE') {
      return authorityHash({
        action: 'MERGE',
        candidate: intent.candidate,
      });
    }

    return authorityHash({
      action: 'DEPLOY',
      candidate: intent.candidate,
      service: intent.service,
    });
  }

  private signApproval(
    domain: HumanOwnerApprovalKeyDomain,
    claims: AuthorityClaims,
  ): string {
    const key: AuthorityKeyRecord =
      this.keyRegistry.getSigningKey(
        domain,
      );

    if (
      key.domain !== domain ||
      !key.kid ||
      !key.privateKeyPem
    ) {
      throw new ServiceUnavailableException(
        'authority_signing_material_unavailable',
      );
    }

    const header = {
      typ: 'ATLAS_AUTHORITY',
      alg: 'EdDSA',
      kid: key.kid,
    } as const;

    const encodedHeader =
      encodeAuthorityValue(header);

    const encodedClaims =
      encodeAuthorityValue(claims);

    const signingInput =
      `${encodedHeader}.${encodedClaims}`;

    const signature =
      cryptoSign(
        null,
        Buffer.from(
          signingInput,
          'utf8',
        ),
        createPrivateKey(
          key.privateKeyPem,
        ),
      ).toString('base64url');

    return `${signingInput}.${signature}`;
  }

  private constantTimeEqual(
    supplied: string | undefined,
    expected: string,
  ): boolean {
    if (
      typeof supplied !== 'string'
    ) {
      return false;
    }

    const left =
      Buffer.from(supplied, 'utf8');

    const right =
      Buffer.from(expected, 'utf8');

    if (
      left.length !== right.length
    ) {
      return false;
    }

    return timingSafeEqual(
      left,
      right,
    );
  }
}
