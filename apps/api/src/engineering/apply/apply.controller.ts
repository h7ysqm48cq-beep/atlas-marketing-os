import {
  Body,
  ConflictException,
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
    private readonly applyService:
      ApplyService,
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

    const result =
      await this.applyService.applyChange(
        body.filePath,
        body.content,
        body.before,
      );


    /*
     * A stale preview is not a successful creation.
     *
     * The service deliberately keeps the domain-level
     * "blocked" result. The HTTP boundary maps it to
     * 409 Conflict.
     */
    if (
      result.status ===
      "blocked"
    ) {

      throw new ConflictException(
        result,
      );

    }


    return result;

  }


  @Post("batch")
  async applyBatch(
    @Body()
    body: {
      patches: {
        filePath: string;
        content: string;
        before?: string;
      }[];
    },
  ) {

    const result =
      await this.applyService.applyBatch(
        body.patches,
      );


    /*
     * Batch apply is atomic at the validation stage:
     * if any patch has stale "before" content,
     * report an HTTP conflict and do not continue.
     */
    if (
      result.status ===
      "blocked"
    ) {

      throw new ConflictException(
        result,
      );

    }


    return result;

  }

}
