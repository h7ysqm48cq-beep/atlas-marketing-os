import {
  createHash,
  generateKeyPairSync,
} from 'node:crypto';
import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type {
  ProductionDeploymentService,
  SupervisorReviewCandidate,
} from '../agent-supervisor.types';
import type {
  AuthorityKeyDomain,
  AuthorityKeyRecord,
} from './authority.types';
import {
  InMemoryAuthorityKeyRegistry,
} from './authority-key-registry';
import {
  canonicalizeAuthorityValue,
  SupervisorAuthorityService,
} from './supervisor-authority.service';
import {
  HumanOwnerApprovalService,
} from './human-owner-approval.service';

const OWNER_ID = 'owner-user-1';
const OWNER_TOKEN = 'r2a-owner-authentication-token';
const NOW = new Date('2026-09-11T12:00:00.000Z');

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE =
  'apps/api/src/agent-supervisor/authority/supervisor-authority.service.ts';

function candidate(
  overrides: Partial<SupervisorReviewCandidate> = {},
): SupervisorReviewCandidate {
  return {
    action: 'merge',
    targetBranch: 'production/atlas',
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    changedFiles: [CHANGED_FILE],
    ...overrides,
  };
}

function deploymentCandidate(
  overrides: Partial<SupervisorReviewCandidate> = {},
): SupervisorReviewCandidate {
  return candidate({
    action: 'deploy_production',
    ...overrides,
  });
}

function pair() {
  const generated = generateKeyPairSync('ed25519');

  return {
    privateKeyPem: generated.privateKey
      .export({
        format: 'pem',
        type: 'pkcs8',
      })
      .toString(),
    publicKeyPem: generated.publicKey
      .export({
        format: 'pem',
        type: 'spki',
      })
      .toString(),
  };
}

function fixtures() {
  return {
    SUPERVISOR_SYSTEM: pair(),
    WORKER_CAPABILITY: pair(),
    VERIFIER_CAPABILITY: pair(),
    MERGE_APPROVAL: pair(),
    DEPLOY_APPROVAL: pair(),
  };
}

function config(
  overrides: Record<string, string | undefined> = {},
): ConfigService {
  const values: Record<string, string | undefined> = {
    ATLAS_SUPERVISOR_OWNER_USER_ID: OWNER_ID,
    ATLAS_SUPERVISOR_OWNER_TOKEN: OWNER_TOKEN,
    ...overrides,
  };

  return {
    get: jest.fn(
      (key: string) => values[key],
    ),
  } as unknown as ConfigService;
}

function signingRecord(
  domain: 'MERGE_APPROVAL' | 'DEPLOY_APPROVAL',
  material: ReturnType<typeof fixtures>,
): AuthorityKeyRecord {
  return {
    domain,
    kid: `${domain.toLowerCase()}-v1`,
    privateKeyPem:
      material[domain].privateKeyPem,
    publicKeyPem:
      material[domain].publicKeyPem,
    status: 'ACTIVE',
  };
}

function harness() {
  const material = fixtures();

  const ownerKeyRegistry = {
    getSigningKey: (
      domain: 'MERGE_APPROVAL' | 'DEPLOY_APPROVAL',
    ) => signingRecord(domain, material),
  };

  const approval =
    new HumanOwnerApprovalService(
      config(),
      ownerKeyRegistry as never,
    );

  const verifier =
    new SupervisorAuthorityService(
      config(),
      new InMemoryAuthorityKeyRegistry(
        material,
      ),
    );

  return {
    approval,
    verifier,
  };
}

function evidence(
  overrides: Partial<{
    userId: string;
    ownerAction: string;
    ownerToken: string;
  }> = {},
) {
  return {
    userId: OWNER_ID,
    ownerAction: '1',
    ownerToken: OWNER_TOKEN,
    ...overrides,
  };
}

function hashCandidate(
  value: SupervisorReviewCandidate,
) {
  return createHash('sha256')
    .update(
      canonicalizeAuthorityValue(value),
      'utf8',
    )
    .digest('hex');
}

