import {
Controller,
Post,
} from "@nestjs/common";


import {
ValidationService,
} from "./validation.service";


@Controller(
"engineering/validation",
)
export class ValidationController {


constructor(
private readonly validation:
ValidationService,
){}


@Post("typescript")
run(){

return this.validation
.runTypescriptCheck();

}


}
