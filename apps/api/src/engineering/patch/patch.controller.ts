import {
  Body,
  Controller,
  Post,
} from "@nestjs/common";

import {
  PatchService,
} from "./patch.service";


@Controller(
  "engineering/patch",
)
export class PatchController {

  constructor(
    private readonly patchService:
      PatchService,
  ) {}


  @Post()
  generate(
    @Body()
    body:{
      request:string;
      files:string[];
    },
  ) {

    return this.patchService.generate(
      body.request,
      body.files,
    );
  }
}
