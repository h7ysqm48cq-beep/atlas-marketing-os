import {
  Injectable,
} from "@nestjs/common";


@Injectable()
export class PatchValidator {

  validate(
    expectedBefore: string,
    currentContent: string,
  ) {

    if (
      expectedBefore === currentContent
    ) {
      return {
        valid: true,
        reason:
          "File unchanged since preview.",
      };
    }


    return {
      valid: false,
      reason:
        "File changed after preview.",
    };
  }
}
