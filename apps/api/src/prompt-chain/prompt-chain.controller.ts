import { Body, Controller, Post } from '@nestjs/common';
import { PreviewPromptChainDto } from './dto/preview-prompt-chain.dto';
import { PromptChainService } from './prompt-chain.service';

@Controller('prompt-chain')
export class PromptChainController {
  constructor(
    private readonly promptChainService: PromptChainService,
  ) {}

  @Post('preview')
  preview(@Body() dto: PreviewPromptChainDto) {
    return this.promptChainService.preview(dto);
  }
}
