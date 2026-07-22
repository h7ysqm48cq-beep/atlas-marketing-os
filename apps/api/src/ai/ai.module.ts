import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PromptBuilderService } from './prompt-builder.service';

@Module({ imports: [BrandsModule], controllers: [AiController], providers: [AiService, PromptBuilderService] })
export class AiModule {}
