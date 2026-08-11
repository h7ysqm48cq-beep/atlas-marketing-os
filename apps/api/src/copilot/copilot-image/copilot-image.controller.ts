
import { Body, Controller, Post } from '@nestjs/common';
import { CopilotImageService } from './copilot-image.service';


@Controller('copilot')
export class CopilotImageController {

  constructor(
    private readonly service: CopilotImageService,
  ) {}


  @Post('image')
  generate(
    @Body()
    body: {
      content: string;
      platform?: string;
    },
  ) {
    return this.service.generate(body);
  }

}
