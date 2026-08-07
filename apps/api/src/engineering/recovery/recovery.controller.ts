import {
Body,
Controller,
Post,
} from "@nestjs/common";


import {
RecoveryService,
} from "./recovery.service";


@Controller(
"engineering/recovery",
)
export class RecoveryController {


constructor(
private readonly recovery:
RecoveryService,
) {}


@Post("analyze")
analyze(
@Body()
body: {
error: string;
command?: string;
files?: string[];
},
) {

return this.recovery.analyze(
body,
);

}


}
