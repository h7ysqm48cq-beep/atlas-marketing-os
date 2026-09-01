import {
  Body,
  Controller,
  Post,
} from "@nestjs/common";

import {
  PatchProposalService,
} from "./patch-proposal.service";

import {
  PatchService,
} from "./patch.service";


@Controller(
  "engineering/patch",
)
export class PatchController {

  constructor(
    private readonly patchService:
      PatchService,
    private readonly proposalService:
      PatchProposalService,
  ) {}


  @Post()
  async generate(
    @Body()
    body: {
      request: string;
      files: string[];
    },
  ) {
    const generated =
      await this.patchService.generate(
        body.request,
        body.files,
      );

    if (!generated.patches.length) {
      return {
        ...generated,
        proposal: null,
      };
    }

    const proposal =
      await this.proposalService.create(
        body.request,
        generated.patches,
      );

    return {
      ...generated,
      proposal,
    };
  }
}
