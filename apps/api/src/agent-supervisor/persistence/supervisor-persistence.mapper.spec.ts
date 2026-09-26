import { InternalServerErrorException } from '@nestjs/common';
import {
  mapExecutionRecord,
  mapTaskRecord,
} from './supervisor-persistence.mapper';
import { createTestSupervisorAuthority } from '../authority/test-authority';
import type { ConfigService } from '@nestjs/config';
import { HumanOwnerApprovalService } from '../authority/human-owner-approval.service';

const createdAt = new Date('2026-08-30T00:00:00.000Z');
const updatedAt = new Date('2026-08-30T00:01:00.000Z');
// R2A_OUT_OF_SCOPE_PERSISTENCE_OWNER_FIXTURE_BEGIN
const R2A_PERSISTENCE_OWNER_ID =
  'owner-user-1';

const R2A_PERSISTENCE_OWNER_TOKEN =
  'r2a-persistence-owner-token';

function r2aPersistenceOwnerApprovals() {
  const authority =
    createTestSupervisorAuthority();

  const keyRegistry =
    (
      authority as unknown as {
        keyRegistry?: unknown;
      }
    ).keyRegistry;

  if (!keyRegistry) {
    throw new Error(
      'r2a_persistence_owner_keyring_missing',
    );
  }

  const config = {
    get: (key: string) => {
      if (
        key ===
        'ATLAS_SUPERVISOR_OWNER_USER_ID'
      ) {
        return R2A_PERSISTENCE_OWNER_ID;
      }

      if (
        key ===
        'ATLAS_SUPERVISOR_OWNER_TOKEN'
      ) {
        return R2A_PERSISTENCE_OWNER_TOKEN;
      }

      return undefined;
    },
  } as unknown as ConfigService;

  return new HumanOwnerApprovalService(
    config,
    keyRegistry as never,
  );
}

function r2aMergeApprovalFixture() {
  const candidate = {
    action: 'merge' as const,
    targetBranch: 'production/atlas',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    changedFiles: [
      'apps/api/src/example.ts',
    ],
  };

  const approvals =
    r2aPersistenceOwnerApprovals();

  const proof =
    approvals.verifyAuthentication(
      {
        userId:
          R2A_PERSISTENCE_OWNER_ID,
        ownerAction: '1',
        ownerToken:
          R2A_PERSISTENCE_OWNER_TOKEN,
      },
      {
        action: 'MERGE',
        candidate,
      },
    );

  return approvals.issueMergeApproval(
    proof,
    candidate,
    new Date(
      '2026-09-01T00:00:00.000Z',
    ),
  );
}

function r2aDeployApprovalFixture() {
  const candidate = {
    action: 'deploy_production' as const,
    targetBranch: 'production/atlas',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    changedFiles: [
      'apps/api/src/example.ts',
    ],
  };

  const approvals =
    r2aPersistenceOwnerApprovals();

  const proof =
    approvals.verifyAuthentication(
      {
        userId:
          R2A_PERSISTENCE_OWNER_ID,
        ownerAction: '1',
        ownerToken:
          R2A_PERSISTENCE_OWNER_TOKEN,
      },
      {
        action: 'DEPLOY',
        candidate,
        service: 'api',
      },
    );

  return approvals.issueDeployApproval(
    proof,
    candidate,
    'api',
    new Date(
      '2026-09-02T00:00:00.000Z',
    ),
  );
}

const mergeApproval =
  r2aMergeApprovalFixture();

const deployApproval =
  r2aDeployApprovalFixture();

const mergeApprovalSignature =
  mergeApproval.signature;

const deployApprovalSignature =
  deployApproval.signature;
// R2A_OUT_OF_SCOPE_PERSISTENCE_OWNER_FIXTURE_END

function reviewCandidateFixture() {
  return {
    action: 'merge',
    targetBranch: 'production/atlas',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    changedFiles: ['apps/api/src/example.ts'],
  };
}

function ownerAuthorizationFixture() {
  return {
    candidate: reviewCandidateFixture(),
    authorizedBy:
      mergeApproval.authorizedBy,
    authorizedAt:
      mergeApproval.authorizedAt,
    signature: mergeApprovalSignature,
  };
}

function deploymentCandidateFixture() {
  return {
    ...reviewCandidateFixture(),
    action: 'deploy_production',
  };
}

function ownerDeploymentAuthorizationFixture() {
  return {
    candidate: deploymentCandidateFixture(),
    service: 'api',
    authorizedBy:
      deployApproval.authorizedBy,
    authorizedAt:
      deployApproval.authorizedAt,
    signature: deployApprovalSignature,
  };
}

