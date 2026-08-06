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
export class GitCommitService {

  async getDiffSummary(
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

    return stdout.trim();
  }


  async generateCommitMessage(
    cwd: string,
  ) {

    const summary =
      await this.getDiffSummary(
        cwd,
      );

    return {
      message:
        "feat: improve Atlas engineering workflow",

      summary:
        summary ||
        "No unstaged changes detected.",

      generated:
        true,
    };
  }


  async commit(
    cwd: string,
    message: string,
  ) {

    await execAsync(
      "git add -A",
      {
        cwd,
      },
    );


    const {
      stdout,
      stderr,
    } =
      await execAsync(
        `git commit -m "${message}"`,
        {
          cwd,
        },
      );


    return {
      success:
        true,

      message,

      output:
        stdout ||
        stderr,
    };
  }
}
