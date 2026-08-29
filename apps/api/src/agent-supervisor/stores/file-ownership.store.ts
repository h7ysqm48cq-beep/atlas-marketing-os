export const FILE_OWNERSHIP_STORE = Symbol('FILE_OWNERSHIP_STORE');

export interface FileOwnershipStore {
  findOwner(path: string): string | null;
  acquire(taskId: string, paths: string[]): void;
  release(taskId: string): void;
}
