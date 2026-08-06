import {
  Body,
  Controller,
  Post,
} from "@nestjs/common";

import {
  RollbackService,
} from "./rollback.service";


@Controller(
  "engineering/rollback",
)
export class RollbackController {

  constructor(
    private readonly rollback:
      RollbackService,
  ) {}


  @Post()
  restore(
    @Body()
    body:{
      filePath?:string;
      backupPath?:string;
      snapshotId?:string;
    },
  ) {

    if (body.snapshotId) {
      return this.rollback.restoreSnapshot(
        body.snapshotId,
      );
    }


    return this.rollback.restore(
      body.filePath!,
      body.backupPath!,
    );
  }
}
