import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CampaignPlannerService } from './campaign-planner.service';
import { GenerateCampaignPlanDto } from './dto/generate-campaign-plan.dto';

@Controller('campaigns/:campaignId/plan')
export class CampaignPlannerController {
  constructor(
    private readonly campaignPlannerService: CampaignPlannerService,
  ) {}

  @Get()
  list(@Param('campaignId') campaignId: string) {
    return this.campaignPlannerService.listIdeas(campaignId);
  }

  @Post('generate')
  generate(
    @Param('campaignId') campaignId: string,
    @Body() dto: GenerateCampaignPlanDto,
  ) {
    return this.campaignPlannerService.generate(campaignId, dto);
  }

  @Delete(':ideaId')
  remove(
    @Param('campaignId') campaignId: string,
    @Param('ideaId') ideaId: string,
  ) {
    return this.campaignPlannerService.removeIdea(campaignId, ideaId);
  }
}
