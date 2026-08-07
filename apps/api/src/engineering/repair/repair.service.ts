import {
  Injectable,
} from "@nestjs/common";

import {
  RepairRequest,
  RepairResult,
} from "./repair.types";

import {
  buildRepairPrompt,
} from "./repair.prompt";

import {
  RepairClient,
} from "./repair.client";

import {
  analyzeRepairRisk,
} from "./repair.risk";

import {
  AstEditService,
} from "../ast/ast.edit.service";


@Injectable()
export class RepairService {


  constructor(
    private readonly repairClient:
      RepairClient,

    private readonly astEditor:
      AstEditService,
  ) {}


  private normalizeCandidate(
    generated: string,
  ): string {

    let candidate =
      generated.trim();


    /*
     * AI models occasionally return:
     *
     * ```ts
     * source
     * ```
     *
     * ApplyService must never write markdown fences.
     */
    const fenced =
      candidate.match(
        /^```(?:typescript|tsx?|javascript|jsx)?\s*\n([\s\S]*?)\n```$/i,
      );


    if (
      fenced?.[1]
    ) {

      candidate =
        fenced[1];

    }


    return candidate;

  }


  private supportsStructuredEdit(
    request: RepairRequest,
  ): boolean {

    return Boolean(
      request.currentContent
      &&
      (
        request.filePath.endsWith(
          ".ts",
        )
        ||
        request.filePath.endsWith(
          ".tsx",
        )
      ),
    );

  }


  async generate(
    request: RepairRequest,
  ): Promise<RepairResult> {

    const prompt =
      buildRepairPrompt(
        request,
      );


    const rawGenerated =
      await this.repairClient.generate(
        prompt,
      );


    const generated =
      this.normalizeCandidate(
        rawGenerated,
      );


    if (
      !generated
    ) {

      throw new Error(
        "Repair engine returned an empty candidate.",
      );

    }


    const risk =
      analyzeRepairRisk(
        request.filePath,
      );


    if (
      !this.supportsStructuredEdit(
        request,
      )
    ) {

      return {

        after:
          generated,

        explanation:
          "Repair engine generated a repair candidate.",

        confidence:
          0.7,

        ...risk,

      };

    }


    /*
     * Important:
     *
     * This does NOT write the file.
     *
     * BridgeEditor verifies that the proposed
     * before -> after transformation can be
     * represented as deterministic UTF-16
     * structured edits.
     */
    const preview =
      await this.astEditor
        .previewCandidate(
          request.filePath,
          request.currentContent,
          generated,
        );


    return {

      after:
        preview.source
        ??
        generated,

      explanation:
        preview.changed === false
          ? "Repair candidate produced no source change."
          : `Repair candidate verified by AST BridgeEditor using ${preview.operationCount ?? 0} structured edit(s).`,

      confidence:
        0.8,

      ...risk,

    };

  }


}
