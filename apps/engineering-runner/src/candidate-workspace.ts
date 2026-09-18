import { execFile } from 'node:child_process';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { GitWorkspace } from './scope-guard.ts';
import type { WorkspaceInspector } from './types.ts';

const execFileAsync = promisify(execFile);
const SAFE_EXECUTION_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

function requireAllowedPath(value: string): string {
  if (!value || path.isAbsolute(value) || value.includes('\\')) {
    throw new Error('candidate_workspace_allowed_path_invalid');
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    normalized !== value
  ) {
    throw new Error('candidate_workspace_allowed_path_invalid');
  }
  return normalized;
}


function pathWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

async function requireAllowedPathInsideWorkspace(
  workspacePath: string,
  relativePath: string,
): Promise<void> {
  const root = await realpath(workspacePath);
  let probe = path.join(workspacePath, relativePath);

  while (true) {
    try {
      const resolved = await realpath(probe);
      if (!pathWithin(root, resolved)) {
        throw new Error('candidate_workspace_allowed_path_escape');
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message === 'candidate_workspace_allowed_path_escape') {
        throw error;
      }
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw error;
      }
      const parent = path.dirname(probe);
      if (parent === probe) {
        throw new Error('candidate_workspace_allowed_path_escape');
      }
      probe = parent;
    }
  }
}

export interface CandidateWorkspaceInput {
  taskId: string;
  executionId: string;
  frozenBaseSha: string;
  allowedPaths: string[];
}

export interface CandidateWorkspaceLease {
  path: string;
  baseSha: string;
  workspace: WorkspaceInspector;
  cleanup(): Promise<void>;
}

export interface CandidateWorkspaceManagerOptions {
  repositoryRoot: string;
  workspaceRoot: string;
  ensureBase?: (frozenBaseSha: string) => Promise<void>;
}

export class CandidateWorkspaceManager {
  private readonly repositoryRoot: string;
  private readonly workspaceRoot: string;
  private readonly ensureBase?: (frozenBaseSha: string) => Promise<void>;

  constructor(options: CandidateWorkspaceManagerOptions) {
    this.repositoryRoot = options.repositoryRoot;
    this.workspaceRoot = options.workspaceRoot;
    this.ensureBase = options.ensureBase;
  }

  async prepare(input: CandidateWorkspaceInput): Promise<CandidateWorkspaceLease> {
    if (!SAFE_EXECUTION_ID.test(input.taskId) || !SAFE_EXECUTION_ID.test(input.executionId)) {
      throw new Error('candidate_workspace_identity_invalid');
    }
    input.allowedPaths.map(requireAllowedPath);
    const frozenBaseSha = input.frozenBaseSha.trim().toLowerCase();
    if (!FULL_GIT_SHA.test(frozenBaseSha)) {
      throw new Error('candidate_workspace_base_invalid');
    }
    if (this.ensureBase) {
      await this.ensureBase(frozenBaseSha);
    }
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', '--verify', `${frozenBaseSha}^{commit}`],
        { cwd: this.repositoryRoot, encoding: 'utf8' },
      );
      if (stdout.trim().toLowerCase() !== frozenBaseSha) {
        throw new Error('candidate_workspace_base_invalid');
      }
    } catch {
      throw new Error('candidate_workspace_base_invalid');
    }
    await mkdir(this.workspaceRoot, { recursive: true });
    const workspacePath = path.join(
      this.workspaceRoot,
      `${input.taskId}--${input.executionId}`,
    );
    try {
      await lstat(workspacePath);
      throw new Error('candidate_workspace_path_exists');
    } catch (error) {
      if (error instanceof Error && error.message === 'candidate_workspace_path_exists') {
        throw error;
      }
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw error;
      }
    }

    await execFileAsync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        'worktree',
        'add',
        '--detach',
        workspacePath,
        frozenBaseSha,
      ],
      { cwd: this.repositoryRoot },
    );

    const workspace = new GitWorkspace(workspacePath);
    try {
      for (const allowedPath of input.allowedPaths) {
        await requireAllowedPathInsideWorkspace(workspacePath, allowedPath);
      }

      const { stdout: headOutput } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: workspacePath, encoding: 'utf8' },
      );
      if (headOutput.trim().toLowerCase() !== frozenBaseSha) {
        throw new Error('candidate_workspace_head_mismatch');
      }

      const { stdout: branchOutput } = await execFileAsync(
        'git',
        ['branch', '--show-current'],
        { cwd: workspacePath, encoding: 'utf8' },
      );
      if (branchOutput.trim()) {
        throw new Error('candidate_workspace_branch_attached');
      }

      if ((await workspace.listChangedFiles()).length > 0) {
        throw new Error('candidate_workspace_not_clean');
      }
    } catch (error) {
      await execFileAsync(
        'git',
        ['worktree', 'remove', '--force', workspacePath],
        { cwd: this.repositoryRoot },
      ).catch(() => undefined);
      throw error;
    }
    return {
      path: workspacePath,
      baseSha: frozenBaseSha,
      workspace,
      cleanup: async () => {
        await execFileAsync(
          'git',
          ['worktree', 'remove', '--force', workspacePath],
          { cwd: this.repositoryRoot },
        );
      },
    };
  }
}
