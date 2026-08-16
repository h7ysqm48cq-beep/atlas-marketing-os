export type SportsNewsRetryPolicy = {
  publishRetryEnabled: boolean;
  publishRetryLimit: number;
  publishRetryDelayMinutes: number;
};

export function resolveSportsNewsRetryDecision(input: {
  policy: SportsNewsRetryPolicy | null;
  failedAttemptCount: number;
  failedAt: Date;
}) {
  const policy = input.policy;
  const shouldRetry = Boolean(
    policy?.publishRetryEnabled &&
    input.failedAttemptCount <= Math.max(0, policy.publishRetryLimit),
  );

  return {
    shouldRetry,
    scheduledAt:
      shouldRetry && policy
        ? new Date(
            input.failedAt.getTime() +
              Math.max(0, policy.publishRetryDelayMinutes) * 60_000,
          )
        : null,
  };
}
