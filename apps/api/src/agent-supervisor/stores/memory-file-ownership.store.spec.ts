import { ConflictException } from '@nestjs/common';
import { MemoryFileOwnershipStore } from './memory-file-ownership.store';

describe('MemoryFileOwnershipStore', () => {
  it('acquires and releases ownership', () => {
    const store = new MemoryFileOwnershipStore();

    store.acquire('ATLAS-1', ['a.ts', 'b.ts']);
    expect(store.findOwner('a.ts')).toBe('ATLAS-1');
    expect(store.findOwner('b.ts')).toBe('ATLAS-1');

    store.release('ATLAS-1');
    expect(store.findOwner('a.ts')).toBeNull();
    expect(store.findOwner('b.ts')).toBeNull();
  });

  it('rejects ownership conflicts without replacing the current owner', () => {
    const store = new MemoryFileOwnershipStore();
    store.acquire('ATLAS-1', ['a.ts']);

    expect(() => store.acquire('ATLAS-2', ['a.ts'])).toThrow(
      ConflictException,
    );
    expect(store.findOwner('a.ts')).toBe('ATLAS-1');
  });
});
