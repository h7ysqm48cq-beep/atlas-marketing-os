import { InternalServerErrorException } from '@nestjs/common';
import { mapTaskRecord } from './supervisor-persistence.mapper';

const path = 'apps/api/src/issue140.ts';
const receipt = {
  taskId: 'TASK-140', executionId: 'IMPL-140',
  candidateBranch: 'issue140/local-fixture',
  baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
  changedFiles: [path], targetBranch: 'production/atlas',
  remoteHeadSha: 'b'.repeat(40), remoteVerified: true,
};
const candidate = {
  action: 'merge', targetBranch: 'production/atlas',
  baseSha: receipt.baseSha, headSha: receipt.headSha,
  changedFiles: [path],
};
function mapped(next: unknown = receipt) {
  const value = {
    id: 'TASK-140', objective: 'strict receipt mapping',
    owner: 'engineering', status: 'VERIFYING',
    allowedPaths: [path], forbiddenActions: [],
    dependsOn: [], acceptance: [], blockingReason: null,
    failureReason: null, createdAt: new Date('2026-09-21T01:00:00Z'),
    updatedAt: new Date('2026-09-21T01:01:00Z'),
    evidence: {
      rootCause: 'test only', changedFiles: [path], tests: ['PASS'],
      build: 'PASS', regression: [], deploymentState: 'NOT_DEPLOYED',
      gitState: 'LOCAL_ONLY', remainingRisk: [],
      reviewCandidate: candidate,
      ...(next === 'ABSENT' ? {} : { candidatePublication: next }),
    },
  };
  return mapTaskRecord(value as never);
}
describe('Issue #140 lossless, strict candidate publication mapper', () => {
  it('round trips a valid receipt without dropping remote verification', () => {
    expect(mapped().evidence).toMatchObject({
      candidatePublication: receipt,
      reviewCandidate: candidate,
    });
  });
  it('keeps legitimately absent receipt absent, never invents one', () => {
    expect(mapped('ABSENT').evidence).not.toHaveProperty(
      'candidatePublication');
  });
  it('fails closed for false remote verification or mismatching remote head', () => {
    for (const wrong of [
      { ...receipt, remoteVerified: false },
      { ...receipt, remoteHeadSha: 'c'.repeat(40) },
      { ...receipt, headSha: 'not-a-sha' },
    ]) {
      expect(() => mapped(wrong)).toThrow(InternalServerErrorException);
    }
  });
  it('rejects duplicate/empty paths and incorrect target branch', () => {
    for (const wrong of [
      { ...receipt, changedFiles: [path, path] },
      { ...receipt, changedFiles: [''] },
      { ...receipt, targetBranch: 'feature/branch' },
      { ...receipt, executionId: '' },
    ]) {
      expect(() => mapped(wrong)).toThrow(InternalServerErrorException);
    }
  });
});
