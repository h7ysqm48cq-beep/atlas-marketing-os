import { spawn } from 'node:child_process';
import type { WorkerAssignment, WorkerExecutionResult } from './types.ts';

interface ProcessInput {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  signal?: AbortSignal;
}

interface ProcessOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type ProcessRunner = (input: ProcessInput) => Promise<ProcessOutput>;

export interface CommandExecutorOptions {
  command: string;
  args?: string[];
  cwd: string;
  environment?: Record<string, string | undefined>;
  runProcess?: ProcessRunner;
}

function sanitizeEnvironment(
  source: Record<string, string | undefined>,
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (/^ATLAS_SUPERVISOR_/i.test(key)) continue;
    if (/^ATLAS_EXECUTION_CAPABILITY$/i.test(key)) continue;
    if (/^ATLAS_OWNER_/i.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateResult(value: unknown): WorkerExecutionResult {
  if (!value || typeof value !== 'object') {
    throw new Error('executor_result_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const evidence = candidate.evidence;
  if (
    typeof candidate.summary !== 'string' ||
    candidate.summary.length === 0 ||
    !evidence ||
    typeof evidence !== 'object'
  ) {
    throw new Error('executor_result_invalid');
  }

  const item = evidence as Record<string, unknown>;
  if (
    typeof item.rootCause !== 'string' ||
    !isStringArray(item.changedFiles) ||
    !isStringArray(item.tests) ||
    typeof item.build !== 'string' ||
    !isStringArray(item.regression) ||
    typeof item.deploymentState !== 'string' ||
    typeof item.gitState !== 'string' ||
    !isStringArray(item.remainingRisk)
  ) {
    throw new Error('executor_result_invalid');
  }

  return value as WorkerExecutionResult;
}

async function defaultRunProcess(input: ProcessInput): Promise<ProcessOutput> {
  return new Promise<ProcessOutput>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: input.signal,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.stdin.end(input.stdin);
  });
}

export class CommandExecutor {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly environment: Record<string, string | undefined>;
  private readonly runProcess: ProcessRunner;

  constructor(options: CommandExecutorOptions) {
    if (!options.command || !options.cwd) {
      throw new Error('executor_configuration_invalid');
    }
    this.command = options.command;
    this.args = [...(options.args ?? [])];
    this.cwd = options.cwd;
    this.environment = { ...(options.environment ?? {}) };
    this.runProcess = options.runProcess ?? defaultRunProcess;
  }

  async execute(
    assignment: WorkerAssignment,
    signal?: AbortSignal,
  ): Promise<WorkerExecutionResult> {
    const output = await this.runProcess({
      command: this.command,
      args: [...this.args],
      cwd: this.cwd,
      env: sanitizeEnvironment(this.environment),
      stdin: JSON.stringify(assignment),
      signal,
    });

    if (output.exitCode !== 0) {
      const suffix = output.stderr.trim();
      throw new Error(
        `executor_failed:${output.exitCode}${suffix ? `:${suffix}` : ''}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(output.stdout);
    } catch {
      throw new Error('executor_result_invalid');
    }
    return validateResult(parsed);
  }
}
