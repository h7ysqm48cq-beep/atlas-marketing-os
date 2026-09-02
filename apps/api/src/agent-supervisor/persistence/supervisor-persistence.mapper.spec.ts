import { InternalServerErrorException } from '@nestjs/common';
import {
  mapExecutionRecord,
  mapTaskRecord,
} from './supervisor-persistence.mapper';

const createdAt = new Date('2026-08-30T00:00:00.000Z');
const updatedAt = new Date('2026-08-30T00:01:00.000Z');

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
    authorizedBy: 'owner-user-1',
    authorizedAt: '2026-09-01T00:00:00.000Z',
    signature: 'c'.repeat(64),
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
    authorizedBy: 'owner-user-1',
    authorizedAt: '2026-09-02T00:00:00.000Z',
    signature: 'd'.repeat(64),
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
});
