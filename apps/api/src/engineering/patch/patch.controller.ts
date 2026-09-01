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


type ProposalDecisionBody = {
  proposalId: string;
  revision: number;
};


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


  @Post("proposal/approve")
  approveProposal(
    @Body()
    body: ProposalDecisionBody,
  ) {
    return this.proposalService.approve(
      body.proposalId,
      body.revision,
    );
  }


  @Post("proposal/reject")
  rejectProposal(
    @Body()
    body: ProposalDecisionBody,
  ) {
    return this.proposalService.reject(
      body.proposalId,
      body.revision,
    );
  }
}
