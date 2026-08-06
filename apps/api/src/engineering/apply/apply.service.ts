import {
  Injectable,
} from "@nestjs/common";

import {
  randomUUID,
} from "node:crypto";

import {
  readFile,
  writeFile,
  copyFile,
  mkdir,
} from "node:fs/promises";

import {
  dirname,
  join,
} from "node:path";

import {
  ChangeHistoryService,
} from "../history/change-history.service";


@Injectable()
export class ApplyService {

  constructor(
    private readonly history:
      ChangeHistoryService,
  ) {}

  async backupFile(
    filePath: string,
  ) {
    const backupPath =
      join(
        ".atlas",
        "backup",
        filePath,
      );

    await mkdir(
      dirname(backupPath),
      {
        recursive: true,
      },
    );

    await copyFile(
      filePath,
      backupPath,
    );

    return backupPath;
  }


  async applyChange(
    filePath: string,
    content: string,
  ) {

    const backup =
      await this.backupFile(
        filePath,
      );

    await writeFile(
      filePath,
      content,
      "utf8",
    );

    this.history.add({
      id:
        randomUUID(),
      filePath,
      action:
        "modify",
      status:
        "completed",
      createdAt:
        new Date().toISOString(),
    });

    return {
      filePath,
      backup,
      status:
        "completed",
    };
  }
}
