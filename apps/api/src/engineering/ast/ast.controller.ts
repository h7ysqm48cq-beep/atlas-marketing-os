import {
  BadRequestException,
  Body,
  Controller,
  Post,
} from "@nestjs/common";

import {
  AstBridgeService,
} from "./ast.bridge.service";

import {
  AstEditOperation,
  AstEditService,
} from "./ast.edit.service";


@Controller(
  "engineering/ast",
)
export class AstController {


  constructor(
    private readonly ast:
      AstBridgeService,

    private readonly editor:
      AstEditService,
  ) {}


  @Post(
    "analyze",
  )
  async analyze(
    @Body()
    body: {
      filePath?: string;
    },
  ) {

    const filePath =
      body.filePath
        ?.trim();


    if (
      !filePath
    ) {

      throw new
        BadRequestException(
          "filePath is required.",
        );

    }


    return this.ast.analyze(
      filePath,
    );

  }


  @Post(
    "edit-preview",
  )
  async editPreview(
    @Body()
    body: {
      filePath?: string;
      operations?: AstEditOperation[];
    },
  ) {

    const filePath =
      body.filePath
        ?.trim();


    if (
      !filePath
    ) {

      throw new
        BadRequestException(
          "filePath is required.",
        );

    }


    if (
      !Array.isArray(
        body.operations,
      )
    ) {

      throw new
        BadRequestException(
          "operations must be an array.",
        );

    }


    return this.editor.preview(
      filePath,
      body.operations,
    );

  }


}
