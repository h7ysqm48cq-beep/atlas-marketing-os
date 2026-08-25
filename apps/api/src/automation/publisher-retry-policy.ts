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

export function resolvePublisherRetryDecision(input: {
  policy: SportsNewsRetryPolicy | null;
  failedAttemptCount: number;
  failedAt: Date;
  usedBrowserRuntime: boolean;
}) {
  if (input.usedBrowserRuntime) {
    return {
      shouldRetry: false,
      scheduledAt: null,
    };
  }

  return resolveSportsNewsRetryDecision({
    policy:
      input.policy,
    failedAttemptCount:
      input.failedAttemptCount,
    failedAt:
      input.failedAt,
  });
}
