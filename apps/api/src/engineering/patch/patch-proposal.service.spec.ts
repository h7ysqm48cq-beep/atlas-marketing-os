import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

import {
  createHash,
} from "node:crypto";

import {
  PatchProposalService,
} from "./patch-proposal.service";


function sha256(value: string) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}


function storedPatch() {
  return {
    filePath: "apps/web/src/example.tsx",
    action: "modify" as const,
    before: "const value = 1;\n",
    after: "const value = 2;\n",
    beforeHash: sha256("const value = 1;\n"),
    afterHash: sha256("const value = 2;\n"),
    explanation: "Change the value.",
  };
}


function snapshotHash(
  request: string,
  revision: number,
  patches: ReturnType<typeof storedPatch>[],
) {
  return sha256(
    JSON.stringify({
      request,
      revision,
      patches,
    }),
  );
}


describe("PatchProposalService", () => {
  const userId = "user-engineer";

  function harness(
    existing: Record<string, unknown> | null = null,
  ) {
    const create = jest.fn(async ({ data }) => ({
      id: "proposal-1",
      ...data,
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
      updatedAt: new Date("2026-09-02T00:00:00.000Z"),
      approvedAt: null,
      rejectedAt: null,
      appliedAt: null,
      staleAt: null,
      approvedByUserId: null,
      rejectedByUserId: null,
      appliedByUserId: null,
    }));

    const findUnique = jest.fn(async () => existing);
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      engineeringPatchProposal: {
        create,
        findUnique,
        updateMany,
      },
    } as never;

    const auth = {
      requireUserId: jest.fn(() => userId),
    } as never;

    return {
      service: new PatchProposalService(prisma, auth),
      create,
      findUnique,
      updateMany,
    };
  }

  const patch = {
    filePath: "apps/web/src/example.tsx",
    action: "modify" as const,
    before: "const value = 1;\n",
    after: "const value = 2;\n",
    explanation: "Change the value.",
  };

  function validExisting(
    status: "READY_FOR_REVIEW" | "APPROVED" = "READY_FOR_REVIEW",
  ) {
    const request = "Change example";
    const patches = [storedPatch()];
    const revision = 1;

    return {
      id: "proposal-1",
      request,
      revision,
      status,
      patches,
      createdByUserId: userId,
      snapshotHash: snapshotHash(
        request,
        revision,
        patches,
      ),
    };
  }

  it("persists an immutable snapshot with per-file hashes", async () => {
    const { service, create } = harness();

    const proposal = await service.create(
      "Change example",
      [patch],
    );

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    const storedPatches = data.patches as Array<Record<string, unknown>>;

    expect(storedPatches).toEqual([
      expect.objectContaining({
        filePath: patch.filePath,
        before: patch.before,
        after: patch.after,
        beforeHash: sha256(patch.before),
        afterHash: sha256(patch.after),
      }),
    ]);
    expect(data.createdByUserId).toBe(userId);
    expect(data.revision).toBe(1);
    expect(data.status).toBe("READY_FOR_REVIEW");
    expect(data.snapshotHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(proposal.snapshotHash).toBe(data.snapshotHash);
  });

  it.each([
    {
      name: "no-op",
      patch: {
        ...patch,
        after: patch.before,
      },
    },
    {
      name: "artifact",
      patch: {
        ...patch,
        filePath: ".atlas-backups/example.tsx",
      },
    },
    {
      name: "unsupported delete",
      patch: {
        ...patch,
        action: "delete" as const,
        after: "",
      },
    },
  ])("rejects $name patches", async ({ patch: invalidPatch }) => {
    const { service, create } = harness();

    await expect(
      service.create("Invalid", [invalidPatch]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects duplicate file paths", async () => {
    const { service } = harness();

    await expect(
      service.create("Duplicate", [patch, patch]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("does not expose another user's proposal by id", async () => {
    const existing = {
      ...validExisting(),
      createdByUserId: "other-user",
    };
    const { service } = harness(existing);

    await expect(
      service.get("proposal-1"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("requires the exact reviewed revision for approval", async () => {
    const existing = {
      ...validExisting(),
      revision: 2,
    };
    const { service, updateMany } = harness(existing);

    await expect(
      service.approve("proposal-1", 1),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects a tampered immutable snapshot before approval", async () => {
    const existing = {
      ...validExisting(),
      snapshotHash: "0".repeat(64),
    };
    const { service, updateMany } = harness(existing);

    await expect(
      service.approve("proposal-1", 1),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects a tampered immutable snapshot before apply lookup", async () => {
    const existing = {
      ...validExisting("APPROVED"),
      snapshotHash: "f".repeat(64),
    };
    const { service } = harness(existing);

    await expect(
      service.getApproved("proposal-1", 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("moves only the reviewed proposal revision to APPROVED", async () => {
    const existing = validExisting();
    const { service, updateMany } = harness(existing);

    await service.approve("proposal-1", 1);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "proposal-1",
          revision: 1,
          status: "READY_FOR_REVIEW",
        }),
        data: expect.objectContaining({
          status: "APPROVED",
          approvedByUserId: userId,
        }),
      }),
    );
  });

  it("marks an approved revision stale without changing its snapshot", async () => {
    const existing = validExisting("APPROVED");
    const { service, updateMany } = harness(existing);

    await service.markStale("proposal-1", 1);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "STALE",
          staleAt: expect.any(Date),
        }),
      }),
    );
  });
});
