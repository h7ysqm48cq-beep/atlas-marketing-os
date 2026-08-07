import {
Injectable,
} from "@nestjs/common";


import {
RecoveryRequest,
RecoveryResponse,
RecoverySuggestion,
} from "./recovery.types";


import {
PatchService,
} from "../patch/patch.service";


import {
RepairService,
} from "../repair/repair.service";


@Injectable()
export class RecoveryService {


constructor(
private readonly patchService:
PatchService,

private readonly repairService:
RepairService,
) {}


async analyze(
request: RecoveryRequest,
): Promise<RecoveryResponse> {


const error =
request.error.toLowerCase();


const patchResult =
  await this.patchService.generate(
    request.error,
    request.files?.length
      ? request.files
      : [
          "apps/api/src/engineering/recovery/recovery.service.ts",
        ],
  );


const repairEntries =
      await Promise.all(
        patchResult.patches.map(
          async (patch) => ({
            filePath:
              patch.filePath,

            repair:
              await this.repairService.generate({
                error:
                  request.error,

                filePath:
                  patch.filePath,

                currentContent:
                  patch.before
                  ||
                  "",
              }),
          }),
        ),
      );


    const repairByFile =
      new Map(
        repairEntries.map(
          ({
            filePath,
            repair,
          }) => [
            filePath,
            repair,
          ],
        ),
      );


const suggestions: RecoverySuggestion[] = [];


if (
  error.includes("cannot find")
  ||
  error.includes("module")
) {

  suggestions.push({
    reason:
      "Missing import or dependency detected.",
    action:
      "modify",

    patchRequired:
      true,

    patch:
      patchResult.patches.map(
        patch => ({
          ...patch,

          after:
            repairByFile.get(patch.filePath)!.after,

          explanation:
            repairByFile.get(patch.filePath)!.explanation,
        }),
      ),

    nextStep:
      "Generate fix patch.",
  });

}


if (
  error.includes("type")
  ||
  error.includes("assignable")
) {

  suggestions.push({
    reason:
      "Type mismatch detected.",
    action:
      "modify",

    patchRequired:
      true,

    patch:
      patchResult.patches.map(
        patch => ({
          ...patch,

          after:
            repairByFile.get(patch.filePath)!.after,

          explanation:
            repairByFile.get(patch.filePath)!.explanation,
        }),
      ),

    nextStep:
      "Generate fix patch.",
  });

}


if (
  suggestions.length === 0
) {

  suggestions.push({
    reason:
      "Unknown validation failure. Requires deeper repository analysis.",
    action:
      "review",

    patchRequired:
      false,

    nextStep:
      "Manual repository review required.",
  });

}


return {

  status:
    "analyzed",

  analysis:
    "Validation error analyzed by Recovery Agent.",

  suggestions,

};

}


}
