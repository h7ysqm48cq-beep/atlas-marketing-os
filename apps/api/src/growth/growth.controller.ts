import { Controller, Get } from '@nestjs/common';
import { GrowthService } from './growth.service';

@Controller('growth')
export class GrowthController {
  constructor(private readonly growthService: GrowthService) {}

  @Get('status')
  getStatus() {
    return this.growthService.getStatus();
  }
}
