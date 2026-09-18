import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
  publisherToken?: string;
  publisherSshPrivateKey?: string;
  environment?: NodeJS.ProcessEnv;
}

const CANONICAL_CANDIDATE_REMOTE =
  'https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git';
const CANONICAL_CANDIDATE_SSH_REMOTE =
  'git@github.com:h7ysqm48cq-beep/atlas-marketing-os.git';
const GITHUB_ED25519_KNOWN_HOST =
  'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n';

function dangerousTransportConfig(key: string): boolean {
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

export class CandidatePublisher {
  private readonly remote: string;
  private readonly transportRemote: string;
  private readonly publisherToken?: string;
  private readonly publisherSshPrivateKey?: string;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(options: CandidatePublisherOptions) {
    this.remote = options.remote;
    this.publisherToken = options.publisherToken?.trim() || undefined;
    this.publisherSshPrivateKey =
      options.publisherSshPrivateKey?.trim() || undefined;

    const remoteLooksNetworked = /^[a-z][a-z0-9+.-]*:\/\//i.test(this.remote);
    if (remoteLooksNetworked) {
      if (this.remote !== CANONICAL_CANDIDATE_REMOTE) {
        throw new Error('candidate_publication_remote_not_canonical');
      }
      if (Boolean(this.publisherToken) === Boolean(this.publisherSshPrivateKey)) {
        throw new Error('candidate_publication_publisher_auth_invalid');
      }
      if (
        this.publisherSshPrivateKey &&
        !this.publisherSshPrivateKey.startsWith(
          '-----BEGIN OPENSSH PRIVATE KEY-----',
        )
      ) {
        throw new Error('candidate_publication_ssh_key_invalid');
      }
    }
    this.transportRemote = this.publisherSshPrivateKey
      ? CANONICAL_CANDIDATE_SSH_REMOTE
      : this.remote;

    const source = options.environment ?? process.env;
    this.environment = {
      ...Object.fromEntries(
        ['PATH', 'TMPDIR'].flatMap((key) =>
          source[key] === undefined ? [] : [[key, source[key]]],
        ),
      ),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    };
  }

  private gitEnvironment(transport = false): NodeJS.ProcessEnv {
    if (!transport || !this.publisherToken) {
      return { ...this.environment };
    }

    const authorization = Buffer.from(
      `x-access-token:${this.publisherToken}`,
      'utf8',
    ).toString('base64');

    return {
      ...this.environment,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${authorization}`,
    };
  }

  private async sshTransportEnvironment(): Promise<{
    environment: NodeJS.ProcessEnv;
    cleanup: () => Promise<void>;
  }> {
    if (!this.publisherSshPrivateKey) {
      return {
        environment: { ...this.environment },
        cleanup: async () => undefined,
      };
    }

    const root = await mkdtemp(
      path.join(this.environment.TMPDIR || tmpdir(), 'atlas-publisher-ssh-'),
    );
    await chmod(root, 0o700);
    const keyPath = path.join(root, 'publisher_key');
    const knownHostsPath = path.join(root, 'known_hosts');
    await writeFile(keyPath, `${this.publisherSshPrivateKey}\n`, {
      mode: 0o600,
    });
    await writeFile(knownHostsPath, GITHUB_ED25519_KNOWN_HOST, {
      mode: 0o600,
    });

    return {
      environment: {
        ...this.environment,
        ATLAS_PUBLISHER_SSH_KEY_FILE: keyPath,
        ATLAS_PUBLISHER_KNOWN_HOSTS_FILE: knownHostsPath,
        GIT_SSH_VARIANT: 'ssh',
        GIT_SSH_COMMAND:
          'ssh -i "$ATLAS_PUBLISHER_SSH_KEY_FILE" ' +
          '-o IdentitiesOnly=yes ' +
          '-o StrictHostKeyChecking=yes ' +
          '-o HostKeyAlgorithms=ssh-ed25519 ' +
          '-o UserKnownHostsFile="$ATLAS_PUBLISHER_KNOWN_HOSTS_FILE" ' +
          '-o GlobalKnownHostsFile=/dev/null ' +
          '-o PasswordAuthentication=no ' +
          '-o KbdInteractiveAuthentication=no ' +
          '-o BatchMode=yes',
      },
      cleanup: async () => {
        await rm(root, { recursive: true, force: true });
      },
    };
  }

  private async gitRaw(
    cwd: string,
    args: string[],
    transport = false,
  ): Promise<string> {
    const safeArgs = [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'credential.helper=',
      ...args,
    ];
    const sshTransport =
      transport && this.publisherSshPrivateKey
        ? await this.sshTransportEnvironment()
        : undefined;
    try {
      const { stdout } = await execFileAsync('git', safeArgs, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        env: sshTransport?.environment ?? this.gitEnvironment(transport),
      });
      return stdout;
    } finally {
      await sshTransport?.cleanup();
    }
  }

  private async git(
    cwd: string,
    args: string[],
    transport = false,
  ): Promise<string> {
    return (await this.gitRaw(cwd, args, transport)).trim();
  }

  private async assertTransportConfigSafe(cwd: string): Promise<void> {
    const raw = await this.gitRaw(cwd, [
      'config',
      '--local',
      '--list',
      '--name-only',
      '-z',
    ]);
    const unsafe = raw.split('\0').filter(Boolean).find(dangerousTransportConfig);
    if (unsafe) {
      throw new Error('candidate_publication_transport_config_unsafe');
    }
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
    await this.assertTransportConfigSafe(request.workspace);
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
    await this.assertTransportConfigSafe(request.workspace);
    const existingRemoteRef = await this.git(
      request.workspace,
      [
        'ls-remote',
        '--heads',
        this.transportRemote,
        remoteRef,
      ],
      true,
    );
    if (existingRemoteRef) {
      throw new Error('candidate_publication_remote_branch_exists');
    }

    await this.git(
      request.workspace,
      [
        'push',
        this.transportRemote,
        `${candidateHead}:${remoteRef}`,
      ],
      true,
    );

    const verifiedRemoteRef = await this.git(
      request.workspace,
      [
        'ls-remote',
        '--heads',
        this.transportRemote,
        remoteRef,
      ],
      true,
    );
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
