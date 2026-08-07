import {
Injectable,
} from "@nestjs/common";

import {
AgentDefinition,
} from "./agent.registry.types";


@Injectable()
export class AgentRegistryMemory {


private agents:
AgentDefinition[] = [];


register(
agent: AgentDefinition,
){

this.agents.push(
agent,
);

return agent;

}


getAll(){

return this.agents;

}


find(
id:string,
){

return this.agents.find(
(agent)=>
agent.id === id,
);

}


}
