import { Injectable } from "@nestjs/common";
import {
  ImageInfo,
  LogoPlacement,
} from "./logo.types";

@Injectable()
export class LogoLayoutService {
  getPlacement(
    info: ImageInfo,
  ): LogoPlacement {

    if (
      info.platform === "Instagram Story"
    ) {
      return LogoPlacement.BOTTOM_CENTER;
    }

    if (
      info.platform === "Facebook"
    ) {
      return LogoPlacement.BOTTOM_CENTER;
    }

    return LogoPlacement.BOTTOM_RIGHT;
  }
}
