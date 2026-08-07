import {
Body,
Controller,
Post,
} from "@nestjs/common";

import {
CTOService,
} from "./cto.service";


@Controller("agents/cto")
export class CTOController {


constructor(
private readonly cto:
CTOService,
){}



@Post("analyze")
analyze(
@Body()
body:any,
){

return this.cto.analyze(
body,
);

}


}
