import {
Injectable,
} from "@nestjs/common";


import {
PrismaService,
} from "../../database/prisma.service";


import type {
EngineeringAuditRecord,
} from "./audit.types";


@Injectable()
export class AuditService {


constructor(
private readonly prisma:
PrismaService,
) {}


async record(
record:
EngineeringAuditRecord,
) {

return this.prisma.engineeringAudit.create({

data: {

action:
record.action,

filePath:
record.filePath,

riskLevel:
record.riskLevel,

confidence:
record.confidence,

approvalState:
record.approvalState,

status:
record.status,

},

});

}



async list() {

return this.prisma.engineeringAudit.findMany({

orderBy: {

createdAt:
"desc",

},

take:
50,

});

}


}
