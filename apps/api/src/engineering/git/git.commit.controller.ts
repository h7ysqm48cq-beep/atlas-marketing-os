import {
  Body,
  Controller,
  Post,
} from "@nestjs/common";

import {
  GitCommitService,
} from "./git.commit.service";


@Controller(
  "engineering/git",
)
export class GitCommitController {

  constructor(
    private readonly commits:
      GitCommitService,
  ) {}


  @Post("commit")
  commit(
    @Body()
    body:{
      message:string;
    },
  ) {

    return this.commits.commit(
      process.cwd(),
      body.message,
    );
  }
}
