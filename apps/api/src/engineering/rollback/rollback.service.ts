import {
  Injectable,
} from "@nestjs/common";

import {
  copyFile,
  access,
} from "node:fs/promises";

import {
  SnapshotService,
} from "../snapshot/snapshot.service";


@Injectable()
export class RollbackService {

  constructor(
    private readonly snapshot:
      SnapshotService,
  ) {}


  async restore(
    filePath: string,
    backupPath: string,
  ) {

    await access(
      backupPath,
    );

    await copyFile(
      backupPath,
      filePath,
    );

    return {
      filePath,
      status:
        "completed",
      restoredAt:
        new Date().toISOString(),
    };
  }


async restoreSnapshot(
snapshotId: string,
) {

const snapshot =
  await this.snapshot.find(
    snapshotId,
  );


if (!snapshot) {
  throw new Error(
    "Snapshot not found.",
  );
}


const restoredFiles: {
  filePath: string;
  status: string;
  restoredAt: string;
}[] = [];


const files =
  Array.isArray(snapshot.files)
    ? snapshot.files
    : [];


for (
  const file of files
) {

  if (
    typeof file === "object" &&
    file !== null &&
    "filePath" in file &&
    "backupPath" in file
  ) {

    const item =
      file as {
        filePath: string;
        backupPath: string;
      };


    restoredFiles.push(
      await this.restore(
        item.filePath,
        item.backupPath,
      ),
    );

    continue;
  }


  if (
    typeof file === "string" &&
    snapshot.backupPath
  ) {

    restoredFiles.push(
      await this.restore(
        file,
        snapshot.backupPath,
      ),
    );

  }

}


if (!restoredFiles.length) {
  throw new Error(
    "Snapshot files not found.",
  );
}


await this.snapshot.markRestored(
  snapshotId,
);


return {
  snapshotId,
  status:
    "completed",
  restoredFiles,
};

}

}
