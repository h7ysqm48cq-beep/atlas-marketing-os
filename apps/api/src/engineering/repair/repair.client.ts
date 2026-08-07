import {
  Injectable,
} from "@nestjs/common";


import {
  AiProviderService,
} from "../../ai-provider/ai-provider.service";


import {
  parseRepairOutput,
} from "./repair.parser";


@Injectable()
export class RepairClient {


  constructor(
    private readonly aiProvider:
      AiProviderService,
  ) {}


  async generate(
    prompt: string,
  ): Promise<string> {


    const result =
      await this.aiProvider.generate(
        {
          system:
            "You are Atlas Engineering Repair Agent. Return only corrected source code.",

          user:
            prompt,
        },
        {
          model:
            "gpt-5.6",

          temperature:
            0.2,

          responseFormat:
            "text",
        },
      );


    return parseRepairOutput(
      result.text,
    );


  }


}
