import {
Body,
Controller,
Get,
Post,
Param,
} from "@nestjs/common";


import {
AgentRegistryService,
} from "./agent.registry.service";


@Controller("agents/registry")
export class AgentRegistryController {


constructor(
private readonly registry:
AgentRegistryService,
){}



@Post()
register(
@Body()
body:any,
){

return this.registry.register(
body,
);

}



@Get()
list(){

return this.registry.list();

}



@Get(":id")
get(
@Param("id")
id:string,
){

return this.registry.get(
id,
);

}

}
