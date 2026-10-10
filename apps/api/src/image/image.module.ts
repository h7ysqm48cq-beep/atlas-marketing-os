import { Module } from '@nestjs/common';
import { AiRuntimeModule } from '../ai-runtime/ai-runtime.module';
import { ImageController } from './image.controller';
import { ImageService } from './image.service';

@Module({
  imports: [AiRuntimeModule],
  controllers: [ImageController],
  providers: [ImageService],
})
export class ImageModule {}
