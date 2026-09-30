export const FILE_OWNERSHIP_STORE = Symbol('FILE_OWNERSHIP_STORE');

export interface FileOwnershipStore {
  findOwner(path: string): Promise<string | null>;
  acquire(taskId: string, paths: string[]): Promise<void>;
  release(taskId: string): Promise<void>;
}
