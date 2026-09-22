export interface EngineeringRunnerCandidateConfig {
  repositoryRoot: string;
  workspaceRoot: string;
  remote: string;
  sourceToken?: string;
  publisherToken?: string;
  publisherSshPrivateKey?: string;
  publisherSshPrivateKeyPath?: string;
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
  exactTarget?: { taskId: string; executionId: string };
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
    throw new Error("runner_config_invalid:ATLAS_ENGINEERING_RUNNER_ARGS");
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error("runner_config_invalid:ATLAS_ENGINEERING_RUNNER_ARGS");
  }
  return parsed;
}

const CANONICAL_CANDIDATE_REMOTE =
  "https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git";

function candidateConfig(
  env: NodeJS.ProcessEnv,
  verifierOnly = false,
): EngineeringRunnerCandidateConfig | undefined {
  const repositoryRoot = env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY?.trim();
  const workspaceRoot =
    env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_WORKSPACE_ROOT?.trim();
  const remote = env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE?.trim();
  const sourceToken = env.ATLAS_ENGINEERING_RUNNER_SOURCE_TOKEN?.trim();
  const publisherToken = env.ATLAS_ENGINEERING_RUNNER_PUBLISHER_TOKEN?.trim();
  const publisherSshPrivateKey =
    env.ATLAS_ENGINEERING_RUNNER_PUBLISHER_SSH_PRIVATE_KEY?.trim();
  const publisherSshPrivateKeyPath =
    env.ATLAS_ENGINEERING_RUNNER_PUBLISHER_SSH_PRIVATE_KEY_PATH?.trim();
  const requiredValues = [repositoryRoot, workspaceRoot, remote];
  const configured = requiredValues.filter(Boolean).length;
  if (
    configured === 0 &&
    !sourceToken &&
    !publisherToken &&
    !publisherSshPrivateKey &&
    !publisherSshPrivateKeyPath
  ) {
    return undefined;
  }
  if (configured !== requiredValues.length) {
    throw new Error("runner_candidate_config_incomplete");
  }
  const publisherAuthModes = [
    publisherToken,
    publisherSshPrivateKey,
    publisherSshPrivateKeyPath,
  ].filter(Boolean).length;
  if (!verifierOnly && publisherAuthModes !== 1) {
    throw new Error("runner_candidate_publisher_auth_invalid");
  }
  if (remote !== CANONICAL_CANDIDATE_REMOTE) {
    throw new Error("runner_candidate_remote_not_canonical");
  }
  return {
    repositoryRoot: repositoryRoot!,
    workspaceRoot: workspaceRoot!,
    remote: remote!,
    ...(sourceToken ? { sourceToken } : {}),
    ...(!verifierOnly && publisherToken ? { publisherToken } : {}),
    ...(!verifierOnly && publisherSshPrivateKey ? { publisherSshPrivateKey } : {}),
    ...(!verifierOnly && publisherSshPrivateKeyPath ? { publisherSshPrivateKeyPath } : {}),
  };
}

export function loadEngineeringRunnerConfig(
  env: NodeJS.ProcessEnv = process.env,
): EngineeringRunnerConfig {
  const bootstrapToken = required(
    env,
    "ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN",
  );
  const exactTaskId = env.ATLAS_ENGINEERING_RUNNER_EXACT_TASK_ID?.trim();
  const exactExecutionId = env.ATLAS_ENGINEERING_RUNNER_EXACT_EXECUTION_ID?.trim();
  if (Boolean(exactTaskId) !== Boolean(exactExecutionId)) {
    throw new Error('runner_exact_target_incomplete');
  }
  const exactVerification = Boolean(exactTaskId && exactExecutionId);
  const candidate = candidateConfig(env, exactVerification);
  if (exactVerification && !candidate) {
    throw new Error('runner_exact_target_requires_candidate_source');
  }
  if (candidate) {
    const credentials = [
      bootstrapToken,
      ...(candidate.publisherToken ? [candidate.publisherToken] : []),
      ...(candidate.publisherSshPrivateKey
        ? [candidate.publisherSshPrivateKey]
        : []),
      ...(candidate.sourceToken ? [candidate.sourceToken] : []),
    ];
    if (new Set(credentials).size !== credentials.length) {
      throw new Error("runner_candidate_credentials_not_separated");
    }
  }
  return {
    supervisorApiUrl: required(env, "ATLAS_SUPERVISOR_API_URL"),
    bootstrapToken,
    command: required(env, "ATLAS_ENGINEERING_RUNNER_COMMAND"),
    args: stringArray(env.ATLAS_ENGINEERING_RUNNER_ARGS),
    workspace: env.ATLAS_ENGINEERING_RUNNER_WORKSPACE?.trim() || process.cwd(),
    pollIntervalMs: positiveInteger(
      env,
      "ATLAS_ENGINEERING_RUNNER_POLL_INTERVAL_MS",
      5_000,
    ),
    heartbeatIntervalMs: positiveInteger(
      env,
      "ATLAS_ENGINEERING_RUNNER_HEARTBEAT_INTERVAL_MS",
      20_000,
    ),
    ...(candidate ? { candidate } : {}),
    ...(exactTaskId && exactExecutionId ? {
      exactTarget: { taskId: exactTaskId, executionId: exactExecutionId },
    } : {}),
  };
}
