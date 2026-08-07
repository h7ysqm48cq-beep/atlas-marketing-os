import {
Module,
} from "@nestjs/common";


import {
CTOController,
} from "./cto.controller";


import {
CTOService,
} from "./cto.service";


import {
CTOMemoryService,
} from "./cto.memory";


import {
CTODecisionService,
} from "./cto.decision";


@Module({

controllers:[
CTOController,
],

providers:[

CTOService,

CTOMemoryService,

CTODecisionService,

],

exports:[

CTOService,

],

})

export class CTOModule {}
