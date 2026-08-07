import {
Module,
} from "@nestjs/common";

import {
PatchService,
} from "./patch.service";


@Module({

providers:[
PatchService,
],

exports:[
PatchService,
],

})
export class PatchModule {}
