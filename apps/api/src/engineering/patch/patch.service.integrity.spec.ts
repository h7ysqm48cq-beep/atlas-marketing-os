import {
  PatchService,
} from "./patch.service";


describe("PatchService integrity", () => {
  it("does not emit executable patches when source content is unchanged", async () => {
    const ast = {
      analyze: jest.fn().mockResolvedValue({
        ok: true,
        schemaVersion: 1,
        statistics: {},
        classes: [],
      }),
    };

    const service = new PatchService(
      ast as never,
    );

    const result = await service.generate(
      "analyse patch integrity",
      [
        "apps/api/src/engineering/patch/patch.service.ts",
      ],
    );

    expect(result.patches).toEqual([]);
    expect(result.count).toBe(0);
  });
});
