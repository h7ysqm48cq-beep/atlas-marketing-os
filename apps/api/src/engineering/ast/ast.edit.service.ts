import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";

import {
  execFile,
} from "node:child_process";

import {
  existsSync,
} from "node:fs";

import {
  resolve,
} from "node:path";

import {
  promisify,
} from "node:util";


const execFileAsync =
  promisify(execFile);


export type AstInsertOperation = {
  type: "insert";
  position: number;
  text: string;
};


export type AstReplaceOperation = {
  type: "replace";
  start: number;
  end: number;
  text: string;
};


export type AstDeleteOperation = {
  type: "delete";
  start: number;
  end: number;
};


export type AstEditOperation =
  | AstInsertOperation
  | AstReplaceOperation
  | AstDeleteOperation;


export type AstEditPreview = {
  ok: boolean;

  filePath?: string;

  resolvedPath?: string;

  schemaVersion?: number;

  operationCount?: number;

  pendingBeforeApply?: number;

  changed?: boolean;

  source?: string;

  originalSize?: number;

  updatedSize?: number;

  error?: string;

  errorType?: string;
};


@Injectable()
export class AstEditService {


  private repositoryRoot():
    string {

    const candidates = [
      process.env
        .ATLAS_REPOSITORY_ROOT,

      resolve(
        process.cwd(),
        "../..",
      ),

      process.cwd(),
    ].filter(
      (
        value,
      ): value is string =>
        Boolean(value),
    );


    for (
      const candidate
      of candidates
    ) {

      if (
        existsSync(
          resolve(
            candidate,
            "tools/modifier/parser.js",
          ),
        )
      ) {

        return resolve(
          candidate,
        );

      }

    }


    throw new
      InternalServerErrorException(
        "Atlas repository root could not be resolved.",
      );

  }


  /*
   * Calculate a minimal edit without text anchors.
   *
   * Array.from() works on Unicode code points.
   * JavaScript string .length / slice positions are UTF-16,
   * matching the TypeScript bridge position format.
   */
  buildCandidateOperations(
    before: string,
    after: string,
  ): AstEditOperation[] {

    if (
      before === after
    ) {

      return [];

    }


    const beforePoints =
      Array.from(
        before,
      );

    const afterPoints =
      Array.from(
        after,
      );


    const prefixLimit =
      Math.min(
        beforePoints.length,
        afterPoints.length,
      );


    let prefixPoints =
      0;


    while (
      prefixPoints
        <
      prefixLimit
      &&
      beforePoints[
        prefixPoints
      ]
        ===
      afterPoints[
        prefixPoints
      ]
    ) {

      prefixPoints +=
        1;

    }


    let suffixPoints =
      0;


    while (
      suffixPoints
        <
      (
        beforePoints.length
        -
        prefixPoints
      )
      &&
      suffixPoints
        <
      (
        afterPoints.length
        -
        prefixPoints
      )
      &&
      beforePoints[
        beforePoints.length
        -
        1
        -
        suffixPoints
      ]
        ===
      afterPoints[
        afterPoints.length
        -
        1
        -
        suffixPoints
      ]
    ) {

      suffixPoints +=
        1;

    }


    const sharedPrefix =
      beforePoints
        .slice(
          0,
          prefixPoints,
        )
        .join(
          "",
        );


    const sharedSuffix =
      suffixPoints
        > 0
        ? beforePoints
            .slice(
              beforePoints.length
              -
              suffixPoints,
            )
            .join(
              "",
            )
        : "";


    /*
     * JS string length is UTF-16 code units.
     * These are exactly the positions BridgeEditor expects.
     */
    const start =
      sharedPrefix.length;


    const end =
      before.length
      -
      sharedSuffix.length;


    const replacementEnd =
      after.length
      -
      sharedSuffix.length;


    const replacement =
      after.slice(
        start,
        replacementEnd,
      );


    if (
      start === end
    ) {

      if (
        !replacement
      ) {

        return [];

      }


      return [
        {
          type:
            "insert",

          position:
            start,

          text:
            replacement,
        },
      ];

    }


    if (
      !replacement
    ) {

      return [
        {
          type:
            "delete",

          start,

          end,
        },
      ];

    }


    return [
      {
        type:
          "replace",

        start,

        end,

        text:
          replacement,
      },
    ];

  }


  async previewCandidate(
    filePath: string,
    before: string,
    after: string,
  ): Promise<AstEditPreview> {

    if (
      before === after
    ) {

      return {
        ok:
          true,

        filePath,

        operationCount:
          0,

        changed:
          false,

        source:
          before,

        originalSize:
          before.length,

        updatedSize:
          before.length,
      };

    }


    const operations =
      this.buildCandidateOperations(
        before,
        after,
      );


    const preview =
      await this.preview(
        filePath,
        operations,
      );


    if (
      preview.source
        !==
      after
    ) {

      throw new
        InternalServerErrorException(
          "AST structured edit preview did not reproduce the repair candidate exactly.",
        );

    }


    return preview;

  }


  async preview(
    filePath: string,
    operations:
      AstEditOperation[],
  ): Promise<AstEditPreview> {

    const repositoryRoot =
      this.repositoryRoot();


    const pythonCommand =
      process.env
        .ATLAS_PYTHON_COMMAND
      ||
      "python3";


    let stdout:
      string;


    try {

      const result =
        await execFileAsync(
          pythonCommand,
          [
            "-m",
            "tools.modifier.bridge_edit_cli",

            "--project",
            repositoryRoot,

            "--file",
            filePath,

            "--operations",
            JSON.stringify(
              operations,
            ),
          ],
          {
            cwd:
              repositoryRoot,

            timeout:
              120_000,

            maxBuffer:
              20
              *
              1024
              *
              1024,

            env: {
              ...process.env,

              PYTHONUNBUFFERED:
                "1",
            },
          },
        );


      stdout =
        result.stdout;

    } catch (error) {

      const message =
        error instanceof Error
          ? error.message
          : "AST edit executor failed.";


      throw new
        InternalServerErrorException(
          message,
        );

    }


    if (
      !stdout.trim()
    ) {

      throw new
        InternalServerErrorException(
          "AST edit executor returned no output.",
        );

    }


    let result:
      AstEditPreview;


    try {

      result =
        JSON.parse(
          stdout,
        ) as AstEditPreview;

    } catch {

      throw new
        InternalServerErrorException(
          "AST edit executor returned invalid JSON.",
        );

    }


    if (
      !result.ok
    ) {

      throw new
        BadRequestException(
          result.error
          ||
          "AST structured edit failed.",
        );

    }


    return result;

  }


}
