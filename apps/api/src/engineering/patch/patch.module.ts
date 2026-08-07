import {
Module,
} from "@nestjs/common";

import {
PatchService,
} from "./patch.service";



import {
  AstModule,
} from "../ast/ast.module";


@Module({

  imports: [
    AstModule,
  ],


providers:[
PatchService,
],

exports:[
PatchService,
],

})
export class PatchModule {}
