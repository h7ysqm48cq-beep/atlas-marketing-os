import { generateKeyPairSync } from 'node:crypto';
import { InMemoryAuthorityKeyRegistry } from '../authority/authority-key-registry';
import { SupervisorAuthorityService } from '../authority/supervisor-authority.service';
import {
  SUPERVISOR_SYSTEM_AUDIENCE,
  supervisorSystemAdmissionDigest,
  supervisorSystemVerificationAdmissionDigest,
  type SupervisorSystemAdmissionRequest,
  type SupervisorSystemVerificationAdmissionRequest,
} from './supervisor-system.guard';

const script = require('../../../scripts/supervisor-system-admit.cjs') as {
  admissionDigest: (
    input: SupervisorSystemAdmissionRequest,
  ) => string;
  verificationAdmissionDigest: (
    input: SupervisorSystemVerificationAdmissionRequest,
  ) => string;
  signAdmissionAssertion: (
    input: SupervisorSystemAdmissionRequest,
    options: {
      kid: string;
      privateKeyPem: string;
      now?: Date;
      ttlMs?: number;
    },
  ) => string;
  signVerificationAdmissionAssertion: (
    input: SupervisorSystemVerificationAdmissionRequest,
    options: {
      kid: string;
      privateKeyPem: string;
      now?: Date;
      ttlMs?: number;
    },
  ) => string;
};

function fixture() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: pair.privateKey
      .export({ format: 'pem', type: 'pkcs8' })
      .toString(),
    publicKeyPem: pair.publicKey
      .export({ format: 'pem', type: 'spki' })
      .toString(),
  };
}

function input(): SupervisorSystemAdmissionRequest {
  return {
    admissionId:
      '11111111-2222-3333-4444-555555555555',
    task: {
      objective: 'CLI parity',
      owner: 'engineering',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['passes'],
    },
    frozenBaseSha: 'a'.repeat(40),
  };
}

function verificationInput(): SupervisorSystemVerificationAdmissionRequest {
  return {
    admissionId:
      '66666666-7777-8888-9999-aaaaaaaaaaaa',
    task: {
      objective: `Verify immutable candidate base ${'a'.repeat(40)} head ${'b'.repeat(40)}`,
      owner: 'engineering',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['passes'],
    },
    candidateBaseSha: 'a'.repeat(40),
    candidateHeadSha: 'b'.repeat(40),
    productionBaselineSha: 'a'.repeat(40),
    targetBranch: 'production/atlas',
    changedPaths: ['apps/api/src/example.ts'],
  };
}

describe('supervisor-system-admit CLI contract', () => {
  it('uses the same admission digest as the API guard', () => {
    const request = input();

    expect(script.admissionDigest(request)).toBe(
      supervisorSystemAdmissionDigest(request),
    );
  });

  it('uses the same verification digest as the API guard', () => {
    const request = verificationInput();

    expect(script.verificationAdmissionDigest(request)).toBe(
      supervisorSystemVerificationAdmissionDigest(request),
    );
  });

  it('signs a system assertion accepted by SupervisorAuthorityService', () => {
    const system = fixture();
    const other = () => fixture();
    const registry =
      new InMemoryAuthorityKeyRegistry({
        SUPERVISOR_SYSTEM: system,
        WORKER_CAPABILITY: other(),
        VERIFIER_CAPABILITY: other(),
        MERGE_APPROVAL: other(),
        DEPLOY_APPROVAL: other(),
      });
    const authority =
      new SupervisorAuthorityService(
        { get: () => undefined } as never,
        registry,
      );
    const now =
      new Date('2026-09-18T10:00:00.000Z');
    const request = input();

    const token =
      script.signAdmissionAssertion(request, {
        kid: 'supervisor_system-v1',
        privateKeyPem: system.privateKeyPem,
        now,
      });

    expect(
      authority.verify(token, {
        domain: 'SUPERVISOR_SYSTEM',
        audience: SUPERVISOR_SYSTEM_AUDIENCE,
        actorType: 'EXECUTIVE_SUPERVISOR',
        tokenType: 'SYSTEM_ASSERTION',
        purpose: 'ADMISSION',
        claimEpoch: 0,
        now,
      }),
    ).toMatchObject({
      admissionId:
        request.admissionId.toLowerCase(),
      admissionDigest:
        supervisorSystemAdmissionDigest(request),
    });
  });
  it('signs a verification-coordination assertion accepted by SupervisorAuthorityService', () => {
    const system = fixture();
    const other = () => fixture();
    const registry = new InMemoryAuthorityKeyRegistry({
      SUPERVISOR_SYSTEM: system,
      WORKER_CAPABILITY: other(),
      VERIFIER_CAPABILITY: other(),
      MERGE_APPROVAL: other(),
      DEPLOY_APPROVAL: other(),
    });
    const authority = new SupervisorAuthorityService(
      { get: () => undefined } as never,
      registry,
    );
    const now = new Date('2026-09-18T10:00:00.000Z');
    const request = verificationInput();

    const token =
      script.signVerificationAdmissionAssertion(request, {
        kid: 'supervisor_system-v1',
        privateKeyPem: system.privateKeyPem,
        now,
      });

    expect(
      authority.verify(token, {
        domain: 'SUPERVISOR_SYSTEM',
        audience: SUPERVISOR_SYSTEM_AUDIENCE,
        actorType: 'EXECUTIVE_SUPERVISOR',
        tokenType: 'SYSTEM_ASSERTION',
        purpose: 'VERIFICATION_COORDINATION',
        claimEpoch: 0,
        now,
      }),
    ).toMatchObject({
      admissionId: request.admissionId.toLowerCase(),
      admissionDigest:
        supervisorSystemVerificationAdmissionDigest(request),
    });
  });

});
