import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execute } from './atlas-production-deploy-executor.mjs';

function defaultSleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export async function reportDeploymentAutomationHeartbeat(
  env,
  payload,
  fetchImpl = fetch,
) {
  const apiBase = env.ATLAS_SUPERVISOR_API_URL?.trim();
  const ciToken = env.ATLAS_SUPERVISOR_CI_TOKEN?.trim();
  if (!apiBase || !ciToken) {
    throw new Error('deployment automation telemetry credentials missing');
  }

  const apiUrl = new URL(apiBase);
  if (apiUrl.protocol !== 'https:') {
    throw new Error('ATLAS_SUPERVISOR_API_URL must use https');
  }

  const response = await fetchImpl(
    `${apiBase.replace(/\/+$/g, '')}/engineering/supervisor/gateway/deployment-automation/heartbeat`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-atlas-supervisor-ci-token': ciToken,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    },
  );

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error('deployment automation heartbeat returned invalid JSON');
  }
  if (!response.ok) {
    const code = body?.code || body?.message || `http_${response.status}`;
    throw new Error(`deployment automation heartbeat failed: ${code}`);
  }
  return body;
}

function createStaleHeartbeatMonitor({
  logger,
  now,
  staleHeartbeatThresholdMs,
  staleHeartbeatCheckIntervalMs,
  setStaleMonitorIntervalFn,
  clearStaleMonitorIntervalFn,
}) {
  if (
    staleHeartbeatThresholdMs <= 0 ||
    staleHeartbeatCheckIntervalMs <= 0
  ) {
    return {
      promise: new Promise(() => {}),
      pulse() {},
      stop() {},
    };
  }

  let lastHeartbeatAt = now();
  let rejected = false;
  let rejectStale;
  const promise = new Promise((_, reject) => {
    rejectStale = reject;
  });

  const handle = setStaleMonitorIntervalFn(() => {
    if (rejected) return;

    const checkedAt = now();
    const elapsedMs = Math.max(0, checkedAt - lastHeartbeatAt);
    if (elapsedMs < staleHeartbeatThresholdMs) return;

    rejected = true;
    const details = {
      at: new Date(checkedAt).toISOString(),
      lastHeartbeatAt: new Date(lastHeartbeatAt).toISOString(),
      elapsedMs,
      staleHeartbeatThresholdMs,
    };
    logger.error('ATLAS_PRODUCTION_DEPLOY_EXECUTOR_HEARTBEAT_STALE', details);
    rejectStale(
      new Error(
        `production deploy executor heartbeat stale for ${elapsedMs}ms`,
      ),
    );
  }, staleHeartbeatCheckIntervalMs);

  return {
    promise,
    pulse(atMs) {
      lastHeartbeatAt = atMs;
    },
    stop() {
      clearStaleMonitorIntervalFn(handle);
    },
  };
}

