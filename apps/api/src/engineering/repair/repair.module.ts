import {
Module,
} from "@nestjs/common";


import {
RepairService,
} from "./repair.service";


import {
RepairClient,
} from "./repair.client";


import {
AiProviderModule,
} from "../../ai-provider/ai-provider.module";


import {
  AstModule,
} from "../ast/ast.module";


@Module({

imports:[
  AiProviderModule,
    AstModule,
  ],


providers:[
  RepairService,
  RepairClient,
],


exports:[
  RepairService,
],

})
export class RepairModule {}
