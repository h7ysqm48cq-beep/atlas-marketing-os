import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
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
    if (/^ATLAS_ENGINEERING_RUNNER_/i.test(key)) continue;
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


  private async restoreMigrationHistory(
    assignment: WorkerAssignment, signal?: AbortSignal,
  ): Promise<WorkerExecutionResult> {
    try {
      const payload = JSON.parse(assignment.objective.slice('RESTORE_MIGRATION_HISTORY '.length));
      const keys = ['afterSha256', 'beforeSha256', 'filePath', 'sourceSha', 'version'];
      if (!payload || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(keys) ||
          payload.version !== 1 ||
          typeof payload.filePath !== 'string' ||
          !/^apps\/api\/prisma\/migrations\/\d{14}_[a-z0-9_]+\/migration\.sql$/.test(payload.filePath) ||
          typeof payload.sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(payload.sourceSha) ||
          typeof payload.beforeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.beforeSha256) ||
          typeof payload.afterSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.afterSha256) ||
          payload.beforeSha256 === payload.afterSha256 ||
          assignment.workerRole !== 'engineering' || assignment.executionPurpose !== 'IMPLEMENTATION' ||
          assignment.allowedPaths.length !== 1 || assignment.allowedPaths[0] !== payload.filePath ||
          !/^[a-f0-9]{40}$/.test(assignment.frozenBaseSha ?? '') ||
          assignment.forbiddenActions.some(a => ['edit_assigned_files', 'restore_migration_history'].includes(a))) {
        throw new Error('invalid_contract');
      }
      const root = await realpath(this.cwd);
      const target = path.join(root, payload.filePath);
      if (await realpath(target) !== target) throw new Error('symlink_target');
      const git = async (...args: string[]) => {
        const output = await this.runProcess({
          command: 'git', args: [
            '--no-replace-objects', '-c', 'core.hooksPath=/dev/null',
            '-c', 'core.fsmonitor=false', '-c', 'credential.helper=', ...args,
          ], cwd: root, stdin: '', signal,
          env: {
            PATH: this.environment.PATH ?? process.env.PATH ?? '/usr/bin:/bin',
            GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
          },
        });
        if (output.exitCode !== 0) throw new Error('source_git_read_failed');
        return output.stdout;
      };
      if ((await git('rev-parse', '--verify', 'HEAD')).trim() !== assignment.frozenBaseSha ||
          (await git('status', '--porcelain=v1', '--untracked-files=all')).trim()) {
        throw new Error('base_or_workspace_mismatch');
      }
      await git('merge-base', '--is-ancestor', payload.sourceSha, assignment.frozenBaseSha!);
      const restored = Buffer.from(await git('show', '--no-ext-diff', '--no-textconv',
        payload.sourceSha + ':' + payload.filePath), 'utf8');
      const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
      if (hash(restored) !== payload.afterSha256) throw new Error('source_checksum_mismatch');
      const file = await open(target, constants.O_RDWR | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('non_regular_or_shared_file');
        const original = await file.readFile();
        if (hash(original) !== payload.beforeSha256) throw new Error('current_checksum_mismatch');
        const writeBytes = async (bytes: Buffer) => {
          let offset = 0;
          while (offset < bytes.length) {
            const written = await file.write(bytes, offset, bytes.length - offset, offset);
            if (!written.bytesWritten) throw new Error('short_write');
            offset += written.bytesWritten;
          }
          await file.truncate(bytes.length);
          await file.sync();
        };
        signal?.throwIfAborted();
        try {
          await writeBytes(restored);
          if (await realpath(target) !== target ||
              hash(await readFile(target)) !== payload.afterSha256) throw new Error('post_write_checksum_mismatch');
        } catch (error) {
          await writeBytes(original);
          throw error;
        }
      } finally { await file.close(); }
      return {
        summary: 'Restored immutable migration history bytes; no SQL executed.',
        evidence: {
          rootCause: 'historical_migration_bytes_drifted',
          changedFiles: [payload.filePath], tests: [], build: 'NOT_RUN', regression: [],
          deploymentState: 'NOT_DEPLOYED', gitState: 'MODIFIED',
          remainingRisk: ['tests_not_run', 'build_not_run'],
        },
      };
    } catch (error) {
      throw new Error('migration_history_restore_failed:' +
        (error instanceof Error ? error.message : 'unknown'));
    }
  }

  async execute(
    assignment: WorkerAssignment,
    signal?: AbortSignal,
  ): Promise<WorkerExecutionResult> {
    if (assignment.objective.startsWith('RESTORE_MIGRATION_HISTORY ')) {
      return this.restoreMigrationHistory(assignment, signal);
    }
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
