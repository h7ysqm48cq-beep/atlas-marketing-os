import { BadRequestException } from '@nestjs/common';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { testOnlySeparatedExecutions } from '../testing/independent-verifier.test-fixture';
import { requireCompletedIndependentVerification } from './independent-verification-ready';

const path = 'apps/api/src/issue140-example.ts';
const start = new Date('2026-09-21T09:01:00.000Z');

function task(): SupervisorTask {
  return {
    id: 'TEST-ISSUE140-READY', objective: 'first-hop actor readiness safety',
    owner: 'engineering', status: 'VERIFYING',
    allowedPaths: [path], forbiddenActions: [], dependsOn: [],
    acceptance: [], evidence: {
      rootCause: 'test-only gate', changedFiles: [path], tests: ['PASS'],
      build: 'PASS', regression: [], deploymentState: 'NOT_DEPLOYED',
      gitState: 'TEST_ONLY', remainingRisk: [],
    },
    blockingReason: null, failureReason: null,
    createdAt: new Date(start.getTime() - 1000), updatedAt: start,
  };
}
function records() {
  const source = task();
  const pair = testOnlySeparatedExecutions(
    source, new Date(start.getTime() + 1000),
  );
  return { source, implementation: pair[0], verifier: pair[1] };
}
function errorCode(task: SupervisorTask, records: SupervisorExecution[]): unknown {
  try {
    requireCompletedIndependentVerification(task, records);
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (error.getResponse() as { code?: string }).code;
    }
    throw error;
  }
  return 'ACCEPTED';
}

describe('Issue #140 interim READY first-hop identity gate — NOT signed attestation', () => {
  it('does not treat a completed verifier without implementation as independent', () => {
    const { source, verifier } = records();
    expect(errorCode(source, [verifier]))
      .toBe('independent_verifier_identity_required');
  });
  it('fails closed for historical verifier lacking a recognized actor claim', () => {
    const { source, implementation, verifier } = records();
    delete verifier.assignment.bootstrapActor;
    expect(errorCode(source, [implementation, verifier]))
      .toBe('independent_verifier_identity_required');
  });
  it('fails closed for historical implementation lacking a recognized actor claim', () => {
    const { source, implementation, verifier } = records();
    delete implementation.assignment.bootstrapActor;
    expect(errorCode(source, [implementation, verifier]))
      .toBe('independent_verifier_identity_required');
  });
  it('different runners do not make the same principal independent', () => {
    const { source, implementation, verifier } = records();
    verifier.assignment.bootstrapActor!.principalId =
      implementation.assignment.bootstrapActor!.principalId;
    expect(implementation.runnerId).not.toBe(verifier.runnerId);
    expect(errorCode(source, [implementation, verifier]))
      .toBe('independent_verifier_principal_separation_required');
  });
  it('different IDs or keys do not separate the same controlling principal', () => {
    const { source, implementation, verifier } = records();
    verifier.assignment.bootstrapActor!.controllingPrincipalId =
      implementation.assignment.bootstrapActor!.controllingPrincipalId;
    expect(errorCode(source, [implementation, verifier]))
      .toBe('independent_verifier_principal_separation_required');
  });
  it('rejects reuse of the same registered key ID', () => {
    const { source, implementation, verifier } = records();
    verifier.assignment.bootstrapActor!.kid =
      implementation.assignment.bootstrapActor!.kid;
    expect(errorCode(source, [implementation, verifier]))
      .toBe('independent_verifier_principal_separation_required');
  });
  it('allows implementation to finish BEFORE task becomes VERIFYING', () => {
    const { source, implementation, verifier } = records();
    // Real lifecycle: implementation ran in WORKING, then task entered
    // VERIFYING, then the independent verifier claimed its execution.
    source.updatedAt = new Date(verifier.startedAt!.getTime());
    expect(implementation.startedAt!.getTime())
      .toBeLessThan(source.updatedAt.getTime());
    expect(errorCode(source, [implementation, verifier])).toBe('ACCEPTED');
  });
  it('rejects verifier that started before VERIFYING task version', () => {
    const { source, implementation, verifier } = records();
    source.updatedAt = new Date(verifier.startedAt!.getTime() + 1);
    expect(errorCode(source, [implementation, verifier]))
      .toBe('independent_verification_required');
  });
  it('rejects an implementation completed after verification started', () => {
    const { source, implementation, verifier } = records();
    implementation.completedAt =
      new Date(verifier.startedAt!.getTime() + 1);
    expect(errorCode(source, [implementation, verifier]))
      .toBe('independent_verifier_identity_required');
  });
  it('rejects two purported completed implementations as ambiguous', () => {
    const { source, implementation, verifier } = records();
    // Preserve Date instance identity across the Jest VM boundary.
    const second = { ...implementation, id: 'TEST-OTHER-IMPL',
      assignment: { ...implementation.assignment, executionId: 'TEST-OTHER-IMPL' },
    };
    expect(errorCode(source, [implementation, second, verifier]))
      .toBe('independent_verifier_identity_required');
  });
  it('does not accept mismatching implementation file evidence', () => {
    const { source, implementation, verifier } = records();
    // Do not mutate the shared synthetic fixture evidence in the task/verifier.
    implementation.result = { ...implementation.result!, evidence: {
      ...implementation.result!.evidence, changedFiles: ['other.ts'],
    } };
    expect(errorCode(source, [implementation, verifier]))
      .toBe('independent_verifier_identity_required');
  });
  it('permits correctly shaped SYNTHETIC first-hop metadata, not production attestation', () => {
    const { source, implementation, verifier } = records();
    expect(errorCode(source, [implementation, verifier])).toBe('ACCEPTED');
  });
});
