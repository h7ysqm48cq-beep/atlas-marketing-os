import {
  Body,
  Controller,
  Get,
  Post,
} from "@nestjs/common";

import {
  SnapshotService,
} from "./snapshot.service";


@Controller(
  "engineering/snapshot",
)
export class SnapshotController {


  constructor(
    private readonly snapshot:
      SnapshotService,
  ){}


  @Post()
  create(
    @Body()
    body:{
      files:string[];
      description:string;
    },
  ){

    return this.snapshot.create(
      body.files,
      body.description,
    );
  }


  @Get()
  list(){

    return this.snapshot.list();

  }
}
