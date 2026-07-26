import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class PublisherService {

  private readonly logger =
    new Logger(PublisherService.name);

  async run() {

    this.logger.log(
      "Publisher Engine Started",
    );

    return {
      success: true,
      message:
        "Publisher Engine Started",
    };

  }

}
