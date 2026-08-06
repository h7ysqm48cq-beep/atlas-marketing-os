import {
  Injectable,
} from "@nestjs/common";

import {
  exec,
} from "node:child_process";

import {
  promisify,
} from "node:util";


const execAsync =
  promisify(exec);


@Injectable()
export class GitService {

  async status(
    cwd: string,
  ) {

    const {
      stdout: branch,
    } =
      await execAsync(
        "git branch --show-current",
        {
          cwd,
        },
      );

    const {
      stdout: status,
    } =
      await execAsync(
        "git status --short",
        {
          cwd,
        },
      );

    const files =
      status
        .split("\n")
        .filter(Boolean);

    return {
      branch:
        branch.trim(),

      changedFiles:
        files.length,

      stagedFiles:
        files.filter(
          (file) =>
            file[0] !== " ",
        ).length,

      clean:
        files.length === 0,
    };
  }


  async diff(
    cwd: string,
  ) {

    const {
      stdout,
    } =
      await execAsync(
        "git diff --stat",
        {
          cwd,
        },
      );

    return stdout;
  }
}
