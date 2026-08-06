import {
  Body,
  Controller,
  Post,
} from "@nestjs/common";

import {
  ApplyService,
} from "./apply.service";

@Controller(
  "engineering/apply",
)
export class ApplyController {
  constructor(
    private readonly applyService: ApplyService,
  ) {}

  @Post()
  async apply(
    @Body()
    body: {
      filePath: string;
      content: string;
before?: string;
    },
  ) {
    return this.applyService.applyChange(
      body.filePath,
      body.content,
      body.before,
    );
  }
}
