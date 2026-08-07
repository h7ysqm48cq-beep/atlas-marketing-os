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



import {
ValidationService,
} from "../validation/validation.service";

@Injectable()
export class ApplyService {

  constructor(
    private readonly history:
      ChangeHistoryService,

    private readonly snapshot:
      SnapshotService,

    private readonly validator:
      PatchValidator,

private readonly validation:
ValidationService,
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

async applyBatch(
patches: {
  filePath: string;
  content: string;
  before?: string;
}[],
) {

const backups: {
  filePath: string;
  backupPath: string;
}[] = [];


for (
  const patch of patches
) {

  let currentContent = "";

  try {

    currentContent =
      await readFile(
        patch.filePath,
        "utf8",
      );

  } catch {

    currentContent = "";

  }


  if (patch.before) {

    const validation =
      this.validator.validate(
        patch.before,
        currentContent,
      );


    if (!validation.valid) {

      return {
        filePath:
          patch.filePath,

        status:
          "blocked",

        reason:
          validation.reason,
      };

    }
  }


  const backup =
    await this.backupFile(
      patch.filePath,
    );


  if (backup) {

    backups.push({
      filePath:
        patch.filePath,

      backupPath:
        backup,
    });

  }

}


const snapshot =
  await this.snapshot.create(
    backups,
    "Before Atlas batch apply change",
  );


for (
  const patch of patches
) {

  await mkdir(
    dirname(patch.filePath),
    {
      recursive:
        true,
    },
  );


  await writeFile(
    patch.filePath,
    patch.content,
    "utf8",
  );


  this.history.add({
    id:
      randomUUID(),

    filePath:
      patch.filePath,

    action:
      "modify",

    status:
      "completed",

    createdAt:
      new Date()
        .toISOString(),
  });

}


return {
  snapshot,
  status:
    "completed",
  files:
    patches.map(
      patch => patch.filePath,
    ),
};

}

}
