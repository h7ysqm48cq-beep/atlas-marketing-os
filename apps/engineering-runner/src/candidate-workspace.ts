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
  frozenBaseSha?: string;
  candidateBaseSha?: string;
  candidateHeadSha?: string;
  productionBaselineSha?: string;
  allowedPaths: string[];
}

export interface CandidateWorkspaceLease {
  path: string;
  baseSha: string;
  verifiedHeadSha?: string;
  verifiedChangedPaths?: string[];
  verifyProductionBaseline?: () => Promise<void>;
  workspace: WorkspaceInspector;
  cleanup(): Promise<void>;
}

export interface CandidateWorkspaceManagerOptions {
  repositoryRoot: string;
  workspaceRoot: string;
  ensureBase?: (frozenBaseSha: string) => Promise<void>;
  ensureCandidate?: (baseSha: string, headSha: string) => Promise<void>;
  ensureProductionHead?: (expectedSha: string) => Promise<void>;
  ensureProductionAdvance?: (
    candidateBaseSha: string,
    expectedProductionSha: string,
    candidatePaths: string[],
  ) => Promise<void>;
}

export class CandidateWorkspaceManager {
  private readonly repositoryRoot: string;
  private readonly workspaceRoot: string;
  private readonly ensureBase?: (frozenBaseSha: string) => Promise<void>;
  private readonly ensureCandidate?: (baseSha: string, headSha: string) => Promise<void>;
  private readonly ensureProductionHead?: (expectedSha: string) => Promise<void>;
  private readonly ensureProductionAdvance?: (
    candidateBaseSha: string,
    expectedProductionSha: string,
    candidatePaths: string[],
  ) => Promise<void>;

  constructor(options: CandidateWorkspaceManagerOptions) {
    this.repositoryRoot = options.repositoryRoot;
    this.workspaceRoot = options.workspaceRoot;
    this.ensureBase = options.ensureBase;
    this.ensureCandidate = options.ensureCandidate;
    this.ensureProductionHead = options.ensureProductionHead;
    this.ensureProductionAdvance = options.ensureProductionAdvance;
  }

  async prepare(input: CandidateWorkspaceInput): Promise<CandidateWorkspaceLease> {
    if (!SAFE_EXECUTION_ID.test(input.taskId) || !SAFE_EXECUTION_ID.test(input.executionId)) {
      throw new Error('candidate_workspace_identity_invalid');
    }
    input.allowedPaths.map(requireAllowedPath);
    const existingCandidate = input.candidateHeadSha !== undefined ||
      input.candidateBaseSha !== undefined || input.productionBaselineSha !== undefined;
    const frozenBaseSha = (existingCandidate
      ? input.candidateBaseSha : input.frozenBaseSha)?.trim().toLowerCase() ?? '';
    const headSha = (existingCandidate
      ? input.candidateHeadSha : input.frozenBaseSha)?.trim().toLowerCase() ?? '';
    if (!FULL_GIT_SHA.test(frozenBaseSha) || !FULL_GIT_SHA.test(headSha)) {
      throw new Error('candidate_workspace_base_invalid');
    }
    if (existingCandidate) {
      if (!FULL_GIT_SHA.test(input.productionBaselineSha ?? '') ||
          frozenBaseSha === headSha || !this.ensureCandidate ||
          !this.ensureProductionHead) {
        throw new Error('existing_candidate_identity_invalid');
      }
      await this.ensureProductionHead(input.productionBaselineSha!.toLowerCase());
      if (this.ensureBase) {
        await this.ensureBase(input.productionBaselineSha!.toLowerCase());
      }
      if (input.productionBaselineSha!.toLowerCase() !== frozenBaseSha) {
        if (!this.ensureProductionAdvance) {
          throw new Error('existing_candidate_production_advance_unverified');
        }
        await this.ensureProductionAdvance(
          frozenBaseSha,
          input.productionBaselineSha!.toLowerCase(),
          input.allowedPaths,
        );
      }
      await this.ensureCandidate(frozenBaseSha, headSha);
      // Exact head fetch/ancestry may refresh the source mirror. Reject a
      // production move before creating any verifier worktree.
      await this.ensureProductionHead(input.productionBaselineSha!.toLowerCase());
    } else if (this.ensureBase) {
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
        headSha,
      ],
      { cwd: this.repositoryRoot },
    );

    const workspace = new GitWorkspace(workspacePath);
    let verifiedChangedPaths: string[] | undefined;
    try {
      for (const allowedPath of input.allowedPaths) {
        await requireAllowedPathInsideWorkspace(workspacePath, allowedPath);
      }

      const { stdout: headOutput } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: workspacePath, encoding: 'utf8' },
      );
      if (headOutput.trim().toLowerCase() !== headSha) {
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
      if (existingCandidate) {
        try {
          await execFileAsync('git', [
            'merge-base', '--is-ancestor', frozenBaseSha, headSha,
          ], { cwd: workspacePath });
          const { stdout } = await execFileAsync('git', [
            'diff', '--no-ext-diff', '--no-textconv',
            '--name-only', '-z', frozenBaseSha, headSha,
          ], { cwd: workspacePath, encoding: 'utf8' });
          verifiedChangedPaths = stdout.split('\0').filter(Boolean).sort();
          const allowed = [...new Set(input.allowedPaths)].sort();
          if (verifiedChangedPaths.length !== allowed.length ||
              verifiedChangedPaths.some((p, i) => p !== allowed[i])) {
            throw new Error('existing_candidate_scope_mismatch');
          }
        } catch (error) {
          if (error instanceof Error && error.message === 'existing_candidate_scope_mismatch')
            throw error;
          throw new Error('existing_candidate_git_identity_invalid');
        }
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
      ...(existingCandidate ? {
        verifiedHeadSha: headSha, verifiedChangedPaths,
        verifyProductionBaseline: async () =>
          this.ensureProductionHead!(input.productionBaselineSha!.toLowerCase()),
      } : {}),
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
