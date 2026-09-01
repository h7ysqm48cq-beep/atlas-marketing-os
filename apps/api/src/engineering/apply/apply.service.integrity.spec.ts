import {
  readFileSync,
} from "node:fs";

import {
  resolve,
} from "node:path";


describe("ApplyService proposal integrity", () => {
  it("stale-checks an explicitly reviewed empty before snapshot", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "apply.service.ts",
      ),
      "utf8",
    );

    expect(source).not.toMatch(
      /if\s*\(\s*expectedBefore\s*\)/u,
    );
    expect(source).not.toMatch(
      /if\s*\(\s*patch\.before\s*\)/u,
    );

    expect(source).toMatch(
      /expectedBefore\s*!==\s*undefined/u,
    );
    expect(source).toMatch(
      /patch\.before\s*!==\s*undefined/u,
    );
  });
});
