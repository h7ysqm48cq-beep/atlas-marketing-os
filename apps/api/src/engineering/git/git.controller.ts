import {
  Controller,
  Get,
} from "@nestjs/common";

import {
  GitService,
} from "./git.service";


@Controller(
  "engineering/git",
)
export class GitController {

  constructor(
    private readonly git:
      GitService,
  ) {}


  @Get("status")
  status() {

    return this.git.status(
      process.cwd(),
    );
  }


  @Get("diff")
  diff() {

    return this.git.diff(
      process.cwd(),
    );
  }
}
