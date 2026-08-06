import {
  Injectable,
} from "@nestjs/common";

import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";


export type EngineeringPatchAction =
  | "create"
  | "modify"
  | "delete";


export type EngineeringPatch = {
  filePath: string;

  action:
    EngineeringPatchAction;

  before: string;

  after: string;

  explanation: string;
};


@Injectable()
export class PatchService {

  async generate(
    request: string,
    files: string[],
  ) {

    const patches:
      EngineeringPatch[] = [];


    for (
      const filePath of files
    ) {

      let currentContent = "";


      try {

        currentContent =
          await readFile(
            resolve(
              process.cwd(),
              "..",
              "..",
              filePath,
            ),
            "utf8",
          );

      } catch {

        currentContent =
          "";

      }


      patches.push({

        filePath,

        action:
          currentContent
            ? "modify"
            : "create",

        before:
          currentContent,

        after:
          this.generateContent(
            request,
            filePath,
          ),

        explanation:
          `Atlas prepared a patch preview for ${filePath}.`,
      });
    }


    return {
      request,

      patches,

      count:
        patches.length,

      generatedAt:
        new Date()
          .toISOString(),
    };
  }


  private generateContent(
    request: string,
    filePath: string,
  ) {

    return `/**
 * Atlas Engineering Patch Preview
 *
 * File:
 * ${filePath}
 *
 * Request:
 * ${request}
 *
 * Generated content requires review.
 */
`;
  }
}
