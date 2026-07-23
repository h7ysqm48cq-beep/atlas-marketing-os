import { Body, Controller, Post } from '@nestjs/common';
import { CampaignStrategyService } from './campaign-strategy.service';
import { GenerateCampaignStrategyDto } from './dto/generate-campaign-strategy.dto';

@Controller('campaign-strategy')
export class CampaignStrategyController {
  constructor(
    private readonly campaignStrategyService: CampaignStrategyService,
  ) {}

  @Post('generate')
  generate(@Body() dto: GenerateCampaignStrategyDto) {
    return this.campaignStrategyService.generate(dto);
  }
}
