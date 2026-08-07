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


import {
RepairModule,
} from "../repair/repair.module";


@Module({

imports:[
PatchModule,
RepairModule,
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
