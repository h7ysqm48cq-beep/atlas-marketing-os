import { Module } from '@nestjs/common';
import { ImagePostProcessorService } from './image-post-processor.service';

@Module({
  providers: [
    ImagePostProcessorService,
  ],
  exports: [
    ImagePostProcessorService,
  ],
})
export class ImageProcessingModule {}
