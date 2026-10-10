import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { PromptBuilderModule } from '../prompt-builder/prompt-builder.module';
import { HistoryModule } from '../history/history.module';
import { AiRuntimeModule } from '../ai-runtime/ai-runtime.module';
import { AiProviderService } from './ai-provider.service';
import { AiProviderController } from './ai-provider.controller';
import { OpenAiProvider } from './openai.provider';
import { GoogleAiStudioProvider } from './google-ai-studio.provider';

@Module({
  controllers: [AiProviderController],
  imports: [
    AiRuntimeModule,
    ContextModule,
    PromptBuilderModule,
    HistoryModule,
  ],
  providers: [
    AiProviderService,
    OpenAiProvider,
    GoogleAiStudioProvider,
  ],
  exports: [
    AiProviderService,
    OpenAiProvider,
    GoogleAiStudioProvider,
  ],
})
export class AiProviderModule {}
