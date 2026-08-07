import {
Injectable,
} from "@nestjs/common";


import {
AgentRegistryMemory,
} from "./agent.registry.memory";


import {
AgentDefinition,
} from "./agent.registry.types";


@Injectable()
export class AgentRegistryService {


constructor(
private readonly memory:
AgentRegistryMemory,
){}



register(
agent:AgentDefinition,
){

return this.memory.register(
agent,
);

}



list(){

return this.memory.getAll();

}



get(
id:string,
){

return this.memory.find(
id,
);

}


}
