import {
  Injectable,
} from "@nestjs/common";

import {
  RepairRequest,
  RepairResult,
} from "./repair.types";


import {
  buildRepairPrompt,
} from "./repair.prompt";


import {
  RepairClient,
} from "./repair.client";


import {
  analyzeRepairRisk,
} from "./repair.risk";


@Injectable()
export class RepairService {


  constructor(
    private readonly repairClient:
      RepairClient,
  ) {}


  async generate(
    request: RepairRequest,
  ): Promise<RepairResult> {


    const prompt =
      buildRepairPrompt(
        request,
      );


    const generated =
      await this.repairClient.generate(
        prompt,
      );


    const risk =
      analyzeRepairRisk(
        request.filePath,
      );


    return {

      after:
        generated,

      explanation:
        "Repair engine generated a repair candidate.",

      confidence:
        0.7,

      ...risk,

    };

  }


}
