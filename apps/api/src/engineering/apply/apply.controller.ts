import {
  Body,
  ConflictException,
  Controller,
  Post,
} from "@nestjs/common";

import {
  PatchProposalService,
  type StoredEngineeringPatch,
} from "../patch/patch-proposal.service";

import {
  ApplyService,
} from "./apply.service";


@Controller(
  "engineering/apply",
)
export class ApplyController {

  constructor(
    private readonly applyService:
      ApplyService,
    private readonly proposalService:
      PatchProposalService,
  ) {}


  @Post("proposal")
  async applyProposal(
    @Body()
    body: {
      proposalId: string;
      revision: number;
    },
  ) {
    const proposal =
      await this.proposalService.getApproved(
        body.proposalId,
        body.revision,
      );

    const storedPatches =
      Array.isArray(proposal.patches)
        ? proposal.patches as unknown as StoredEngineeringPatch[]
        : [];

    if (!storedPatches.length) {
      throw new ConflictException(
        "Approved patch proposal has no executable patches.",
      );
    }

    const result =
      await this.applyService.applyBatch(
        storedPatches.map((patch) => ({
          filePath: patch.filePath,
          content: patch.after,
          before: patch.before,
          action: patch.action,
        })),
      );

    if (result.status === "blocked") {
      await this.proposalService.markStale(
        body.proposalId,
        body.revision,
      );

      throw new ConflictException(
        result,
      );
    }

    await this.proposalService.markApplied(
      body.proposalId,
      body.revision,
    );

    return {
      ...result,
      proposalId: body.proposalId,
      revision: body.revision,
      proposalStatus: "APPLIED",
    };
  }
}
