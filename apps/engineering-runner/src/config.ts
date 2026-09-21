export interface EngineeringRunnerCandidateConfig {
  repositoryRoot: string;
  workspaceRoot: string;
  remote: string;
  sourceToken?: string;
  publisherToken?: string;
  publisherSshPrivateKey?: string;
  publisherSshPrivateKeyPath?: string;
}

export interface EngineeringRunnerVerifierSourceConfig {
  repositoryRoot: string;
  workspaceRoot: string;
  remote: string;
  sourceToken?: string;
}

export interface EngineeringRunnerConfig {
  supervisorApiUrl: string;
  bootstrapToken: string;
  command: string;
  args: string[];
  workspace: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  signed?: {
    kid: string; privateKeyPem: string;
    purpose: 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION';
  };
  candidate?: EngineeringRunnerCandidateConfig;
  verifierSource?: EngineeringRunnerVerifierSourceConfig;
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
  if (publisherAuthModes !== 1) {
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
    ...(publisherToken ? { publisherToken } : {}),
    ...(publisherSshPrivateKey ? { publisherSshPrivateKey } : {}),
    ...(publisherSshPrivateKeyPath ? { publisherSshPrivateKeyPath } : {}),
  };
}

export function loadEngineeringRunnerConfig(
  env: NodeJS.ProcessEnv = process.env,
): EngineeringRunnerConfig {
  const signedMode = env.ATLAS_ENGINEERING_RUNNER_SIGNED_MODE?.trim();
  if (signedMode && signedMode !== 'required') {
    throw new Error('runner_signed_mode_invalid');
  }
  if (!signedMode && [
    env.ATLAS_ENGINEERING_RUNNER_SIGNED_BOOTSTRAP_TOKEN,
    env.ATLAS_ENGINEERING_RUNNER_SIGNING_KID,
    env.ATLAS_ENGINEERING_RUNNER_SIGNING_PRIVATE_KEY,
    env.ATLAS_ENGINEERING_RUNNER_PURPOSE,
  ].some(Boolean)) {
    throw new Error('runner_signed_mode_required_for_signer');
  }
  const signed = signedMode === 'required' ? {
    kid: required(env, 'ATLAS_ENGINEERING_RUNNER_SIGNING_KID'),
    privateKeyPem: required(
      env, 'ATLAS_ENGINEERING_RUNNER_SIGNING_PRIVATE_KEY'),
    purpose: required(env, 'ATLAS_ENGINEERING_RUNNER_PURPOSE'),
  } : undefined;
  if (signed && signed.purpose !== 'IMPLEMENTATION' &&
      signed.purpose !== 'INDEPENDENT_VERIFICATION') {
    throw new Error('runner_signed_purpose_invalid');
  }
  const bootstrapToken = required(env, signed
    ? 'ATLAS_ENGINEERING_RUNNER_SIGNED_BOOTSTRAP_TOKEN'
    : 'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN');
  const candidate = candidateConfig(env);
  const verifierKeys = [
    env.ATLAS_ENGINEERING_RUNNER_VERIFIER_SOURCE_REPOSITORY?.trim(),
    env.ATLAS_ENGINEERING_RUNNER_VERIFIER_WORKSPACE_ROOT?.trim(),
    env.ATLAS_ENGINEERING_RUNNER_VERIFIER_REMOTE?.trim(),
  ];
  const verifierSourceToken =
    env.ATLAS_ENGINEERING_RUNNER_VERIFIER_SOURCE_TOKEN?.trim();
  if ((verifierKeys.some(Boolean) || verifierSourceToken) &&
      signed?.purpose !== 'INDEPENDENT_VERIFICATION') {
    throw new Error('runner_verifier_source_only_for_signed_verifier');
  }
  if (signed?.purpose === 'INDEPENDENT_VERIFICATION' &&
      (verifierKeys.some(value => !value) ||
       verifierKeys[2] !== CANONICAL_CANDIDATE_REMOTE ||
       verifierSourceToken === bootstrapToken || candidate)) {
    throw new Error('runner_signed_verifier_source_invalid');
  }
  if (signed?.purpose === 'IMPLEMENTATION' && !candidate) {
    throw new Error('runner_signed_implementation_candidate_required');
  }
  const verifierSource = signed?.purpose === 'INDEPENDENT_VERIFICATION'
    ? {
        repositoryRoot: verifierKeys[0]!, workspaceRoot: verifierKeys[1]!,
        remote: verifierKeys[2]!,
        ...(verifierSourceToken ? { sourceToken: verifierSourceToken } : {}),
      }
    : undefined;
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
    ...(verifierSource ? { verifierSource } : {}),
    ...(signed ? { signed: {
      kid: signed.kid,
      privateKeyPem: signed.privateKeyPem,
      purpose: signed.purpose as 'IMPLEMENTATION' |
        'INDEPENDENT_VERIFICATION',
    } } : {}),
  };
}
