import {
  Injectable,
} from "@nestjs/common";

import {
  RepositoryService,
} from "./repository.service";

import {
  RepositoryFile,
} from "./repository.types";


@Injectable()
export class RepositoryContextService {

  constructor(
    private readonly repository:
      RepositoryService,
  ) {}


  async buildContext(
    root: string,
    request: string,
  ) {

    const keywords =
      this.extractKeywords(
        request,
      );


    const matches: RepositoryFile[] = [];


    for (
      const keyword of keywords
    ) {

      const files =
        await this.repository.searchFiles(
          root,
          keyword,
        );

      matches.push(
        ...files,
      );
    }


    return {
      request,

      relatedFiles:
        [
          ...new Map(
            matches.map(
              file => [
                file.path,
                file,
              ],
            ),
          ).values(),
        ],
    };
  }


  private extractKeywords(
    request: string,
  ) {

    return request
      .toLowerCase()
      .split(/\s+/)
      .filter(
        word =>
          word.length > 3,
      );
  }
}
