import {
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PlannerService } from './planner.service';

@Controller('planner')
export class PlannerController {
  constructor(
    private readonly plannerService: PlannerService,
  ) {}

  @Get()
  status() {
    return this.plannerService.status();
  }

  @Post('plan')
  createPlan(
    @Body() dto: CreatePlanDto,
  ) {
    return this.plannerService.plan(dto);
  }
}
