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


    if (
      !snapshot ||
      !snapshot.backupPath
    ) {
      throw new Error(
        "Snapshot backup not found.",
      );
    }


    const files =
      Array.isArray(snapshot.files)
        ? snapshot.files.filter(
            (file): file is string =>
              typeof file === "string",
          )
        : [];

    if (!files[0]) {
      throw new Error(
        "Snapshot file not found.",
      );
    }

    const result =
      await this.restore(
        files[0],
        snapshot.backupPath,
      );

    await this.snapshot.markRestored(
      snapshotId,
    );

    return result;
  }
}
