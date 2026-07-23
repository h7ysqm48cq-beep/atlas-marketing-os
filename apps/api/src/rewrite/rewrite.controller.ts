import { Body, Controller, Post } from '@nestjs/common';
import { RewriteContentDto } from './dto/rewrite-content.dto';
import { RewriteService } from './rewrite.service';

@Controller('rewrite')
export class RewriteController {
  constructor(private readonly service: RewriteService) {}

  @Post()
  rewrite(@Body() dto: RewriteContentDto) {
    return this.service.rewrite(dto);
  }
}
