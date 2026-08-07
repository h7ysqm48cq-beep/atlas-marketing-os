import {
  Module,
} from "@nestjs/common";

import {
  RepairService,
} from "./repair.service";


@Module({

  providers:[
    RepairService,
  ],

  exports:[
    RepairService,
  ],

})
export class RepairModule {}
