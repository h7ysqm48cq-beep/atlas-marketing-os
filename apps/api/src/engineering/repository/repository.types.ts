export type RepositoryFile = {
  path: string;
  size: number;
  extension: string;
};

export type RepositoryTree = {
  root: string;
  files: RepositoryFile[];
  totalFiles: number;
};

export type RepositorySearchResult = {
  path: string;
  matches: string[];
};

export type RepositoryContext = {
  files: RepositoryFile[];
  relatedFiles: string[];
};
