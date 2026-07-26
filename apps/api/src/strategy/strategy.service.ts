import { Injectable } from '@nestjs/common';
import { GenerateStrategyDto } from './dto/generate-strategy.dto';
import { StrategyEngine } from './engine/strategy.engine';
import { StrategyResult } from './types/strategy';

@Injectable()
export class StrategyService {
  constructor(
    private readonly strategyEngine: StrategyEngine,
  ) {}

  generate(
    dto: GenerateStrategyDto,
  ): StrategyResult {
    return this.strategyEngine.generate(dto.prompt);
  }
}
