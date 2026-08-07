import {
  Injectable,
} from "@nestjs/common";

import {
  readFile,
} from "node:fs/promises";

import {
  RepositoryScanner,
} from "./repository.scanner";


@Injectable()
export class RepositoryService {

  constructor(
    private readonly scanner:
      RepositoryScanner,
  ) {}


  async getRepositoryTree(
    root: string,
  ) {

    const files =
      await this.scanner.scan(
        root,
      );


    return {
      root,
      files,
      totalFiles:
        files.length,
    };
  }


  async getFileContent(
    path: string,
  ) {

    return readFile(
      path,
      "utf8",
    );
  }


  async searchFiles(
    root: string,
    keyword: string,
  ) {

    const tree =
      await this.getRepositoryTree(
        root,
      );


    return tree.files.filter(
      (file) =>
        file.path
          .toLowerCase()
          .includes(
            keyword.toLowerCase(),
          ),
    );
  }
}
