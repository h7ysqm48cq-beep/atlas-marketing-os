import {
Module,
} from "@nestjs/common";


import {
RecoveryController,
} from "./recovery.controller";


import {
RecoveryService,
} from "./recovery.service";


import {
PatchModule,
} from "../patch/patch.module";


@Module({

imports:[
PatchModule,
],


controllers:[
RecoveryController,
],


providers:[
RecoveryService,
],


exports:[
RecoveryService,
],

})
export class RecoveryModule {}
