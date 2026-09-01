import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  createHash,
} from "node:crypto";

import {
  isAbsolute,
} from "node:path";

import {
  AuthContextService,
} from "../../auth/auth-context.service";

import {
  PrismaService,
} from "../../database/prisma.service";

import {
  isEngineeringArtifactPath,
} from "../repository/repository-artifact-policy";

import type {
  EngineeringPatch,
  EngineeringPatchAction,
} from "./patch.service";


export type StoredEngineeringPatch = {
  filePath: string;
  action: EngineeringPatchAction;
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
  explanation: string;
};


type PersistedProposalSnapshot = {
  request: string;
  revision: number;
  snapshotHash: string;
  patches: unknown;
};


@Injectable()
export class PatchProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthContextService,
  ) {}


  private sha256(value: string): string {
    return createHash("sha256")
      .update(value)
      .digest("hex");
  }


  private normalizePath(filePath: string): string {
    const normalized = filePath
      .replaceAll("\\", "/")
      .replace(/^\.\/+/, "")
      .trim();

    if (
      !normalized ||
      isAbsolute(normalized) ||
      normalized
        .split("/")
        .some((part) => part === "..")
    ) {
      throw new BadRequestException(
        `Invalid patch path: ${filePath}`,
      );
    }

    if (isEngineeringArtifactPath(normalized)) {
      throw new BadRequestException(
        `Engineering artifact paths cannot be proposed: ${normalized}`,
      );
    }

    return normalized;
  }


  private normalizePatches(
    patches: EngineeringPatch[],
  ): StoredEngineeringPatch[] {
    if (!patches.length) {
      throw new BadRequestException(
        "At least one executable patch is required.",
      );
    }

    const seen = new Set<string>();

    const normalized = patches.map((patch) => {
      const filePath = this.normalizePath(
        patch.filePath,
      );

      if (seen.has(filePath)) {
        throw new BadRequestException(
          `Duplicate patch path: ${filePath}`,
        );
      }
      seen.add(filePath);

      if (patch.before === patch.after) {
        throw new BadRequestException(
          `No-op patches cannot be proposed: ${filePath}`,
        );
      }

      if (
        patch.action !== "create" &&
        patch.action !== "modify"
      ) {
        throw new BadRequestException(
          `Unsupported patch action for ${filePath}.`,
        );
      }

      return {
        filePath,
        action: patch.action,
        before: patch.before,
        after: patch.after,
        beforeHash: this.sha256(patch.before),
        afterHash: this.sha256(patch.after),
        explanation: patch.explanation,
      };
    });

    return normalized.sort((left, right) =>
      left.filePath.localeCompare(right.filePath),
    );
  }


  private snapshotHash(
    request: string,
    revision: number,
    patches: StoredEngineeringPatch[],
  ): string {
    return this.sha256(
      JSON.stringify({
        request,
        revision,
        patches,
      }),
    );
  }


  private persistedPatches(
    value: unknown,
  ): StoredEngineeringPatch[] {
    if (!Array.isArray(value) || !value.length) {
      throw new ConflictException(
        "Patch proposal snapshot is invalid.",
      );
    }

    const seen = new Set<string>();

    return value.map((raw) => {
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw)
      ) {
        throw new ConflictException(
          "Patch proposal snapshot is invalid.",
        );
      }

      const candidate = raw as Partial<StoredEngineeringPatch>;

      if (
        typeof candidate.filePath !== "string" ||
        typeof candidate.before !== "string" ||
        typeof candidate.after !== "string" ||
        typeof candidate.beforeHash !== "string" ||
        typeof candidate.afterHash !== "string" ||
        typeof candidate.explanation !== "string" ||
        (
          candidate.action !== "create" &&
          candidate.action !== "modify"
        )
      ) {
        throw new ConflictException(
          "Patch proposal snapshot is invalid.",
        );
      }

      let normalizedPath: string;
      try {
        normalizedPath = this.normalizePath(
          candidate.filePath,
        );
      } catch {
        throw new ConflictException(
          "Patch proposal snapshot contains an invalid path.",
        );
      }

      if (
        normalizedPath !== candidate.filePath ||
        seen.has(normalizedPath) ||
        candidate.before === candidate.after ||
        candidate.beforeHash !== this.sha256(candidate.before) ||
        candidate.afterHash !== this.sha256(candidate.after)
      ) {
        throw new ConflictException(
          "Patch proposal snapshot integrity check failed.",
        );
      }

      seen.add(normalizedPath);

      return {
        filePath: normalizedPath,
        action: candidate.action,
        before: candidate.before,
        after: candidate.after,
        beforeHash: candidate.beforeHash,
        afterHash: candidate.afterHash,
        explanation: candidate.explanation,
      };
    });
  }


  private requireSnapshotIntegrity(
    proposal: PersistedProposalSnapshot,
  ) {
    const patches = this.persistedPatches(
      proposal.patches,
    );

    const expectedHash = this.snapshotHash(
      proposal.request,
      proposal.revision,
      patches,
    );

    if (proposal.snapshotHash !== expectedHash) {
      throw new ConflictException(
        "Patch proposal immutable snapshot has changed.",
      );
    }
  }


  private requireRevision(
    proposal: {
      revision: number;
    },
    revision: number,
  ) {
    if (
      !Number.isInteger(revision) ||
      revision < 1 ||
      proposal.revision !== revision
    ) {
      throw new ConflictException(
        "Patch proposal revision does not match the reviewed revision.",
      );
    }
  }


  async create(
    request: string,
    patches: EngineeringPatch[],
  ) {
    const createdByUserId =
      this.auth.requireUserId();

    const cleanRequest = request.trim();
    if (!cleanRequest) {
      throw new BadRequestException(
        "Patch proposal request is required.",
      );
    }

    const revision = 1;
    const normalizedPatches =
      this.normalizePatches(patches);

    const snapshotHash = this.snapshotHash(
      cleanRequest,
      revision,
      normalizedPatches,
    );

    return this.prisma.engineeringPatchProposal.create({
      data: {
        request: cleanRequest,
        status: "READY_FOR_REVIEW",
        revision,
        snapshotHash,
        patches: normalizedPatches,
        createdByUserId,
      },
    });
  }


  async get(id: string) {
  const actor = this.auth.requireUserId();
  const proposal =
    await this.prisma.engineeringPatchProposal.findUnique({
      where: { id },
    });

  if (
    !proposal ||
    proposal.createdByUserId !== actor
  ) {
    throw new NotFoundException(
      "Patch proposal not found.",
    );
  }

  return proposal;
}


  async approve(
    id: string,
    revision: number,
  ) {
    const actor = this.auth.requireUserId();
    const proposal = await this.get(id);
    this.requireRevision(proposal, revision);
    this.requireSnapshotIntegrity(proposal);

    if (proposal.status !== "READY_FOR_REVIEW") {
      throw new ConflictException(
        "Only proposals ready for review can be approved.",
      );
    }

    const result =
      await this.prisma.engineeringPatchProposal.updateMany({
        where: {
          id,
          revision,
          status: "READY_FOR_REVIEW",
          snapshotHash: proposal.snapshotHash,
        },
        data: {
          status: "APPROVED",
          approvedByUserId: actor,
          approvedAt: new Date(),
        },
      });

    if (result.count !== 1) {
      throw new ConflictException(
        "Patch proposal changed before approval.",
      );
    }

    return {
      ...proposal,
      status: "APPROVED" as const,
      approvedByUserId: actor,
    };
  }


  async reject(
    id: string,
    revision: number,
  ) {
    const actor = this.auth.requireUserId();
    const proposal = await this.get(id);
    this.requireRevision(proposal, revision);
    this.requireSnapshotIntegrity(proposal);

    if (proposal.status !== "READY_FOR_REVIEW") {
      throw new ConflictException(
        "Only proposals ready for review can be rejected.",
      );
    }

    const result =
      await this.prisma.engineeringPatchProposal.updateMany({
        where: {
          id,
          revision,
          status: "READY_FOR_REVIEW",
          snapshotHash: proposal.snapshotHash,
        },
        data: {
          status: "REJECTED",
          rejectedByUserId: actor,
          rejectedAt: new Date(),
        },
      });

    if (result.count !== 1) {
      throw new ConflictException(
        "Patch proposal changed before rejection.",
      );
    }

    return {
      ...proposal,
      status: "REJECTED" as const,
      rejectedByUserId: actor,
    };
  }


  async getApproved(
    id: string,
    revision: number,
  ) {
    const proposal = await this.get(id);
    this.requireRevision(proposal, revision);
    this.requireSnapshotIntegrity(proposal);

    if (proposal.status !== "APPROVED") {
      throw new ConflictException(
        "Patch proposal must be approved before apply.",
      );
    }

    return proposal;
  }


  async markStale(
    id: string,
    revision: number,
  ) {
    const proposal = await this.get(id);
    this.requireRevision(proposal, revision);
    this.requireSnapshotIntegrity(proposal);

    if (proposal.status !== "APPROVED") {
      throw new ConflictException(
        "Only an approved proposal can become stale.",
      );
    }

    const result =
      await this.prisma.engineeringPatchProposal.updateMany({
        where: {
          id,
          revision,
          status: "APPROVED",
          snapshotHash: proposal.snapshotHash,
        },
        data: {
          status: "STALE",
          staleAt: new Date(),
        },
      });

    if (result.count !== 1) {
      throw new ConflictException(
        "Patch proposal changed before stale marking.",
      );
    }
  }


  async markApplied(
    id: string,
    revision: number,
  ) {
    const actor = this.auth.requireUserId();
    const proposal = await this.get(id);
    this.requireRevision(proposal, revision);
    this.requireSnapshotIntegrity(proposal);

    if (proposal.status !== "APPROVED") {
      throw new ConflictException(
        "Only an approved proposal can be marked applied.",
      );
    }

    const result =
      await this.prisma.engineeringPatchProposal.updateMany({
        where: {
          id,
          revision,
          status: "APPROVED",
          snapshotHash: proposal.snapshotHash,
        },
        data: {
          status: "APPLIED",
          appliedByUserId: actor,
          appliedAt: new Date(),
        },
      });

    if (result.count !== 1) {
      throw new ConflictException(
        "Patch proposal changed before completion.",
      );
    }
  }
}
