import {
  Injectable,
} from "@nestjs/common";

import {
  RepairRequest,
  RepairResult,
} from "./repair.types";


@Injectable()
export class RepairService {


  async generate(
    request: RepairRequest,
  ): Promise<RepairResult> {


    return {

      after:
        request.currentContent,

      explanation:
        "Repair engine generated a safe preview. AI generation will be connected next.",

      confidence:
        0.5,

    };

  }


}
