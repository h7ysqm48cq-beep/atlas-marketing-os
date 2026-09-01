import {
  readFileSync,
} from "node:fs";

import {
  resolve,
} from "node:path";


function source(
  path: string,
): string {
  return readFileSync(
    resolve(
      __dirname,
      path,
    ),
    "utf8",
  );
}


describe("Engineering patch proposal contract", () => {
  it("persists immutable reviewed patch proposals", () => {
    const schema = source(
      "../../../prisma/schema.prisma",
    );

    expect(schema).toContain(
      "enum EngineeringPatchProposalStatus",
    );
    expect(schema).toContain(
      "model EngineeringPatchProposal",
    );
    expect(schema).toMatch(
      /revision\s+Int/u,
    );
    expect(schema).toMatch(
      /snapshotHash\s+String/u,
    );
    expect(schema).toMatch(
      /patches\s+Json/u,
    );
    expect(schema).toMatch(
      /createdByUserId\s+String/u,
    );
  });

  it("does not expose raw client-controlled batch apply", () => {
    const controller = source(
      "../apply/apply.controller.ts",
    );

    expect(controller).toMatch(
      /@Post\(["']proposal["']\)/u,
    );
    expect(controller).toMatch(
      /proposalId/u,
    );
    expect(controller).toMatch(
      /revision/u,
    );
    expect(controller).not.toMatch(
      /@Post\(["']batch["']\)/u,
    );
  });

  it("persists generated executable patches before review", () => {
    const controller = source(
      "patch.controller.ts",
    );

    expect(controller).toMatch(
      /PatchProposalService/u,
    );
    expect(controller).toMatch(
      /proposal/u,
    );
  });
});
