import {
  readFileSync,
} from "node:fs";

import {
  resolve,
} from "node:path";


function source(path: string) {
  return readFileSync(
    resolve(__dirname, path),
    "utf8",
  );
}


describe("ApplyService proposal integrity", () => {
  it("stale-checks an explicitly reviewed empty before snapshot", () => {
    const applySource = source(
      "apply.service.ts",
    );

    expect(applySource).not.toMatch(
      /if\s*\(\s*expectedBefore\s*\)/u,
    );
    expect(applySource).not.toMatch(
      /if\s*\(\s*patch\.before\s*\)/u,
    );

    expect(applySource).toMatch(
      /expectedBefore\s*!==\s*undefined/u,
    );
    expect(applySource).toMatch(
      /patch\.before\s*!==\s*undefined/u,
    );
  });

  it("preserves persisted create versus modify semantics through apply", () => {
    const applySource = source(
      "apply.service.ts",
    );
    const controllerSource = source(
      "apply.controller.ts",
    );

    expect(controllerSource).toMatch(
      /action:\s*patch\.action/u,
    );
    expect(applySource).toMatch(
      /action\?:\s*"create"\s*\|\s*"modify"/u,
    );
  });

  it("blocks a reviewed create when the target now exists", () => {
    const applySource = source(
      "apply.service.ts",
    );

    expect(applySource).toMatch(
      /fileExists/u,
    );
    expect(applySource).toMatch(
      /patch\.action\s*===\s*"create"[\s\S]{0,180}fileExists/u,
    );
  });

  it("blocks a reviewed modify when the target disappeared", () => {
    const applySource = source(
      "apply.service.ts",
    );

    expect(applySource).toMatch(
      /patch\.action\s*===\s*"modify"[\s\S]{0,180}!fileExists/u,
    );
  });
});
