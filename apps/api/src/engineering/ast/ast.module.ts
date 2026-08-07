import {
  Module,
} from "@nestjs/common";

import {
  AstBridgeService,
} from "./ast.bridge.service";

import {
  AstController,
} from "./ast.controller";

import {
  AstEditService,
} from "./ast.edit.service";


@Module({

  controllers: [
    AstController,
  ],

  providers: [
    AstBridgeService,
    AstEditService,
  ],

  exports: [
    AstBridgeService,
    AstEditService,
  ],

})
export class AstModule {}
