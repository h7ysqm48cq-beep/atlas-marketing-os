import {
  Controller,
  Get,
  Query,
} from "@nestjs/common";

import {
  RepositoryService,
} from "./repository.service";


@Controller(
  "engineering/repository",
)
export class RepositoryController {

  constructor(
    private readonly repository:
      RepositoryService,
  ) {}


  @Get("scan")
  async scan(
    @Query("root")
    root: string,
  ) {

    return this.repository
      .getRepositoryTree(
        root,
      );
  }
}
