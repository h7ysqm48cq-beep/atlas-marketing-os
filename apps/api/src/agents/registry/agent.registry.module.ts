import {
Module,
} from "@nestjs/common";


import {
AgentRegistryController,
} from "./agent.registry.controller";


import {
AgentRegistryService,
} from "./agent.registry.service";


import {
AgentRegistryMemory,
} from "./agent.registry.memory";


@Module({

controllers:[

AgentRegistryController,

],

providers:[

AgentRegistryService,

AgentRegistryMemory,

],

exports:[

AgentRegistryService,

],

})


export class AgentRegistryModule {}
