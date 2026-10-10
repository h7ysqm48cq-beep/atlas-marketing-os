import {
Injectable,
} from "@nestjs/common";

import {
TechnicalDecision,
} from "./cto.types";


@Injectable()
export class CTOMemoryService {


private decisions:
TechnicalDecision[] = [];


saveDecision(
decision: TechnicalDecision,
) {

this.decisions.push(
decision,
);

return decision;

}


getDecisions(){

return this.decisions;

}


}
