import {
  Injectable,
} from "@nestjs/common";

import {
  readdir,
  stat,
} from "node:fs/promises";

import {
  join,
  extname,
} from "node:path";

import {
  RepositoryFile,
} from "./repository.types";


@Injectable()
export class RepositoryScanner {

  private readonly ignored = new Set([
    "node_modules",
    ".next",
    "dist",
    "coverage",
    ".git",
  ]);


  async scan(
    root: string,
  ): Promise<RepositoryFile[]> {

    const files: RepositoryFile[] = [];

    await this.walk(
      root,
      files,
    );

    return files;
  }


  private async walk(
    directory: string,
    output: RepositoryFile[],
  ) {

    const entries =
      await readdir(
        directory,
        {
          withFileTypes: true,
        },
      );


    for (const entry of entries) {

      if (
        this.ignored.has(
          entry.name,
        )
      ) {
        continue;
      }


      const fullPath =
        join(
          directory,
          entry.name,
        );


      if (
        entry.isDirectory()
      ) {
        await this.walk(
          fullPath,
          output,
        );

        continue;
      }


      let info;

      try {
        info =
          await stat(
            fullPath,
          );
      } catch {
        continue;
      }


      output.push({
        path:
          fullPath,

        size:
          info.size,

        extension:
          extname(
            entry.name,
          ),
      });
    }
  }
}
