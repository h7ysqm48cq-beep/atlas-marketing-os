import {
  existsSync,
} from "node:fs";

import {
  isAbsolute,
  relative,
  resolve,
} from "node:path";

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

import {
AuditService,
} from "../audit/audit.service";

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


private readonly audit:
AuditService,
  ) {}

  private repositoryRoot():
    string {

    let current =
      resolve(
        process.cwd(),
      );


    for (
      let depth = 0;
      depth < 8;
      depth += 1
    ) {

      const apiExists =
        existsSync(
          resolve(
            current,
            "apps/api",
          ),
        );

      const parserExists =
        existsSync(
          resolve(
            current,
            "tools/modifier/parser.js",
          ),
        );


      if (
        apiExists
        &&
        parserExists
      ) {

        return current;

      }


      const parent =
        resolve(
          current,
          "..",
        );


      if (
        parent === current
      ) {

        break;

      }


      current =
        parent;

    }


    throw new Error(
      "Atlas repository root could not be resolved.",
    );

  }


  private repositoryFile(
    filePath: string,
  ): string {

    const root =
      this.repositoryRoot();


    const absolute =
      isAbsolute(
        filePath,
      )
        ? resolve(
            filePath,
          )
        : resolve(
            root,
            filePath,
          );


    const relativePath =
      relative(
        root,
        absolute,
      );


    if (
      relativePath === ""
      ||
      (
        relativePath !== ".."
        &&
        !relativePath.startsWith(
          "../",
        )
        &&
        !isAbsolute(
          relativePath,
        )
      )
    ) {

      return absolute;

    }


    throw new Error(
      `File escapes repository root: ${filePath}`,
    );

  }




  async backupFile(
    filePath: string,
  ) {

    const backupPath =
      join(
        this.repositoryRoot(),
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

      await access(
        this.repositoryFile(
          filePath,
        ),
      );

      await copyFile(
        this.repositoryFile(
          filePath,
        ),
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
          this.repositoryFile(
            filePath,
          ),
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
      dirname(
        this.repositoryFile(
          filePath,
        ),
      ),
      {
        recursive:
          true,
      },
    );


    await writeFile(
      this.repositoryFile(
        filePath,
      ),
      content,
      "utf8",
    );


    this.audit.record({

      action:
        "recovery_apply",

      filePath,

      riskLevel:
        "unknown",

      confidence:
        0,

      approvalState:
        "APPROVED",

      status:
        "COMPLETED",

      createdAt:
        new Date()
          .toISOString(),

    });



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
        this.repositoryFile(
          patch.filePath,
        ),
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
    dirname(
      this.repositoryFile(
        patch.filePath,
      ),
    ),
    {
      recursive:
        true,
    },
  );


  await writeFile(
      this.repositoryFile(
        patch.filePath,
      ),
      patch.content,
      "utf8",
    );


  this.audit.record({

    action:
      "recovery_apply",

    filePath:
      patch.filePath,

    riskLevel:
      "unknown",

    confidence:
      0,

    approvalState:
      "APPROVED",

    status:
      "COMPLETED",

    createdAt:
      new Date()
        .toISOString(),

  });


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
