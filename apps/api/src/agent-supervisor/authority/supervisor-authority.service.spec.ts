import { generateKeyPairSync } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  AuthorityKeyDomain,
  AuthorityTokenType,
  InMemoryAuthorityKeyRegistry,
  SupervisorAuthorityService,
} from './supervisor-authority.service';
import { ConfigAuthorityKeyRegistry } from './authority-key-registry';
import { SupervisorOwnerGuard } from '../gateway/supervisor-owner.guard';

type KeyFixture = {
  privateKeyPem: string;
  publicKeyPem: string;
};

const NOW = new Date('2026-09-11T00:00:00.000Z');

function keyFixture(): KeyFixture {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKeyPem: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

function registry(overrides: Partial<Record<AuthorityKeyDomain, KeyFixture>> = {}) {
  const records = {} as Record<AuthorityKeyDomain, KeyFixture>;
  for (const domain of [
    'SUPERVISOR_SYSTEM',
    'WORKER_CAPABILITY',
    'VERIFIER_CAPABILITY',
    'MERGE_APPROVAL',
    'DEPLOY_APPROVAL',
  ] as AuthorityKeyDomain[]) {
    records[domain] = overrides[domain] ?? keyFixture();
  }
  return new InMemoryAuthorityKeyRegistry(records);
}

function claims(tokenType: AuthorityTokenType) {
  const base = {
    iss: 'atlas.supervisor.control-plane',
    tokenType,
    iat: NOW.toISOString(),
    exp: new Date(NOW.getTime() + 60_000).toISOString(),
    jti: 'authority-jti',
    claimEpoch: 4,
  };
  if (tokenType === 'SYSTEM_ASSERTION') {
    return {
      ...base,
      sub: 'atlas:executive-supervisor',
      aud: 'atlas:supervisor.gateway',
      actorType: 'EXECUTIVE_SUPERVISOR' as const,
      purpose: 'TASK_LIFECYCLE' as const,
    };
  }
  if (tokenType === 'WORKER_CAPABILITY') {
    return {
      ...base,
      sub: 'atlas:worker-execution',
      aud: 'atlas:worker.gateway',
      actorType: 'WORKER_EXECUTION' as const,
      purpose: 'IMPLEMENTATION' as const,
    };
  }
  if (tokenType === 'VERIFIER_CAPABILITY') {
    return {
      ...base,
      sub: 'atlas:verifier-execution',
      aud: 'atlas:verifier.gateway',
      actorType: 'VERIFIER_EXECUTION' as const,
      purpose: 'INDEPENDENT_VERIFICATION' as const,
    };
  }
  return {
    ...base,
    sub: 'atlas:human-owner:owner-user-1',
    aud: tokenType === 'MERGE_APPROVAL' ? 'atlas:merge-gate' : 'atlas:deploy-gate',
    actorType: 'HUMAN_OWNER' as const,
    purpose: tokenType === 'MERGE_APPROVAL' ? 'APPROVE_MERGE' as const : 'APPROVE_DEPLOY' as const,
    authorizedBy: 'owner-user-1',
    authorizedAt: NOW.toISOString(),
  };
}

function config(values: Record<string, string | undefined>): ConfigService {
  return { get: jest.fn((name: string) => values[name]) } as unknown as ConfigService;
}

describe('SupervisorAuthorityService', () => {
  it('signs and verifies an Executive Supervisor system assertion', () => {
    const service = new SupervisorAuthorityService(config({}), registry());
    const token = service.sign('SUPERVISOR_SYSTEM', claims('SYSTEM_ASSERTION'));

    expect(
      service.verify(token, {
        domain: 'SUPERVISOR_SYSTEM',
        audience: 'atlas:supervisor.gateway',
        actorType: 'EXECUTIVE_SUPERVISOR',
        tokenType: 'SYSTEM_ASSERTION',
        purpose: 'TASK_LIFECYCLE',
        now: NOW,
        claimEpoch: 4,
      }),
    ).toMatchObject({ actorType: 'EXECUTIVE_SUPERVISOR', tokenType: 'SYSTEM_ASSERTION' });
  });

  it('does not read or derive authority from the Owner token', () => {
    const values = { ATLAS_SUPERVISOR_OWNER_TOKEN: 'owner-secret' };
    const service = new SupervisorAuthorityService(config(values));

    expect(() => service.sign('SUPERVISOR_SYSTEM', claims('SYSTEM_ASSERTION'))).toThrow(
      ServiceUnavailableException,
    );
    expect(values.ATLAS_SUPERVISOR_OWNER_TOKEN).toBe('owner-secret');
  });

  it('does not use the Owner token as a Worker signing fallback', () => {
    const service = new SupervisorAuthorityService(
      config({ ATLAS_SUPERVISOR_OWNER_TOKEN: 'owner-secret' }),
      new ConfigAuthorityKeyRegistry(
        config({ ATLAS_SUPERVISOR_OWNER_TOKEN: 'owner-secret' }),
      ),
    );

    expect(() =>
      service.sign('WORKER_CAPABILITY', {
        ...claims('WORKER_CAPABILITY'),
        actorType: 'WORKER_EXECUTION',
        purpose: 'IMPLEMENTATION',
        taskId: 'task-1',
        executionId: 'execution-1',
        manifestHash: 'a'.repeat(64),
      }),
    ).toThrow('authority_signing_material_unavailable');
  });

  it('rejects a system assertion at the worker verifier', () => {
    const service = new SupervisorAuthorityService(config({}), registry());
    const token = service.sign('SUPERVISOR_SYSTEM', claims('SYSTEM_ASSERTION'));

    expect(() =>
      service.verify(token, {
        domain: 'WORKER_CAPABILITY',
        audience: 'atlas:worker.gateway',
        actorType: 'WORKER_EXECUTION',
        tokenType: 'WORKER_CAPABILITY',
        purpose: 'IMPLEMENTATION',
        now: NOW,
      }),
    ).toThrow('authority_unknown_kid');
  });

  it('rejects Worker and Verifier capabilities across their domains', () => {
    const service = new SupervisorAuthorityService(config({}), registry());
    const worker = service.sign('WORKER_CAPABILITY', {
      ...claims('WORKER_CAPABILITY'),
      sub: 'atlas:worker-execution',
      aud: 'atlas:worker.gateway',
      actorType: 'WORKER_EXECUTION',
      purpose: 'IMPLEMENTATION',
      taskId: 'task-1',
      executionId: 'execution-1',
      manifestHash: 'a'.repeat(64),
    });

    expect(() =>
      service.verify(worker, {
        domain: 'VERIFIER_CAPABILITY',
        audience: 'atlas:verifier.gateway',
        actorType: 'VERIFIER_EXECUTION',
        tokenType: 'VERIFIER_CAPABILITY',
        purpose: 'INDEPENDENT_VERIFICATION',
        now: NOW,
      }),
    ).toThrow('authority_unknown_kid');
  });

  it('rejects missing signing material without Owner-token fallback', () => {
    const keys = registry();
    keys.revoke('WORKER_CAPABILITY');
    const service = new SupervisorAuthorityService(config({
      ATLAS_SUPERVISOR_OWNER_TOKEN: 'owner-secret',
    }), keys);

    expect(() =>
      service.sign('WORKER_CAPABILITY', {
      ...claims('WORKER_CAPABILITY'),
        actorType: 'WORKER_EXECUTION',
        purpose: 'IMPLEMENTATION',
        taskId: 'task-1',
        executionId: 'execution-1',
        manifestHash: 'a'.repeat(64),
      }),
    ).toThrow('authority_signing_material_revoked');
  });

  it('rejects stale epochs, expired tokens, wrong audience, and wrong purpose', () => {
    const service = new SupervisorAuthorityService(config({}), registry());
    const token = service.sign('SUPERVISOR_SYSTEM', claims('SYSTEM_ASSERTION'));

    expect(() => service.verify(token, {
      domain: 'SUPERVISOR_SYSTEM',
      audience: 'atlas:supervisor.gateway',
      actorType: 'EXECUTIVE_SUPERVISOR',
      tokenType: 'SYSTEM_ASSERTION',
      purpose: 'TASK_LIFECYCLE',
      now: NOW,
      claimEpoch: 5,
    })).toThrow('authority_claim_epoch_stale');

    expect(() => service.verify(token, {
      domain: 'SUPERVISOR_SYSTEM',
      audience: 'atlas:other.gateway',
      actorType: 'EXECUTIVE_SUPERVISOR',
      tokenType: 'SYSTEM_ASSERTION',
      purpose: 'TASK_LIFECYCLE',
      now: NOW,
    })).toThrow('authority_audience_mismatch');

    expect(() => service.verify(token, {
      domain: 'SUPERVISOR_SYSTEM',
      audience: 'atlas:supervisor.gateway',
      actorType: 'EXECUTIVE_SUPERVISOR',
      tokenType: 'SYSTEM_ASSERTION',
      purpose: 'DISPATCH',
      now: NOW,
    })).toThrow('authority_purpose_mismatch');

    const expired = service.sign('SUPERVISOR_SYSTEM', {
      ...claims('SYSTEM_ASSERTION'),
      iat: new Date(NOW.getTime() - 60_000).toISOString(),
      exp: new Date(NOW.getTime() - 1).toISOString(),
    });
    expect(() => service.verify(expired, {
      domain: 'SUPERVISOR_SYSTEM',
      audience: 'atlas:supervisor.gateway',
      actorType: 'EXECUTIVE_SUPERVISOR',
      tokenType: 'SYSTEM_ASSERTION',
      purpose: 'TASK_LIFECYCLE',
      now: NOW,
    })).toThrow('authority_token_expired');
  });

  it('rejects wrong actorType and wrong tokenType at the consumer boundary', () => {
    const service = new SupervisorAuthorityService(config({}), registry());
    const token = service.sign('SUPERVISOR_SYSTEM', claims('SYSTEM_ASSERTION'));
    expect(() => service.verify(token, {
      domain: 'SUPERVISOR_SYSTEM',
      audience: 'atlas:supervisor.gateway',
      actorType: 'WORKER_EXECUTION',
      tokenType: 'SYSTEM_ASSERTION',
      purpose: 'TASK_LIFECYCLE',
      now: NOW,
    })).toThrow('authority_actor_type_mismatch');
    expect(() => service.verify(token, {
      domain: 'SUPERVISOR_SYSTEM',
      audience: 'atlas:supervisor.gateway',
      actorType: 'EXECUTIVE_SUPERVISOR',
      tokenType: 'WORKER_CAPABILITY',
      purpose: 'TASK_LIFECYCLE',
      now: NOW,
    })).toThrow('authority_token_type_mismatch');
  });

  it('rejects an unknown kid within the correct authority domain', () => {
    const service = new SupervisorAuthorityService(config({}), registry());
    const token = service.sign('SUPERVISOR_SYSTEM', claims('SYSTEM_ASSERTION'));
    const [encodedHeader, encodedClaims, signature] = token.split('.');
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as Record<string, unknown>;
    header.kid = 'unknown-system-kid';
    const changedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    expect(() => service.verify(`${changedHeader}.${encodedClaims}.${signature}`, {
      domain: 'SUPERVISOR_SYSTEM',
      audience: 'atlas:supervisor.gateway',
      actorType: 'EXECUTIVE_SUPERVISOR',
      tokenType: 'SYSTEM_ASSERTION',
      purpose: 'TASK_LIFECYCLE',
      now: NOW,
    })).toThrow('authority_unknown_kid');
  });

  it('rejects System to Merge and System to Deploy authority escalation', () => {
    const service = new SupervisorAuthorityService(config({}), registry());
    const token = service.sign('SUPERVISOR_SYSTEM', claims('SYSTEM_ASSERTION'));
    expect(() => service.verify(token, {
      domain: 'MERGE_APPROVAL',
      audience: 'atlas:merge-gate',
      actorType: 'HUMAN_OWNER',
      tokenType: 'MERGE_APPROVAL',
      purpose: 'APPROVE_MERGE',
      now: NOW,
    })).toThrow('authority_unknown_kid');
    expect(() => service.verify(token, {
      domain: 'DEPLOY_APPROVAL',
      audience: 'atlas:deploy-gate',
      actorType: 'HUMAN_OWNER',
      tokenType: 'DEPLOY_APPROVAL',
      purpose: 'APPROVE_DEPLOY',
      now: NOW,
    })).toThrow('authority_unknown_kid');
  });

  it('rejects Worker to Merge and Worker to Deploy authority escalation', () => {
    const service = new SupervisorAuthorityService(config({}), registry());
    const token = service.sign('WORKER_CAPABILITY', {
      ...claims('WORKER_CAPABILITY'),
      taskId: 'task-1',
      executionId: 'execution-1',
      manifestHash: 'a'.repeat(64),
    });
    expect(() => service.verify(token, {
      domain: 'MERGE_APPROVAL',
      audience: 'atlas:merge-gate',
      actorType: 'HUMAN_OWNER',
      tokenType: 'MERGE_APPROVAL',
      purpose: 'APPROVE_MERGE',
      now: NOW,
    })).toThrow('authority_unknown_kid');
    expect(() => service.verify(token, {
      domain: 'DEPLOY_APPROVAL',
      audience: 'atlas:deploy-gate',
      actorType: 'HUMAN_OWNER',
      tokenType: 'DEPLOY_APPROVAL',
      purpose: 'APPROVE_DEPLOY',
      now: NOW,
    })).toThrow('authority_unknown_kid');
  });

  it('rejects Verifier to Worker and Verifier to Merge/Deploy escalation', () => {
    const service = new SupervisorAuthorityService(config({}), registry());
    const token = service.sign('VERIFIER_CAPABILITY', {
      ...claims('VERIFIER_CAPABILITY'),
      taskId: 'task-1',
      executionId: 'execution-1',
      manifestHash: 'a'.repeat(64),
    });
    expect(() => service.verify(token, {
      domain: 'WORKER_CAPABILITY',
      audience: 'atlas:worker.gateway',
      actorType: 'WORKER_EXECUTION',
      tokenType: 'WORKER_CAPABILITY',
      purpose: 'IMPLEMENTATION',
      now: NOW,
    })).toThrow('authority_unknown_kid');
    expect(() => service.verify(token, {
      domain: 'MERGE_APPROVAL',
      audience: 'atlas:merge-gate',
      actorType: 'HUMAN_OWNER',
      tokenType: 'MERGE_APPROVAL',
      purpose: 'APPROVE_MERGE',
      now: NOW,
    })).toThrow('authority_unknown_kid');
    expect(() => service.verify(token, {
      domain: 'DEPLOY_APPROVAL',
      audience: 'atlas:deploy-gate',
      actorType: 'HUMAN_OWNER',
      tokenType: 'DEPLOY_APPROVAL',
      purpose: 'APPROVE_DEPLOY',
      now: NOW,
    })).toThrow('authority_unknown_kid');
  });

  it('rejects a revoked key and prevents a system assertion from satisfying the Owner guard', () => {
    const keys = registry();
    const service = new SupervisorAuthorityService(config({}), keys);
    const token = service.sign('SUPERVISOR_SYSTEM', claims('SYSTEM_ASSERTION'));
    keys.revoke('SUPERVISOR_SYSTEM');

    expect(() =>
      service.verify(token, {
        domain: 'SUPERVISOR_SYSTEM',
        audience: 'atlas:supervisor.gateway',
        actorType: 'EXECUTIVE_SUPERVISOR',
        tokenType: 'SYSTEM_ASSERTION',
        purpose: 'TASK_LIFECYCLE',
        now: NOW,
      }),
    ).toThrow('authority_key_revoked');

    const ownerGuard = new SupervisorOwnerGuard(
      config({ ATLAS_SUPERVISOR_OWNER_TOKEN: 'owner-secret' }),
    );
    expect(() =>
      ownerGuard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            user: { id: 'owner-1' },
            headers: { 'x-atlas-supervisor-owner-token': token },
          }),
        }),
      } as never),
    ).toThrow('supervisor_owner_credential_invalid');
  });

  it.each([
    ['wrong issuer', { iss: 'legacy.supervisor' }, 'authority_issuer_mismatch'],
    [
      'wrong system subject',
      { sub: 'atlas:worker-execution' },
      'authority_subject_mismatch',
    ],
  ])('rejects %s on a system assertion', (_label, override, code) => {
    const service = new SupervisorAuthorityService(config({}), registry());
    expect(() =>
      service.sign('SUPERVISOR_SYSTEM', {
        ...claims('SYSTEM_ASSERTION'),
        ...override,
      }),
    ).toThrow(code);
  });

  it('rejects wrong Worker and Verifier subjects', () => {
    const service = new SupervisorAuthorityService(config({}), registry());
    const workerClaims = {
      ...claims('WORKER_CAPABILITY'),
      actorType: 'WORKER_EXECUTION' as const,
      purpose: 'IMPLEMENTATION' as const,
      sub: 'atlas:verifier-execution',
      taskId: 'task-1',
      executionId: 'execution-1',
      manifestHash: 'a'.repeat(64),
    };
    const verifierClaims = {
      ...claims('VERIFIER_CAPABILITY'),
      actorType: 'VERIFIER_EXECUTION' as const,
      purpose: 'INDEPENDENT_VERIFICATION' as const,
      sub: 'atlas:worker-execution',
      taskId: 'task-1',
      executionId: 'execution-1',
      manifestHash: 'a'.repeat(64),
    };

    expect(() => service.sign('WORKER_CAPABILITY', workerClaims)).toThrow(
      'authority_subject_mismatch',
    );
    expect(() => service.sign('VERIFIER_CAPABILITY', verifierClaims)).toThrow(
      'authority_subject_mismatch',
    );
  });

  it('rejects a Human Owner approval subject unrelated to authorizedBy', () => {
    const service = new SupervisorAuthorityService(config({}), registry());
    expect(() =>
      service.sign('MERGE_APPROVAL', {
        ...claims('MERGE_APPROVAL'),
        sub: 'atlas:human-owner:other-owner',
        actorType: 'HUMAN_OWNER',
        purpose: 'APPROVE_MERGE',
        authorizedBy: 'owner-user-1',
      }),
    ).toThrow('authority_subject_mismatch');
  });
});

