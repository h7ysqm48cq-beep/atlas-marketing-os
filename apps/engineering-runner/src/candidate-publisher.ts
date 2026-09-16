import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { parseGitStatusPorcelainZ } from './scope-guard.ts';
import type { CandidatePublicationReceipt } from './types.ts';

const execFileAsync = promisify(execFile);
const SAFE_EXECUTION_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

async function assertNoEscapingSymlink(workspace: string, repositoryPath: string): Promise<void> {
  const workspaceReal = await realpath(workspace);
  const parts = repositoryPath.split('/');
  let current = workspace;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (!stat.isSymbolicLink()) continue;
      const resolved = await realpath(current);
      const relative = path.relative(workspaceReal, resolved);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('candidate_publication_symlink_escape');
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') return;
      if (error instanceof Error && error.message === 'candidate_publication_symlink_escape') throw error;
      if (error?.code === 'ELOOP') throw new Error('candidate_publication_symlink_escape');
      throw error;
    }
  }
}

function samePathSet(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export interface CandidatePublicationRequest {
  taskId: string;
  executionId: string;
  executionPurpose: 'IMPLEMENTATION';
  workspace: string;
  frozenBaseSha: string;
  targetBranch: 'production/atlas';
  changedFiles: string[];
}

export interface CandidatePublisherOptions {
  remote: string;
  environment?: NodeJS.ProcessEnv;
}

export class CandidatePublisher {
  private readonly remote: string;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(options: CandidatePublisherOptions) {
    this.remote = options.remote;
    const source = options.environment ?? process.env;
    this.environment = Object.fromEntries(
      ['PATH', 'HOME', 'TMPDIR'].flatMap((key) =>
        source[key] === undefined ? [] : [[key, source[key]]],
      ),
    );
  }

  private async gitRaw(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      env: this.environment,
    });
    return stdout;
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    return (await this.gitRaw(cwd, args)).trim();
  }

  async publish(
    request: CandidatePublicationRequest,
  ): Promise<CandidatePublicationReceipt> {
    if (!SAFE_EXECUTION_ID.test(request.taskId) || !SAFE_EXECUTION_ID.test(request.executionId)) {
      throw new Error('candidate_publication_identity_invalid');
    }
    if (request.executionPurpose !== 'IMPLEMENTATION') {
      throw new Error('candidate_publication_purpose_invalid');
    }
    if (request.targetBranch !== 'production/atlas') {
      throw new Error('candidate_publication_target_invalid');
    }
    const changedFiles = [...request.changedFiles];
    const head = (await this.git(request.workspace, ['rev-parse', 'HEAD'])).toLowerCase();
    const frozenBaseSha = request.frozenBaseSha.trim().toLowerCase();
    if (head !== frozenBaseSha) {
      throw new Error('candidate_publication_base_mismatch');
    }
    const staged = await this.gitRaw(request.workspace, [
      'diff',
      '--cached',
      '--name-only',
      '-z',
    ]);
    if (staged.length > 0) {
      throw new Error('candidate_publication_index_not_clean');
    }
    const status = await this.gitRaw(request.workspace, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]);
    const observed = parseGitStatusPorcelainZ(status);
    if (!samePathSet(observed, changedFiles)) {
      throw new Error('candidate_publication_changed_files_mismatch');
    }
    for (const changedFile of changedFiles) {
      await assertNoEscapingSymlink(request.workspace, changedFile);
    }
    await this.git(request.workspace, ['add', '--', ...changedFiles]);
    const stagedAfterAddRaw = await this.gitRaw(request.workspace, [
      'diff',
      '--cached',
      '--name-only',
      '-z',
    ]);
    const stagedAfterAdd = stagedAfterAddRaw.split('\0').filter(Boolean);
    if (!samePathSet(stagedAfterAdd, changedFiles)) {
      throw new Error('candidate_publication_staged_files_mismatch');
    }
    const message = `atlas(candidate): ${request.taskId} ${request.executionId}`;
    await this.git(request.workspace, [
      '-c',
      'user.name=Atlas Candidate Publisher',
      '-c',
      'user.email=atlas-candidate@example.invalid',
      'commit',
      '-m',
      message,
    ]);
    const candidateHead = (
      await this.git(request.workspace, ['rev-parse', 'HEAD'])
    ).toLowerCase();
    const parentLine = await this.git(request.workspace, [
      'rev-list',
      '--parents',
      '-n',
      '1',
      candidateHead,
    ]);
    const parentParts = parentLine.split(/\s+/).filter(Boolean);
    if (parentParts.length !== 2 || parentParts[1]?.toLowerCase() !== frozenBaseSha) {
      throw new Error('candidate_publication_parent_mismatch');
    }
    const diffRaw = await this.gitRaw(request.workspace, [
      'diff',
      '--name-only',
      '-z',
      `${frozenBaseSha}..${candidateHead}`,
    ]);
    const committedFiles = diffRaw.split('\0').filter(Boolean);
    if (!samePathSet(committedFiles, changedFiles)) {
      throw new Error('candidate_publication_diff_mismatch');
    }
    const candidateBranch =
      `atlas/candidate/${request.taskId}/${request.executionId}`;
    const remoteRef = `refs/heads/${candidateBranch}`;
    const existingRemoteRef = await this.git(request.workspace, [
      'ls-remote',
      '--heads',
      this.remote,
      remoteRef,
    ]);
    if (existingRemoteRef) {
      throw new Error('candidate_publication_remote_branch_exists');
    }

    await this.git(request.workspace, [
      'push',
      this.remote,
      `${candidateHead}:${remoteRef}`,
    ]);

    const verifiedRemoteRef = await this.git(request.workspace, [
      'ls-remote',
      '--heads',
      this.remote,
      remoteRef,
    ]);
    const remoteHeadSha = verifiedRemoteRef.split(/\s+/)[0]?.toLowerCase() ?? '';
    if (remoteHeadSha !== candidateHead) {
      throw new Error('candidate_publication_remote_sha_mismatch');
    }

    return {
      taskId: request.taskId,
      executionId: request.executionId,
      candidateBranch,
      baseSha: request.frozenBaseSha.toLowerCase(),
      headSha: candidateHead,
      changedFiles,
      targetBranch: 'production/atlas',
      remoteHeadSha,
      remoteVerified: true,
    };
  }
}
