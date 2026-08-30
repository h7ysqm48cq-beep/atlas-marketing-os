import { ConflictException, Injectable } from '@nestjs/common';
import type { FileOwnershipStore } from './file-ownership.store';

@Injectable()
export class MemoryFileOwnershipStore implements FileOwnershipStore {
  private readonly owners = new Map<string, string>();

  async findOwner(path: string): Promise<string | null> {
    return this.owners.get(path) ?? null;
  }

  async acquire(taskId: string, paths: string[]): Promise<void> {
    const conflicts = paths
      .map((path) => ({ path, owner: this.owners.get(path) }))
      .filter(
        (entry): entry is { path: string; owner: string } =>
          Boolean(entry.owner && entry.owner !== taskId),
      );

    if (conflicts.length > 0) {
      throw new ConflictException({
        code: 'file_ownership_conflict',
        conflicts,
      });
    }

    for (const path of paths) {
      this.owners.set(path, taskId);
    }
  }

  async release(taskId: string): Promise<void> {
    for (const [path, owner] of this.owners.entries()) {
      if (owner === taskId) {
        this.owners.delete(path);
      }
    }
  }
}
