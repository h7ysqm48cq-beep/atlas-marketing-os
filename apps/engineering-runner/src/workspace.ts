import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseGitStatusPorcelainZ } from './scope-guard.ts';

const execFileAsync = promisify(execFile);

export class GitWorkspace {
  constructor(private readonly cwd: string) {
    if (!cwd) throw new Error('workspace_cwd_required');
  }

  async listChangedFiles(): Promise<string[]> {
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      {
        cwd: this.cwd,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    return parseGitStatusPorcelainZ(stdout);
  }
}
