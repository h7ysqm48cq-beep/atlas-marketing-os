import { criticalIssueFingerprint } from './system-health-alert.service';

describe('criticalIssueFingerprint', () => {
  it('returns an empty fingerprint when there are no critical issues', () => {
    expect(
      criticalIssueFingerprint([
        { code: 'warning-only', severity: 'warning', count: 1 },
      ]),
    ).toBe('');
  });

  it('is stable regardless of issue and edition ordering', () => {
    const left = criticalIssueFingerprint([
      {
        code: 'sports_scheduler_missed_run',
        severity: 'critical',
        count: 2,
        editions: ['EVENING', 'MORNING'],
      },
      {
        code: 'publishing_stuck',
        severity: 'critical',
        count: 1,
      },
    ]);

    const right = criticalIssueFingerprint([
      {
        code: 'publishing_stuck',
        severity: 'critical',
        count: 1,
      },
      {
        code: 'sports_scheduler_missed_run',
        severity: 'critical',
        count: 2,
        editions: ['MORNING', 'EVENING'],
      },
    ]);

    expect(left).toBe(right);
  });

  it('changes when the critical issue set changes', () => {
    const first = criticalIssueFingerprint([
      {
        code: 'sports_scheduler_missed_run',
        severity: 'critical',
        count: 1,
        editions: ['MORNING'],
      },
    ]);

    const second = criticalIssueFingerprint([
      {
        code: 'sports_scheduler_missed_run',
        severity: 'critical',
        count: 1,
        editions: ['EVENING'],
      },
    ]);

    expect(first).not.toBe(second);
  });
});
