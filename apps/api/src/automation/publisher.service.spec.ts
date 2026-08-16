import { resolveSportsNewsRetryDecision } from './publisher-retry-policy';

describe('resolveSportsNewsRetryDecision', () => {
  const failedAt = new Date('2026-08-17T00:00:00.000Z');

  it('schedules an enabled retry after the configured delay', () => {
    expect(
      resolveSportsNewsRetryDecision({
        policy: {
          publishRetryEnabled: true,
          publishRetryLimit: 3,
          publishRetryDelayMinutes: 10,
        },
        failedAttemptCount: 1,
        failedAt,
      }),
    ).toEqual({
      shouldRetry: true,
      scheduledAt: new Date('2026-08-17T00:10:00.000Z'),
    });
  });

  it('stops after the configured retry limit', () => {
    expect(
      resolveSportsNewsRetryDecision({
        policy: {
          publishRetryEnabled: true,
          publishRetryLimit: 3,
          publishRetryDelayMinutes: 10,
        },
        failedAttemptCount: 4,
        failedAt,
      }),
    ).toEqual({
      shouldRetry: false,
      scheduledAt: null,
    });
  });

  it('does not retry posts without Sports News retry metadata', () => {
    expect(
      resolveSportsNewsRetryDecision({
        policy: null,
        failedAttemptCount: 1,
        failedAt,
      }),
    ).toEqual({
      shouldRetry: false,
      scheduledAt: null,
    });
  });
});
