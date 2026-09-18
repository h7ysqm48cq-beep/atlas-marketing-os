export interface EngineeringRunnerCandidateConfig {
  repositoryRoot: string;
  workspaceRoot: string;
  remote: string;
  publisherToken: string;
}

export interface EngineeringRunnerConfig {
  supervisorApiUrl: string;
  bootstrapToken: string;
  command: string;
  args: string[];
  workspace: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  candidate?: EngineeringRunnerCandidateConfig;
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


const CANONICAL_CANDIDATE_REMOTE =
  'https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git';

function candidateConfig(env: NodeJS.ProcessEnv): EngineeringRunnerCandidateConfig | undefined {
  const repositoryRoot = env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY?.trim();
  const workspaceRoot = env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_WORKSPACE_ROOT?.trim();
  const remote = env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE?.trim();
  const publisherToken = env.ATLAS_ENGINEERING_RUNNER_PUBLISHER_TOKEN?.trim();
  const values = [repositoryRoot, workspaceRoot, remote, publisherToken];
  const configured = values.filter(Boolean).length;
  if (configured === 0) return undefined;
  if (configured !== values.length) {
    throw new Error('runner_candidate_config_incomplete');
  }
  if (remote !== CANONICAL_CANDIDATE_REMOTE) {
    throw new Error('runner_candidate_remote_not_canonical');
  }
  return {
    repositoryRoot: repositoryRoot!,
    workspaceRoot: workspaceRoot!,
    remote: remote!,
    publisherToken: publisherToken!,
  };
}

export function loadEngineeringRunnerConfig(
  env: NodeJS.ProcessEnv = process.env,
): EngineeringRunnerConfig {
  const candidate = candidateConfig(env);
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
    ...(candidate ? { candidate } : {}),
  };
}
