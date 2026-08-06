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
  access,
} from "node:fs/promises";

import {
  dirname,
  join,
} from "node:path";

import {
  ChangeHistoryService,
} from "../history/change-history.service";

import {
  SnapshotService,
} from "../snapshot/snapshot.service";

import {
  PatchValidator,
} from "../patch/patch.validator";


@Injectable()
export class ApplyService {

  constructor(
    private readonly history:
      ChangeHistoryService,

    private readonly snapshot:
      SnapshotService,

    private readonly validator:
      PatchValidator,
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


    try {

      await access(filePath);

      await copyFile(
        filePath,
        backupPath,
      );


      return backupPath;

    } catch {

      return null;

    }
  }



  async applyChange(
    filePath: string,
    content: string,
    expectedBefore?: string,
  ) {


    let currentContent = "";


    try {

      currentContent =
        await readFile(
          filePath,
          "utf8",
        );

    } catch {

      currentContent = "";

    }



    if (expectedBefore) {

      const validation =
        this.validator.validate(
          expectedBefore,
          currentContent,
        );


      if (!validation.valid) {

        return {
          filePath,
          status:
            "blocked",
          reason:
            validation.reason,
        };

      }
    }



    const backup =
      await this.backupFile(
        filePath,
      );


    const snapshot =
      await this.snapshot.create(
        [
          filePath,
        ],
        "Before Atlas apply change",
        backup,
      );



    await mkdir(
      dirname(filePath),
      {
        recursive:
          true,
      },
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
        new Date()
          .toISOString(),
    });



    return {
      filePath,
      backup,
      snapshot,
      status:
        "completed",
    };
  }
}
