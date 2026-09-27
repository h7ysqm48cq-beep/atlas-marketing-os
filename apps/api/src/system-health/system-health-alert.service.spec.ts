import {
  criticalIssueFingerprint,
  SystemHealthAlertService,
} from './system-health-alert.service';

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


describe('SystemHealthAlertService', () => {
  function createService() {
    const health = {
      getSystemHealth: jest.fn(),
    };

    const notifications = {
      notify: jest.fn().mockResolvedValue({
        sent: 1,
        failed: 0,
        skipped: false,
      }),
    };

    return {
      health,
      notifications,
      service: new SystemHealthAlertService(
        health as never,
        notifications as never,
      ),
    };
  }

  it('alerts once for a stable critical fingerprint', async () => {
    const { health, notifications, service } = createService();

    health.getSystemHealth.mockResolvedValue({
      issues: [
        {
          code: 'sports_scheduler_missed_run',
          severity: 'critical',
          count: 1,
          editions: ['MORNING'],
        },
      ],
    });

    const first = await service.checkCriticalIssues();
    const second = await service.checkCriticalIssues();

    expect(first.alerted).toBe(true);
    expect(second).toEqual(
      expect.objectContaining({
        alerted: false,
        deduplicated: true,
      }),
    );
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('sends one recovery after a previously critical state clears', async () => {
    const { health, notifications, service } = createService();

    health.getSystemHealth
      .mockResolvedValueOnce({
        issues: [
          {
            code: 'publishing_stuck',
            severity: 'critical',
            count: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [],
      })
      .mockResolvedValueOnce({
        issues: [],
      });

    await service.checkCriticalIssues();
    const recovery = await service.checkCriticalIssues();
    const healthyAgain = await service.checkCriticalIssues();

    expect(recovery).toEqual(
      expect.objectContaining({
        alerted: false,
        recovered: true,
      }),
    );

    expect(healthyAgain).toEqual(
      expect.objectContaining({
        alerted: false,
        recovered: false,
      }),
    );

    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        category: 'system',
        title: 'ATLAS system recovered',
        tag: 'atlas-system-health-critical',
      }),
    );
  });
});