describe('HumanOwnerApprovalService', () => {
  it('issues a merge approval only from a verified one-shot Human Owner proof', () => {
    const {
      approval,
      verifier,
    } = harness();

    const reviewed = candidate();

    const proof =
      approval.verifyAuthentication(
        evidence(),
        {
          action: 'MERGE',
          candidate: reviewed,
        },
      );

    const artifact =
      approval.issueMergeApproval(
        proof,
        reviewed,
        NOW,
      );

    expect(artifact).toMatchObject({
      authorizedBy: OWNER_ID,
      authorizedAt: NOW.toISOString(),
    });

    expect(artifact.signature).toEqual(
      expect.any(String),
    );

    const claims = verifier.verify(
      artifact.signature,
      {
        domain: 'MERGE_APPROVAL',
        audience: 'atlas:merge-gate',
        actorType: 'HUMAN_OWNER',
        tokenType: 'MERGE_APPROVAL',
        purpose: 'APPROVE_MERGE',
        now: NOW,
        candidateHash:
          hashCandidate(reviewed),
      },
    );

    expect(claims).toMatchObject({
      iss: 'atlas.supervisor.control-plane',
      sub: `atlas:human-owner:${OWNER_ID}`,
      actorType: 'HUMAN_OWNER',
      tokenType: 'MERGE_APPROVAL',
      purpose: 'APPROVE_MERGE',
      authorizedBy: OWNER_ID,
      candidateHash:
        hashCandidate(reviewed),
    });
  });

  it('issues a service-bound deploy approval from a verified Human Owner proof', () => {
    const {
      approval,
      verifier,
    } = harness();

    const reviewed =
      deploymentCandidate();

    const service:
      ProductionDeploymentService = 'api';

    const proof =
      approval.verifyAuthentication(
        evidence(),
        {
          action: 'DEPLOY',
          candidate: reviewed,
          service,
        },
      );

    const artifact =
      approval.issueDeployApproval(
        proof,
        reviewed,
        service,
        NOW,
      );

    const claims = verifier.verify(
      artifact.signature,
      {
        domain: 'DEPLOY_APPROVAL',
        audience: 'atlas:deploy-gate',
        actorType: 'HUMAN_OWNER',
        tokenType: 'DEPLOY_APPROVAL',
        purpose: 'APPROVE_DEPLOY',
        now: NOW,
        candidateHash:
          hashCandidate(reviewed),
      },
    );

    expect(artifact).toMatchObject({
      authorizedBy: OWNER_ID,
      authorizedAt: NOW.toISOString(),
    });

    expect(claims).toMatchObject({
      sub: `atlas:human-owner:${OWNER_ID}`,
      tokenType: 'DEPLOY_APPROVAL',
      purpose: 'APPROVE_DEPLOY',
      service: 'api',
      authorizedBy: OWNER_ID,
      candidateHash:
        hashCandidate(reviewed),
    });
  });

  it('rejects a non-owner identity before creating a proof', () => {
    const { approval } = harness();

    expect(() =>
      approval.verifyAuthentication(
        evidence({
          userId: 'executive-supervisor',
        }),
        {
          action: 'MERGE',
          candidate: candidate(),
        },
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects invalid Owner authentication material', () => {
    const { approval } = harness();

    expect(() =>
      approval.verifyAuthentication(
        evidence({
          ownerToken: 'fake-token',
        }),
        {
          action: 'MERGE',
          candidate: candidate(),
        },
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects absence of the explicit Owner action proof', () => {
    const { approval } = harness();

    expect(() =>
      approval.verifyAuthentication(
        evidence({
          ownerAction: '0',
        }),
        {
          action: 'MERGE',
          candidate: candidate(),
        },
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a structurally forged proof object', () => {
    const { approval } = harness();

    expect(() =>
      approval.issueMergeApproval(
        {
          ownerId: OWNER_ID,
          action: 'MERGE',
          intentHash: 'a'.repeat(64),
        } as never,
        candidate(),
        NOW,
      ),
    ).toThrow(
      'human_owner_authentication_proof_required',
    );
  });

  it('binds the proof to the exact merge candidate', () => {
    const { approval } = harness();

    const original = candidate();

    const proof =
      approval.verifyAuthentication(
        evidence(),
        {
          action: 'MERGE',
          candidate: original,
        },
      );

    expect(() =>
      approval.issueMergeApproval(
        proof,
        candidate({
          headSha: 'c'.repeat(40),
        }),
        NOW,
      ),
    ).toThrow(
      'human_owner_approval_intent_mismatch',
    );
  });

  it('binds a deploy proof to the exact service', () => {
    const { approval } = harness();

    const reviewed =
      deploymentCandidate();

    const proof =
      approval.verifyAuthentication(
        evidence(),
        {
          action: 'DEPLOY',
          candidate: reviewed,
          service: 'api',
        },
      );

    expect(() =>
      approval.issueDeployApproval(
        proof,
        reviewed,
        'web',
        NOW,
      ),
    ).toThrow(
      'human_owner_approval_intent_mismatch',
    );
  });

  it('does not allow merge/deploy proof substitution', () => {
    const { approval } = harness();

    const reviewed = candidate();

    const proof =
      approval.verifyAuthentication(
        evidence(),
        {
          action: 'MERGE',
          candidate: reviewed,
        },
      );

    expect(() =>
      approval.issueDeployApproval(
        proof,
        deploymentCandidate(),
        'api',
        NOW,
      ),
    ).toThrow(
      'human_owner_approval_intent_mismatch',
    );
  });

  it('consumes a verified proof exactly once', () => {
    const { approval } = harness();

    const reviewed = candidate();

    const proof =
      approval.verifyAuthentication(
        evidence(),
        {
          action: 'MERGE',
          candidate: reviewed,
        },
      );

    approval.issueMergeApproval(
      proof,
      reviewed,
      NOW,
    );

    expect(() =>
      approval.issueMergeApproval(
        proof,
        reviewed,
        NOW,
      ),
    ).toThrow(
      'human_owner_authentication_proof_consumed',
    );
  });

  it('fixes owner claims internally and ignores caller claim substitution attempts', () => {
    const {
      approval,
      verifier,
    } = harness();

    const reviewed = candidate();

    const proof =
      approval.verifyAuthentication(
        evidence(),
        {
          action: 'MERGE',
          candidate: reviewed,
        },
      );

    const artifact = (
      approval.issueMergeApproval as any
    )(
      proof,
      reviewed,
      NOW,
      {
        actorType:
          'EXECUTIVE_SUPERVISOR',
        tokenType:
          'SYSTEM_ASSERTION',
        purpose: 'IMPLEMENTATION',
        aud: 'attacker',
        authorizedBy: 'attacker',
      },
    );

    const claims = verifier.verify(
      artifact.signature,
      {
        domain: 'MERGE_APPROVAL',
        audience: 'atlas:merge-gate',
        actorType: 'HUMAN_OWNER',
        tokenType: 'MERGE_APPROVAL',
        purpose: 'APPROVE_MERGE',
        now: NOW,
        candidateHash:
          hashCandidate(reviewed),
      },
    );

    expect(claims.authorizedBy)
      .toBe(OWNER_ID);

    expect(claims.actorType)
      .toBe('HUMAN_OWNER');

    expect(claims.tokenType)
      .toBe('MERGE_APPROVAL');
  });

  it('fails closed when Owner authentication configuration is unavailable', () => {
    const material = fixtures();

    const approval =
      new HumanOwnerApprovalService(
        config({
          ATLAS_SUPERVISOR_OWNER_USER_ID:
            undefined,
          ATLAS_SUPERVISOR_OWNER_TOKEN:
            undefined,
        }),
        {
          getSigningKey: (
            domain:
              | 'MERGE_APPROVAL'
              | 'DEPLOY_APPROVAL',
          ) =>
            signingRecord(
              domain,
              material,
            ),
        } as never,
      );

    expect(() =>
      approval.verifyAuthentication(
        evidence(),
        {
          action: 'MERGE',
          candidate: candidate(),
        },
      ),
    ).toThrow(UnauthorizedException);
  });

  it('does not expose a generic domain-selectable signing API', () => {
    const { approval } = harness();

    expect(
      (approval as unknown as {
        sign?: unknown;
      }).sign,
    ).toBeUndefined();
  });
});
