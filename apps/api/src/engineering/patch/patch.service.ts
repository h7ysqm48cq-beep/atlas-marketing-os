import {
  Injectable,
} from "@nestjs/common";

import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  AstBridgeService,
} from "../ast/ast.bridge.service";


export type EngineeringPatchAction =
  | "create"
  | "modify"
  | "delete";


export type EngineeringPatchAst = {
  analyzed: boolean;

  ok?: boolean;

  schemaVersion?: number;

  statistics?: Record<
    string,
    number
  >;

  classes?: string[];

  error?: string;
};


export type EngineeringPatch = {

  filePath: string;

  action:
    EngineeringPatchAction;

  before: string;

  after: string;

  explanation: string;

  ast?:
    EngineeringPatchAst;

};


@Injectable()
export class PatchService {


  constructor(
    private readonly ast:
      AstBridgeService,
  ) {}


  private repositoryRoot():
    string {

    return resolve(
      process.cwd(),
      "../..",
    );

  }


  private async analyzeAst(
    filePath: string,
    currentContent: string,
  ): Promise<EngineeringPatchAst> {

    if (
      !currentContent
      ||
      !(
        filePath.endsWith(".ts")
        ||
        filePath.endsWith(".tsx")
      )
    ) {

      return {
        analyzed:
          false,
      };

    }


    try {

      const result =
          await this.ast.analyze(
            filePath,
          );


      const classes =
        Array.isArray(
          result.classes,
        )
          ? result.classes
              .map(
                (item) => {

                  if (
                    !item
                    ||
                    typeof item !==
                      "object"
                  ) {

                    return null;

                  }


                  const name =
                    (
                      item as {
                        name?: unknown;
                      }
                    ).name;


                  return typeof name ===
                    "string"
                    ? name
                    : null;

                },
              )
              .filter(
                (
                  value,
                ): value is string =>
                  Boolean(value),
              )
          : [];


      return {

        analyzed:
          true,

        ok:
          result.ok,

        schemaVersion:
          result.schemaVersion,

        statistics:
          result.statistics,

        classes,

      };

    } catch (error) {

      return {

        analyzed:
          false,

        error:
          error instanceof Error
            ? error.message
            : "AST analysis failed.",

      };

    }

  }


  async generate(
    request: string,
    files: string[],
  ) {

    const patches:
      EngineeringPatch[] = [];


    const repositoryRoot =
      this.repositoryRoot();


    for (
      const filePath of files
    ) {

      let currentContent =
        "";


      try {

        currentContent =
          await readFile(
            resolve(
              repositoryRoot,
              filePath,
            ),
            "utf8",
          );

      } catch {

        currentContent =
          "";

      }


      const ast =
        await this.analyzeAst(
          filePath,
          currentContent,
        );


      /*
       * Repository analysis is not an executable edit.
       * PatchService must only emit a patch when a real
       * transformation produces source that differs from
       * the reviewed repository content.
       */
      const candidateContent =
        currentContent;


      if (
        candidateContent ===
        currentContent
      ) {

        continue;

      }


      const action:
        EngineeringPatchAction =
          currentContent
            ? "modify"
            : "create";


      patches.push({

        filePath,

        action,

        before:
          currentContent,

        after:
          candidateContent,

        explanation:
          ast.analyzed
            ? `Atlas AST analyzed ${filePath} before preparing the repair candidate.`
            : `Atlas prepared ${filePath} for repair analysis.`,

        ast,

      });

    }


    return {

      request,

      patches,

      count:
        patches.length,

      astAnalyzed:
        patches.filter(
          patch =>
            patch.ast?.analyzed,
        ).length,

      generatedAt:
        new Date()
          .toISOString(),

    };

  }


}
