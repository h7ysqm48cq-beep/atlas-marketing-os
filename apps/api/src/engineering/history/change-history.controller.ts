import {
  Controller,
  Get,
} from "@nestjs/common";

import {
  ChangeHistoryService,
} from "./change-history.service";


@Controller(
  "engineering/history",
)
export class ChangeHistoryController {

  constructor(
    private readonly history:
      ChangeHistoryService,
  ) {}


  @Get()
  list() {
    return this.history.list();
  }
}
