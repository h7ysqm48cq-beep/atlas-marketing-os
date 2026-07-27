import { Module } from '@nestjs/common';
import { PromptBuilderController } from './prompt-builder.controller';
import { PromptBuilderService } from './prompt-builder.service';

@Module({
  controllers: [PromptBuilderController],
  providers: [PromptBuilderService],
  exports: [PromptBuilderService],
})
export class PromptBuilderModule {}
