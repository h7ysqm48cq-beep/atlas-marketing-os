export interface EngineeringRunnerConfig {
  supervisorApiUrl: string;
  bootstrapToken: string;
  command: string;
  args: string[];
  workspace: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`runner_config_required:${key}`);
  return value;
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`runner_config_invalid:${key}`);
  }
  return value;
}

function stringArray(raw: string | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('runner_config_invalid:ATLAS_ENGINEERING_RUNNER_ARGS');
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('runner_config_invalid:ATLAS_ENGINEERING_RUNNER_ARGS');
  }
  return parsed;
}

export function loadEngineeringRunnerConfig(
  env: NodeJS.ProcessEnv = process.env,
): EngineeringRunnerConfig {
  return {
    supervisorApiUrl: required(env, 'ATLAS_SUPERVISOR_API_URL'),
    bootstrapToken: required(
      env,
      'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN',
    ),
    command: required(env, 'ATLAS_ENGINEERING_RUNNER_COMMAND'),
    args: stringArray(env.ATLAS_ENGINEERING_RUNNER_ARGS),
    workspace:
      env.ATLAS_ENGINEERING_RUNNER_WORKSPACE?.trim() || process.cwd(),
    pollIntervalMs: positiveInteger(
      env,
      'ATLAS_ENGINEERING_RUNNER_POLL_INTERVAL_MS',
      5_000,
    ),
    heartbeatIntervalMs: positiveInteger(
      env,
      'ATLAS_ENGINEERING_RUNNER_HEARTBEAT_INTERVAL_MS',
      20_000,
    ),
  };
}
