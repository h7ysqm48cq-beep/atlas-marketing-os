import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execute } from './atlas-production-deploy-executor.mjs';

function defaultSleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function logHeartbeat(logger, payload) {
  logger.log('ATLAS_PRODUCTION_DEPLOY_EXECUTOR_HEARTBEAT', payload);
}

async function executeCycleWithTimeout(
  executeCycle,
  env,
  logger,
  {
    cycleTimeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
  },
) {
  let timeoutHandle;
  try {
    return await Promise.race([
      executeCycle(env, { logger }),
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
    cycleTimeoutMs = 25 * 60_000,
    logger = console,
    signal,
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {},
) {
  let nextIdleIntervalMs = intervalMs;
  let cycle = 0;

  while (!signal?.aborted) {
    cycle += 1;
    const cycleStartedAt = now();
    logHeartbeat(logger, {
      phase: 'cycle_start',
      cycle,
      at: new Date(cycleStartedAt).toISOString(),
      heartbeatIntervalMs,
      cycleTimeoutMs,
    });

    let heartbeatHandle;
    if (heartbeatIntervalMs > 0) {
      heartbeatHandle = setIntervalFn(() => {
        const heartbeatAt = now();
        logHeartbeat(logger, {
          phase: 'cycle_running',
          cycle,
          at: new Date(heartbeatAt).toISOString(),
          elapsedMs: Math.max(0, heartbeatAt - cycleStartedAt),
          heartbeatIntervalMs,
          cycleTimeoutMs,
        });
      }, heartbeatIntervalMs);
    }

    let result;
    try {
      result = await executeCycleWithTimeout(executeCycle, env, logger, {
        cycleTimeoutMs,
        setTimeoutFn,
        clearTimeoutFn,
      });
    } catch (error) {
      const failedAt = now();
      logHeartbeat(logger, {
        phase: 'cycle_failed',
        cycle,
        at: new Date(failedAt).toISOString(),
        elapsedMs: Math.max(0, failedAt - cycleStartedAt),
        errorName: error instanceof Error ? error.name : typeof error,
      });
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
    logHeartbeat(logger, {
      phase: 'cycle_complete',
      cycle,
      at: new Date(completedAt).toISOString(),
      sha: typeof result?.sha === 'string' ? result.sha : null,
      claimedWork: hadClaimedWork,
      cycleMs: Math.max(0, completedAt - cycleStartedAt),
      nextPollMs: sleepMs,
    });

    await sleep(sleepMs);

    nextIdleIntervalMs = hadClaimedWork
      ? intervalMs
      : Math.min(
          Math.max(intervalMs, maxIdleIntervalMs),
          Math.max(intervalMs, nextIdleIntervalMs * 2),
        );
  }
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  runDaemon().catch((error) => {
    console.error(
      'ATLAS_PRODUCTION_DEPLOY_EXECUTOR_DAEMON_FAILED',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
