import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { PromptBuilderModule } from '../prompt-builder/prompt-builder.module';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { HistoryModule } from '../history/history.module';
import { ContentValidatorModule } from '../content-validator/content-validator.module';
import { ImagePromptEngineModule } from '../image-prompt-engine/image-prompt-engine.module';
import { ContentEngineController } from './content-engine.controller';
import { ContentEngineService } from './content-engine.service';

@Module({
  imports: [
    ContextModule,
    PromptBuilderModule,
    AiProviderModule,
    HistoryModule,
    ContentValidatorModule,
    ImagePromptEngineModule,
  ],
  controllers: [
    ContentEngineController,
  ],
  providers: [
    ContentEngineService,
  ],
  exports: [
    ContentEngineService,
  ],
})
export class ContentEngineModule {}