function ownerDeploymentAuthorizationRevocationFixture() {
  return {
    candidate: deploymentCandidateFixture(),
    service: 'api',
    authorizedBy: 'owner-user-1',
    authorizedAt: '2026-09-02T00:00:00.000Z',
    revokedBy: 'owner-user-2',
    revokedAt: '2026-09-05T15:31:00.000Z',
    reason:
      'Astra Governance v2 bootstrap deployment completed and authorization no longer required',
  };
}

function evidenceFixture() {
  return {
    rootCause: 'Known cause',
    changedFiles: ['apps/api/src/example.ts'],
    tests: ['focused test PASS'],
    build: 'PASS',
    regression: ['adjacent PASS'],
    deploymentState: 'NOT_DEPLOYED',
    gitState: 'NO_INTEGRATION_PERFORMED',
    remainingRisk: ['none'],
    reviewCandidate: reviewCandidateFixture(),
  };
}

function taskRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ATLAS-20260830-0001',
    objective: 'Persist supervisor task',
    owner: 'backend',
    status: 'WORKING',
    allowedPaths: ['apps/api/src/example.ts'],
    forbiddenActions: ['merge'],
    dependsOn: ['ATLAS-20260830-0000'],
    acceptance: ['focused tests pass'],
    evidence: evidenceFixture(),
    blockingReason: null,
    failureReason: null,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

function assignmentFixture() {
  return {
    executionId: 'ATLAS-EXEC-20260830-0001',
    taskId: 'ATLAS-20260830-0001',
    workerRole: 'backend',
    executionPurpose: 'IMPLEMENTATION',
    frozenBaseSha: 'f'.repeat(40),
    objective: 'Persist supervisor task',
    allowedPaths: ['apps/api/src/example.ts'],
    forbiddenActions: ['merge'],
    dependencies: [],
    acceptance: ['focused tests pass'],
    requiredEvidence: [
      'rootCause',
      'changedFiles',
      'tests',
      'build',
      'regression',
      'deploymentState',
      'gitState',
      'remainingRisk',
    ],
    manifestHash: 'a'.repeat(64),
    claimEpoch: 1,
    leaseId: 'lease-1',
    runnerId: 'runner-1',
    workerCapability: {
      version: 2,
      assignmentDigest: 'b'.repeat(64),
      allowedActions: ['read_assignment'],
      manifestHash: 'a'.repeat(64),
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge'],
      claimEpoch: 1,
      leaseId: 'lease-1',
      runnerId: 'runner-1',
      jti: 'worker-jti-1',
      issuedAt: '2026-08-30T00:00:00.000Z',
      expiresAt: '2026-08-30T00:05:00.000Z',
    },
  };
}

function executionResultFixture() {
  return {
    summary: 'Implemented',
    evidence: evidenceFixture(),
  };
}

function executionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ATLAS-EXEC-20260830-0001',
    taskId: 'ATLAS-20260830-0001',
    workerRole: 'backend',
    status: 'COMPLETED',
    assignment: assignmentFixture(),
    result: executionResultFixture(),
    error: null,
    createdAt,
    startedAt: new Date('2026-08-30T00:00:10.000Z'),
    completedAt: new Date('2026-08-30T00:00:20.000Z'),
    runnerId: null,
    claimEpoch: 0,
    lastHeartbeatAt: null,
    leaseExpiresAt: null,
    ...overrides,
  };
}

type ExecutionLivenessFields = {
  runnerId: string | null;
  claimEpoch: number;
  lastHeartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
};

function executionRecordWithLiveness(
  overrides: Record<string, unknown> = {},
) {
  return {
    ...executionRecord(),
    runnerId: 'runner-s2-red',
    claimEpoch: 3,
    lastHeartbeatAt: new Date('2026-09-12T01:02:03.000Z'),
    leaseExpiresAt: new Date('2026-09-12T01:12:03.000Z'),
    ...overrides,
  };
}

function expectPersistenceError(callback: () => unknown) {
  try {
    callback();
    throw new Error('expected mapper to reject malformed persisted JSON');
  } catch (error) {
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect((error as InternalServerErrorException).getResponse()).toEqual({
      code: 'supervisor_persistence_error',
    });
  }
}