function logHeartbeat(
  logger,
  monitor,
  atMs,
  payload,
  reportHeartbeat,
) {
  monitor.pulse(atMs);
  logger.log('ATLAS_PRODUCTION_DEPLOY_EXECUTOR_HEARTBEAT', payload);

  if (!reportHeartbeat) return;

  const report = {
    service: 'production-deploy-executor',
    phase: payload.phase,
    cycle: payload.cycle,
    commitSha: typeof payload.sha === 'string' ? payload.sha : null,
    claimedWork:
      typeof payload.claimedWork === 'boolean' ? payload.claimedWork : null,
    nextPollMs:
      Number.isInteger(payload.nextPollMs) ? payload.nextPollMs : null,
  };

  Promise.resolve()
    .then(() => reportHeartbeat(report))
    .catch((error) => {
      logger.error(
        'ATLAS_PRODUCTION_DEPLOY_EXECUTOR_HEARTBEAT_REPORT_FAILED',
        {
          phase: payload.phase,
          cycle: payload.cycle,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );
    });
}

async function executeCycleWithTimeout(
  executeCycle,
  env,
  logger,
  {
    cycleTimeoutMs,
    staleHeartbeatPromise,
    setTimeoutFn,
    clearTimeoutFn,
  },
) {
  let timeoutHandle;
  try {
    return await Promise.race([
      executeCycle(env, { logger }),
      staleHeartbeatPromise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeoutFn(() => {
          reject(
            new Error(
              `production deploy executor cycle exceeded ${cycleTimeoutMs}ms`,
            ),
          );
        }, cycleTimeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeoutFn(timeoutHandle);
    }
  }
}

export async function runDaemon(
  env = process.env,
  {
    executeCycle = execute,
    sleep = defaultSleep,
    intervalMs = 60_000,
    maxIdleIntervalMs = 120_000,
    heartbeatIntervalMs = 60_000,
    staleHeartbeatThresholdMs = 5 * 60_000,
    staleHeartbeatCheckIntervalMs = 60_000,
    cycleTimeoutMs = 25 * 60_000,
    logger = console,
    reportHeartbeat = null,
    signal,
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setStaleMonitorIntervalFn = setInterval,
    clearStaleMonitorIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {},
) {
  let nextIdleIntervalMs = intervalMs;
  let cycle = 0;

  const staleHeartbeatMonitor = createStaleHeartbeatMonitor({
    logger,
    now,
    staleHeartbeatThresholdMs,
    staleHeartbeatCheckIntervalMs,
    setStaleMonitorIntervalFn,
    clearStaleMonitorIntervalFn,
  });

  try {
    while (!signal?.aborted) {
      cycle += 1;
      const cycleStartedAt = now();
      logHeartbeat(logger, staleHeartbeatMonitor, cycleStartedAt, {
        phase: 'cycle_start',
        cycle,
        at: new Date(cycleStartedAt).toISOString(),
        heartbeatIntervalMs,
        staleHeartbeatThresholdMs,
        staleHeartbeatCheckIntervalMs,
        cycleTimeoutMs,
      }, reportHeartbeat);

      let heartbeatHandle;
      if (heartbeatIntervalMs > 0) {
        heartbeatHandle = setIntervalFn(() => {
          const heartbeatAt = now();
          logHeartbeat(logger, staleHeartbeatMonitor, heartbeatAt, {
            phase: 'cycle_running',
            cycle,
            at: new Date(heartbeatAt).toISOString(),
            elapsedMs: Math.max(0, heartbeatAt - cycleStartedAt),
            heartbeatIntervalMs,
            cycleTimeoutMs,
          }, reportHeartbeat);
        }, heartbeatIntervalMs);
      }

      let result;
      try {
        result = await executeCycleWithTimeout(executeCycle, env, logger, {
          cycleTimeoutMs,
          staleHeartbeatPromise: staleHeartbeatMonitor.promise,
          setTimeoutFn,
          clearTimeoutFn,
        });
      } catch (error) {
        const failedAt = now();
        logHeartbeat(logger, staleHeartbeatMonitor, failedAt, {
          phase: 'cycle_failed',
          cycle,
          at: new Date(failedAt).toISOString(),
          elapsedMs: Math.max(0, failedAt - cycleStartedAt),
          errorName: error instanceof Error ? error.name : typeof error,
        }, reportHeartbeat);
        throw error;
      } finally {
        if (heartbeatHandle !== undefined) {
          clearIntervalFn(heartbeatHandle);
        }
      }

      const results = Array.isArray(result?.results) ? result.results : null;
      const hadClaimedWork =
        results === null ||
        results.some((entry) => entry?.claim?.claimed === true);

      const sleepMs = hadClaimedWork ? intervalMs : nextIdleIntervalMs;
      const completedAt = now();
      logHeartbeat(logger, staleHeartbeatMonitor, completedAt, {
        phase: 'cycle_complete',
        cycle,
        at: new Date(completedAt).toISOString(),
        sha: typeof result?.sha === 'string' ? result.sha : null,
        claimedWork: hadClaimedWork,
        cycleMs: Math.max(0, completedAt - cycleStartedAt),
        nextPollMs: sleepMs,
      }, reportHeartbeat);

      await Promise.race([
        sleep(sleepMs),
        staleHeartbeatMonitor.promise,
      ]);

      nextIdleIntervalMs = hadClaimedWork
        ? intervalMs
        : Math.min(
            Math.max(intervalMs, maxIdleIntervalMs),
            Math.max(intervalMs, nextIdleIntervalMs * 2),
          );
    }
  } finally {
    staleHeartbeatMonitor.stop();
  }
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  runDaemon(process.env, {
    reportHeartbeat: (payload) =>
      reportDeploymentAutomationHeartbeat(process.env, payload),
  }).catch((error) => {
    console.error(
      'ATLAS_PRODUCTION_DEPLOY_EXECUTOR_DAEMON_FAILED',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
