import {
Controller,
Get,
} from "@nestjs/common";


import {
AuditService,
} from "./audit.service";


@Controller(
"engineering/audit",
)
export class AuditController {


constructor(
private readonly audit:
AuditService,
) {}


@Get()
list(){

return this.audit.list();

}

}