describe('supervisor persistence mapper', () => {
  const receiptFixture = () => ({
    taskId: 'ATLAS-20260830-0001',
    executionId: 'ATLAS-EXEC-20260830-0001',
    candidateBranch:
      'atlas/candidate/ATLAS-20260830-0001/ATLAS-EXEC-20260830-0001',
    baseSha: 'f'.repeat(40),
    headSha: 'b'.repeat(40),
    changedFiles: ['apps/api/src/example.ts'],
    targetBranch: 'production/atlas',
    remoteHeadSha: 'b'.repeat(40),
    remoteVerified: true,
  });

  it('preserves a persisted verified publication receipt on both task and execution', () => {
    const receipt = receiptFixture();
    const evidence = { ...evidenceFixture(), candidatePublication: receipt };
    const task = mapTaskRecord(taskRecord({ evidence }));
    const execution = mapExecutionRecord(
      executionRecord({ result: { summary: 'Implemented', evidence } }),
    );
    expect(task.evidence?.candidatePublication).toEqual(receipt);
    expect(execution.result?.evidence.candidatePublication).toEqual(receipt);
    expect(task.evidence?.candidatePublication).not.toBe(receipt);
    expect(execution.result?.evidence.candidatePublication).not.toBe(receipt);
    expect(task.evidence?.candidatePublication?.changedFiles).not.toBe(
      receipt.changedFiles,
    );
    expect(execution.result?.evidence.candidatePublication?.changedFiles).not.toBe(
      receipt.changedFiles,
    );
    receipt.changedFiles.push('apps/api/src/elsewhere.ts');
    expect(task.evidence?.candidatePublication?.changedFiles).toEqual([
      'apps/api/src/example.ts',
    ]);
    expect(execution.result?.evidence.candidatePublication?.changedFiles).toEqual([
      'apps/api/src/example.ts',
    ]);
  });

  it('rejects malformed persisted candidate publication receipts', () => {
    const valid = receiptFixture();
    const malformed: Array<Record<string, unknown>> = [
      { ...valid, remoteVerified: false },
      { ...valid, remoteVerified: 'true' },
      { ...valid, remoteVerified: undefined },
      { ...valid, candidateBranch: 'atlas/candidate/another-task/another-execution' },
      { ...valid, targetBranch: 'main' },
      { ...valid, headSha: 'not-a-git-sha' },
      { ...valid, remoteHeadSha: 'c'.repeat(40) },
      { ...valid, changedFiles: 'apps/api/src/example.ts' },
      { ...valid, changedFiles: [''] },
      { ...valid, executionId: '' },
    ];
    for (const receipt of malformed) {
      const evidence = { ...evidenceFixture(), candidatePublication: receipt };
      expectPersistenceError(() => mapTaskRecord(taskRecord({ evidence })));
      expectPersistenceError(() => mapExecutionRecord(
        executionRecord({ result: { summary: 'Implemented', evidence } }),
      ));
    }
  });

  it('maps a valid task record and clones arrays plus exact review candidate', () => {
    const record = taskRecord();
    const task = mapTaskRecord(record);

    expect(task).toMatchObject({
      id: record.id,
      owner: 'backend',
      status: 'WORKING',
    });
    expect(task.allowedPaths).toEqual(record.allowedPaths);
    expect(task.allowedPaths).not.toBe(record.allowedPaths);
    expect(task.forbiddenActions).not.toBe(record.forbiddenActions);
    expect(task.dependsOn).not.toBe(record.dependsOn);
    expect(task.acceptance).not.toBe(record.acceptance);
    expect(task.evidence).toEqual(record.evidence);
    expect(task.evidence).not.toBe(record.evidence);
    expect(task.evidence?.changedFiles).not.toBe(
      (record.evidence as ReturnType<typeof evidenceFixture>).changedFiles,
    );
    expect(task.evidence?.reviewCandidate).not.toBe(
      (record.evidence as ReturnType<typeof evidenceFixture>).reviewCandidate,
    );
    expect(task.evidence?.reviewCandidate?.changedFiles).not.toBe(
      (record.evidence as ReturnType<typeof evidenceFixture>).reviewCandidate
        .changedFiles,
    );
  });

  it('maps and clones persisted signed owner merge authorization', () => {
    const evidence = {
      ...evidenceFixture(),
      ownerMergeAuthorization: ownerAuthorizationFixture(),
    };
    const task = mapTaskRecord(taskRecord({ evidence }));

    expect(task.evidence?.ownerMergeAuthorization).toEqual(
      ownerAuthorizationFixture(),
    );
    expect(task.evidence?.ownerMergeAuthorization).not.toBe(
      evidence.ownerMergeAuthorization,
    );
    expect(
      task.evidence?.ownerMergeAuthorization?.candidate.changedFiles,
    ).not.toBe(evidence.ownerMergeAuthorization.candidate.changedFiles);
  });

  it('maps and clones persisted signed owner deployment authorization', () => {
    const evidence = {
      ...evidenceFixture(),
      reviewCandidate: deploymentCandidateFixture(),
      ownerDeploymentAuthorization: ownerDeploymentAuthorizationFixture(),
    };
    const task = mapTaskRecord(taskRecord({ evidence })) as ReturnType<
      typeof mapTaskRecord
    > & {
      evidence: NonNullable<ReturnType<typeof mapTaskRecord>['evidence']> & {
        ownerDeploymentAuthorization?: ReturnType<
          typeof ownerDeploymentAuthorizationFixture
        >;
      };
    };

    expect(task.evidence.ownerDeploymentAuthorization).toEqual(
      ownerDeploymentAuthorizationFixture(),
    );
    expect(task.evidence.ownerDeploymentAuthorization).not.toBe(
      evidence.ownerDeploymentAuthorization,
    );
    expect(
      task.evidence.ownerDeploymentAuthorization?.candidate.changedFiles,
    ).not.toBe(evidence.ownerDeploymentAuthorization.candidate.changedFiles);
  });

  // ASTRA_V2_DEPLOYMENT_REVOCATION_MAPPER_RED
  it('maps and clones persisted deployment authorization revocation history', () => {
    const revocation =
      ownerDeploymentAuthorizationRevocationFixture();

    const evidence = {
      ...evidenceFixture(),
      reviewCandidate: deploymentCandidateFixture(),
      ownerDeploymentAuthorizationRevocations: [revocation],
    };

    const task = mapTaskRecord(taskRecord({ evidence }));

    expect(
      task.evidence?.ownerDeploymentAuthorizationRevocations,
    ).toEqual([revocation]);

    expect(
      task.evidence?.ownerDeploymentAuthorizationRevocations,
    ).not.toBe(
      evidence.ownerDeploymentAuthorizationRevocations,
    );

    expect(
      task.evidence
        ?.ownerDeploymentAuthorizationRevocations?.[0]
        ?.candidate.changedFiles,
    ).not.toBe(revocation.candidate.changedFiles);
  });

  it.each([
    { service: 'invalid' },
    { revokedBy: '   ' },
    { revokedAt: 'not-a-date' },
    { reason: '   ' },
    {
      candidate: {
        ...deploymentCandidateFixture(),
        action: 'merge',
      },
    },
  ])(
    'rejects malformed persisted deployment revocation: %p',
    (override) => {
      const evidence = {
        ...evidenceFixture(),
        ownerDeploymentAuthorizationRevocations: [
          {
            ...ownerDeploymentAuthorizationRevocationFixture(),
            ...override,
          },
        ],
      };

      expectPersistenceError(() =>
        mapTaskRecord(taskRecord({ evidence })),
      );
    },
  );

  it('keeps backward compatibility with persisted evidence that predates review candidates and owner authorization', () => {
    const legacy = evidenceFixture();
    delete (legacy as Partial<typeof legacy>).reviewCandidate;
    const task = mapTaskRecord(taskRecord({ evidence: legacy }));

    expect(task.evidence?.reviewCandidate).toBeUndefined();
    expect(task.evidence?.ownerMergeAuthorization).toBeUndefined();
  });

  it('round-trips null task evidence', () => {
    const task = mapTaskRecord(taskRecord({ evidence: null }));

    expect(task.evidence).toBeNull();
  });

  it('maps valid execution assignment and result as cloned objects', () => {
    const record = executionRecord();
    const execution = mapExecutionRecord(record);

    expect(execution.assignment).toEqual(record.assignment);
    expect(execution.assignment).not.toBe(record.assignment);
    expect(execution.assignment.allowedPaths).not.toBe(
      (record.assignment as ReturnType<typeof assignmentFixture>).allowedPaths,
    );
    expect(execution.result).toEqual(record.result);
    expect(execution.result).not.toBe(record.result);
    expect(execution.result?.evidence.changedFiles).not.toBe(
      (record.result as ReturnType<typeof executionResultFixture>).evidence
        .changedFiles,
    );
    expect(execution.result?.evidence.reviewCandidate?.changedFiles).not.toBe(
      (record.result as ReturnType<typeof executionResultFixture>).evidence
        .reviewCandidate.changedFiles,
    );
  });

  it('maps execution liveness fields from persistence', () => {
    const record = executionRecordWithLiveness();
    const mapped = mapExecutionRecord(record) as ReturnType<
      typeof mapExecutionRecord
    > &
      ExecutionLivenessFields;

    expect(mapped.runnerId).toBe('runner-s2-red');
    expect(mapped.claimEpoch).toBe(3);
    expect(mapped.lastHeartbeatAt).toEqual(
      new Date('2026-09-12T01:02:03.000Z'),
    );
    expect(mapped.leaseExpiresAt).toEqual(
      new Date('2026-09-12T01:12:03.000Z'),
    );
  });

  it.each([-1, 1.5])(
    'rejects invalid persisted claimEpoch: %p',
    (claimEpoch) => {
      expectPersistenceError(() =>
        mapExecutionRecord(executionRecordWithLiveness({ claimEpoch })),
      );
    },
  );

  it('rejects malformed persisted review-candidate JSON', () => {
    const evidence = evidenceFixture();
    (evidence as Record<string, unknown>).reviewCandidate = {
      ...reviewCandidateFixture(),
      action: 'force_push',
    };

    expectPersistenceError(() => mapTaskRecord(taskRecord({ evidence })));
  });

  it('rejects malformed persisted owner authorization JSON', () => {
    const evidence = {
      ...evidenceFixture(),
      ownerMergeAuthorization: {
        ...ownerAuthorizationFixture(),
        candidate: {
          ...reviewCandidateFixture(),
          action: 'force_push',
        },
      },
    };

    expectPersistenceError(() => mapTaskRecord(taskRecord({ evidence })));
  });

  it('rejects non-string persisted owner authorization signatures', () => {
    const evidence = {
      ...evidenceFixture(),
      ownerMergeAuthorization: {
        ...ownerAuthorizationFixture(),
        signature: 1234,
      },
    };

    expectPersistenceError(() => mapTaskRecord(taskRecord({ evidence })));
  });

  it('round-trips structurally valid EdDSA merge and deploy approvals', () => {
    const evidence = {
      ...evidenceFixture(),
      ownerMergeAuthorization: ownerAuthorizationFixture(),
      ownerDeploymentAuthorization: ownerDeploymentAuthorizationFixture(),
    };

    const task = mapTaskRecord(
      taskRecord({
        evidence: {
          ...evidence,
          reviewCandidate: deploymentCandidateFixture(),
        },
      }),
    );

    expect(task.evidence?.ownerMergeAuthorization?.signature).toBe(
      mergeApprovalSignature,
    );
    expect(task.evidence?.ownerDeploymentAuthorization?.signature).toBe(
      deployApprovalSignature,
    );
  });

  it.each(['not-an-envelope', 'a.b', 'a.b.c', 'c'.repeat(64)])(
    'rejects malformed, truncated, or legacy approval signatures: %s',
    (signature) => {
      const evidence = {
        ...evidenceFixture(),
        ownerMergeAuthorization: {
          ...ownerAuthorizationFixture(),
          signature,
        },
      };

      expectPersistenceError(() => mapTaskRecord(taskRecord({ evidence })));
    },
  );

  it('rejects persisted deployment authorization for a merge candidate', () => {
    const evidence = {
      ...evidenceFixture(),
      ownerDeploymentAuthorization: {
        ...ownerDeploymentAuthorizationFixture(),
        candidate: reviewCandidateFixture(),
      },
    };

    expectPersistenceError(() => mapTaskRecord(taskRecord({ evidence })));
  });

  it('rejects malformed persisted deployment authorization signatures', () => {
    const evidence = {
      ...evidenceFixture(),
      ownerDeploymentAuthorization: {
        ...ownerDeploymentAuthorizationFixture(),
        signature: 1234,
      },
    };

    expectPersistenceError(() => mapTaskRecord(taskRecord({ evidence })));
  });

  it.each([null, 'assignment', 42, true, ['invalid']])(
    'rejects malformed assignment JSON: %p',
    (assignment) => {
      expectPersistenceError(() =>
        mapExecutionRecord(executionRecord({ assignment })),
      );
    },
  );

  it.each(['evidence', 42, true, ['invalid']])(
    'rejects malformed task evidence JSON: %p',
    (evidence) => {
      expectPersistenceError(() => mapTaskRecord(taskRecord({ evidence })));
    },
  );

  it.each(['result', 42, true, ['invalid']])(
    'rejects malformed execution result JSON: %p',
    (result) => {
      expectPersistenceError(() =>
        mapExecutionRecord(executionRecord({ result })),
      );
    },
  );

  // ASTRA_V2_CONSUMPTION_MAPPER_RED
  it('maps and clones persisted merge authorization consumption audit evidence', () => {
    const authorization = ownerAuthorizationFixture();
    const consumption = {
      authorization,
      attestation: {
        pullRequestNumber: 80,
        mergeCommitSha: 'd'.repeat(40),
        mergeParents: [
          authorization.candidate.baseSha,
          authorization.candidate.headSha,
        ],
        mergedAt: '2026-09-05T10:45:02.000Z',
      },
      consumedBy: 'owner-user-2',
      consumedAt: '2026-09-05T10:45:03.000Z',
    };

    const evidence = {
      ...evidenceFixture(),
      ownerMergeAuthorizationConsumption: consumption,
    };

    const task = mapTaskRecord(taskRecord({ evidence }));

    expect(
      (
        task.evidence as typeof task.evidence & {
          ownerMergeAuthorizationConsumption?: typeof consumption;
        }
      )?.ownerMergeAuthorizationConsumption,
    ).toEqual(consumption);

    expect(
      (
        task.evidence as typeof task.evidence & {
          ownerMergeAuthorizationConsumption?: typeof consumption;
        }
      )?.ownerMergeAuthorizationConsumption,
    ).not.toBe(consumption);
  });

  it('round-trips deploy authorization consumption separately from merge consumption', () => {
    const authorization = ownerDeploymentAuthorizationFixture();
    const consumption = {
      authorization,
      approvalJti: 'deploy-jti-1',
      candidateHash: 'b'.repeat(64),
      environment: 'production',
      consumedBy: 'deploy-gate',
      consumedAt: '2026-09-05T10:45:03.000Z',
    };
    const evidence = {
      ...evidenceFixture(),
      reviewCandidate: deploymentCandidateFixture(),
      ownerDeploymentAuthorization: authorization,
      ownerDeploymentAuthorizationConsumption: consumption,
    };

    const task = mapTaskRecord(taskRecord({ evidence }));
    const mapped = task.evidence?.ownerDeploymentAuthorizationConsumption;

    expect(mapped).toEqual(consumption);
    expect(mapped).not.toBe(consumption);
  });

});

