import { Injectable } from "@nestjs/common";

@Injectable()
export class SafeAreaService {

  getPadding(width: number) {
    return Math.max(
      24,
      Math.round(width * 0.03),
    );
  }

  getLogoWidth(width: number) {
    return Math.max(
      72,
      Math.min(
        140,
        Math.round(width * 0.09),
      ),
    );
  }

  getBottomMargin(height: number) {
    return Math.max(
      24,
      Math.round(height * 0.025),
    );
  }
}
