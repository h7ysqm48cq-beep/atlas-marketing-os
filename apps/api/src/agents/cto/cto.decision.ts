import {
Injectable,
} from "@nestjs/common";

import {
CTOMemoryService,
} from "./cto.memory";


@Injectable()
export class CTODecisionService {


constructor(
private readonly memory:
CTOMemoryService,
){}



createDecision(
input:{
title:string;
problem:string;
decision:string;
reason:string;
impact:
"LOW"|"MEDIUM"|"HIGH";
}
){

return this.memory.saveDecision({

...input,

createdAt:
new Date()
.toISOString(),

});

}


}
