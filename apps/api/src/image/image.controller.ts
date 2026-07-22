import { Body, Controller, Post } from '@nestjs/common';
import { GenerateImageDto } from './dto/generate-image.dto';
import { ImageService } from './image.service';

@Controller('images')
export class ImageController {
  constructor(private readonly imageService: ImageService) {}

  @Post('generate')
  generate(@Body() dto: GenerateImageDto) {
    return this.imageService.generate(dto);
  }
}