describe('immutable existing-candidate persistence round-trip', () => {
  const proof = () => ({
    mode: 'EXISTING_CANDIDATE' as const,
    taskId: 'ATLAS-20260921-d837f3f0-31c4-4b58-bd5c-15ace24131e6',
    executionId: 'ATLAS-EXEC-EXACT',
    baseSha: '078658563cde6b9b21d9be38e883e54d62efd970',
    headSha: '24dd7bee3b608f8d42a3bffc3daa58df05158444',
    productionBaselineSha: '078658563cde6b9b21d9be38e883e54d62efd970',
    changedFiles: ['apps/engineering-runner/package.json', 'package-lock.json'],
    gitFingerprint: 'a'.repeat(64),
    sourceVerified: true as const,
  });
  it('retains exact assignment and independent verifier proof on DB readback', () => {
    const p = proof();
    const record = executionRecord();
    (record.assignment as any).executionPurpose = 'INDEPENDENT_VERIFICATION';
    (record.assignment as any).verificationMode = p.mode;
    (record.assignment as any).candidateBaseSha = p.baseSha;
    (record.assignment as any).candidateHeadSha = p.headSha;
    (record.assignment as any).productionBaselineSha = p.productionBaselineSha;
    (record.result as any).evidence.existingCandidateVerification = p;
    const mapped = mapExecutionRecord(record);
    expect(mapped.assignment).toEqual(expect.objectContaining({
      verificationMode: 'EXISTING_CANDIDATE',
      candidateHeadSha: p.headSha,
      candidateBaseSha: p.baseSha,
      productionBaselineSha: p.productionBaselineSha,
    }));
    expect(mapped.result?.evidence.existingCandidateVerification).toEqual(p);
    expect(mapped.result?.evidence.existingCandidateVerification).not.toBe(p);
  });
  it('rejects incomplete assignment or false source verification at DB boundary', () => {
    const record = executionRecord();
    (record.assignment as any).verificationMode = 'EXISTING_CANDIDATE';
    expectPersistenceError(() => mapExecutionRecord(record));
    const p = proof();
    const result = executionRecord();
    (result.result as any).evidence.existingCandidateVerification = {
      ...p, sourceVerified: false,
    };
    expectPersistenceError(() => mapExecutionRecord(result));
  });
});
