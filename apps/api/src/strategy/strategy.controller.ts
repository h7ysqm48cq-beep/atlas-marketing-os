import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { GenerateStrategyDto } from './dto/generate-strategy.dto';
import { StrategyService } from './strategy.service';

@Controller('strategy')
export class StrategyController {
  constructor(
    private readonly strategyService: StrategyService,
  ) {}

  @Post('generate')
  generate(
    @Body() dto: GenerateStrategyDto,
  ) {
    return this.strategyService.generate(dto);
  }
}