// R2A_GENERIC_OWNER_SIGNER_RED_BEGIN
describe('R2A generic authority signer owner-approval hard cutover', () => {
  const ownerClaims = (
    domain: 'MERGE_APPROVAL' | 'DEPLOY_APPROVAL',
  ) => {
    const authorizedAt = '2026-09-11T12:00:00.000Z';

    return {
      iss: 'atlas.supervisor.control-plane',
      sub: 'atlas:human-owner:owner-user-1',
      aud:
        domain === 'MERGE_APPROVAL'
          ? 'atlas:merge-gate'
          : 'atlas:deploy-gate',
      actorType: 'HUMAN_OWNER' as const,
      tokenType: domain,
      purpose:
        domain === 'MERGE_APPROVAL'
          ? ('APPROVE_MERGE' as const)
          : ('APPROVE_DEPLOY' as const),
      iat: authorizedAt,
      exp: '2026-09-11T12:10:00.000Z',
      jti: `r2a-${domain.toLowerCase()}`,
      claimEpoch: 0,
      authorizedBy: 'owner-user-1',
      authorizedAt,
      candidateHash: 'a'.repeat(64),
      ...(domain === 'DEPLOY_APPROVAL'
        ? { service: 'api' as const }
        : {}),
    };
  };

  it.each([
    'MERGE_APPROVAL',
    'DEPLOY_APPROVAL',
  ] as const)(
    'rejects %s minting through SupervisorAuthorityService.sign',
    (domain) => {
      const {
        createTestSupervisorAuthority,
      } = require('./test-authority');

      const authority =
        createTestSupervisorAuthority();

      expect(() =>
        authority.sign(
          domain,
          ownerClaims(domain),
        ),
      ).toThrow(
        'human_owner_approval_signer_required',
      );
    },
  );
});
// R2A_GENERIC_OWNER_SIGNER_RED_END
