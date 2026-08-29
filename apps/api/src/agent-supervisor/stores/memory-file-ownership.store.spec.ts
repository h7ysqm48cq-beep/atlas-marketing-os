import { ConflictException } from '@nestjs/common';
import { MemoryFileOwnershipStore } from './memory-file-ownership.store';

describe('MemoryFileOwnershipStore', () => {
  it('exposes asynchronous store operations', async () => {
    const store = new MemoryFileOwnershipStore();

    const acquireResult = store.acquire('ATLAS-1', ['a.ts']);
    expect(acquireResult).toBeInstanceOf(Promise);
    await acquireResult;

    expect(store.findOwner('a.ts')).toBeInstanceOf(Promise);
    expect(store.release('ATLAS-1')).toBeInstanceOf(Promise);
  });

  it('acquires and releases ownership', async () => {
    const store = new MemoryFileOwnershipStore();

    await store.acquire('ATLAS-1', ['a.ts', 'b.ts']);
    expect(await store.findOwner('a.ts')).toBe('ATLAS-1');
    expect(await store.findOwner('b.ts')).toBe('ATLAS-1');

    await store.release('ATLAS-1');
    expect(await store.findOwner('a.ts')).toBeNull();
    expect(await store.findOwner('b.ts')).toBeNull();
  });

  it('rejects ownership conflicts without replacing the current owner', async () => {
    const store = new MemoryFileOwnershipStore();
    await store.acquire('ATLAS-1', ['a.ts']);

    await expect(store.acquire('ATLAS-2', ['a.ts'])).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await store.findOwner('a.ts')).toBe('ATLAS-1');
  });
});
