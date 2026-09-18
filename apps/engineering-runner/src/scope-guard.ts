import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function canonicalRepositoryPath(value: string): string {
  if (!value || path.isAbsolute(value) || value.includes('\\')) {
    throw new Error(`invalid_changed_path:${value}`);
  }

  const normalized = path.posix.normalize(value);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    normalized !== value
  ) {
    throw new Error(`invalid_changed_path:${value}`);
  }

  return normalized;
}

function canonicalList(values: string[]): string[] {
  return [...new Set(values.map(canonicalRepositoryPath))].sort();
}

function dangerousGitConfig(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return (
    normalized.startsWith('credential.') ||
    normalized.startsWith('http.') ||
    normalized.startsWith('https.') ||
    normalized.startsWith('include.') ||
    normalized.startsWith('includeif.') ||
    normalized.startsWith('filter.') ||
    normalized === 'core.sshcommand' ||
    normalized === 'core.gitproxy' ||
    normalized === 'core.fsmonitor' ||
    normalized === 'core.attributesfile' ||
    normalized === 'core.excludesfile' ||
    normalized === 'diff.external' ||
    (normalized.startsWith('diff.') && normalized.endsWith('.command')) ||
    (normalized.startsWith('merge.') && normalized.endsWith('.driver')) ||
    normalized === 'gpg.program' ||
    normalized === 'commit.gpgsign' ||
    normalized.startsWith('protocol.') ||
    (normalized.startsWith('url.') &&
      (normalized.endsWith('.insteadof') ||
        normalized.endsWith('.pushinsteadof')))
  );
}

export function parseGitStatusPorcelainZ(input: string): string[] {
  if (!input) return [];
  const records = input.split('\0');
  const changed: string[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4) {
      throw new Error('git_status_malformed');
    }

    const status = record.slice(0, 2);
    const firstPath = record.slice(3);
    const renamedOrCopied = status.includes('R') || status.includes('C');
    if (renamedOrCopied) {
      const source = records[index + 1];
      if (!source) throw new Error('git_status_rename_malformed');
      changed.push(
        canonicalRepositoryPath(firstPath),
        canonicalRepositoryPath(source),
      );
      index += 1;
      continue;
    }

    changed.push(canonicalRepositoryPath(firstPath));
  }

  return [...new Set(changed)];
}

export class GitWorkspace {
  private readonly cwd: string;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(cwd: string, environment: NodeJS.ProcessEnv = process.env) {
    if (!cwd) throw new Error('workspace_cwd_required');
    this.cwd = cwd;
    this.environment = {
      ...Object.fromEntries(
        ['PATH', 'TMPDIR'].flatMap((key) =>
          environment[key] === undefined ? [] : [[key, environment[key]]],
        ),
      ),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    };
  }

  private async gitRaw(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'credential.helper=',
        ...args,
      ],
      {
        cwd: this.cwd,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        env: this.environment,
      },
    );
    return stdout;
  }

  private async assertGitConfigSafe(): Promise<void> {
    const raw = await this.gitRaw([
      'config',
      '--local',
      '--list',
      '--name-only',
      '-z',
    ]);
    if (raw.split('\0').filter(Boolean).some(dangerousGitConfig)) {
      throw new Error('workspace_git_config_unsafe');
    }
  }

  async listChangedFiles(): Promise<string[]> {
    await this.assertGitConfigSafe();
    const stdout = await this.gitRaw([
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]);
    return parseGitStatusPorcelainZ(stdout);
  }
}

export class ExactScopeGuard {
  assertImplementationScope(changed: string[], allowed: string[]): void {
    const allowedSet = new Set(canonicalList(allowed));
    for (const changedPath of canonicalList(changed)) {
      if (!allowedSet.has(changedPath)) {
        throw new Error(`scope_drift:${changedPath}`);
      }
    }
  }

  assertVerificationNoDrift(before: string[], after: string[]): void {
    const beforeCanonical = canonicalList(before);
    const afterCanonical = canonicalList(after);
    if (
      beforeCanonical.length !== afterCanonical.length ||
      beforeCanonical.some((value, index) => value !== afterCanonical[index])
    ) {
      throw new Error('verification_git_drift');
    }
  }
}
