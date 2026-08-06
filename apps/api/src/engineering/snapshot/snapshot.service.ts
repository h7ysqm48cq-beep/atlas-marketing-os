import {
  Injectable,
} from "@nestjs/common";

import {
  PrismaService,
} from "../../database/prisma.service";


@Injectable()
export class SnapshotService {

  constructor(
    private readonly prisma:
      PrismaService,
  ) {}


  async create(
    files: string[],
    description: string,
    backupPath?: string | null,
  ) {

    return this.prisma.engineeringSnapshot.create({
      data: {
        files,

        description,

        backupPath:
          backupPath ?? null,

        status:
          "active",
      },
    });
  }


  async list() {

    return this.prisma.engineeringSnapshot.findMany({
      orderBy: {
        createdAt:
          "desc",
      },
    });
  }


  async find(
    id: string,
  ) {

    return this.prisma.engineeringSnapshot.findUnique({
      where: {
        id,
      },
    });
  }


  async markRestored(
    id: string,
  ) {

    return this.prisma.engineeringSnapshot.update({
      where: {
        id,
      },
      data: {
        status:
          "restored",
      },
    });
  }
}
