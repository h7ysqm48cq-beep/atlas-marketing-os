import { ConflictException } from '@nestjs/common';
import { PrismaFileOwnershipStore } from './prisma-file-ownership.store';

function mockPrisma() {
  const tx = {
    supervisorFileLock: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  return {
    tx,
    prisma: {
      supervisorFileLock: tx.supervisorFileLock,
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    },
  };
}

describe('PrismaFileOwnershipStore', () => {
  it('returns the owning task for a path', async () => {
    const { prisma } = mockPrisma();
    prisma.supervisorFileLock.findUnique.mockResolvedValue({
      path: 'apps/api/src/a.ts',
      taskId: 'ATLAS-1',
      acquiredAt: new Date('2026-08-30T00:00:00.000Z'),
    });
    const store = new PrismaFileOwnershipStore(prisma as never);

    await expect(store.findOwner('apps/api/src/a.ts')).resolves.toBe('ATLAS-1');
    expect(prisma.supervisorFileLock.findUnique).toHaveBeenCalledWith({
      where: { path: 'apps/api/src/a.ts' },
    });
  });

  it('returns null when a path has no owner', async () => {
    const { prisma } = mockPrisma();
    prisma.supervisorFileLock.findUnique.mockResolvedValue(null);
    const store = new PrismaFileOwnershipStore(prisma as never);

    await expect(store.findOwner('apps/api/src/missing.ts')).resolves.toBeNull();
  });

  it('deduplicates requested paths and acquires them atomically in one transaction', async () => {
    const { prisma, tx } = mockPrisma();
    tx.supervisorFileLock.findMany.mockResolvedValue([]);
    tx.supervisorFileLock.createMany.mockResolvedValue({ count: 2 });
    const store = new PrismaFileOwnershipStore(prisma as never);

    await expect(
      store.acquire('ATLAS-1', [
        'apps/api/src/a.ts',
        'apps/api/src/a.ts',
        'apps/api/src/b.ts',
      ]),
    ).resolves.toBeUndefined();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.supervisorFileLock.findMany).toHaveBeenCalledWith({
      where: { path: { in: ['apps/api/src/a.ts', 'apps/api/src/b.ts'] } },
    });
    expect(tx.supervisorFileLock.createMany).toHaveBeenCalledWith({
      data: [
        { path: 'apps/api/src/a.ts', taskId: 'ATLAS-1' },
        { path: 'apps/api/src/b.ts', taskId: 'ATLAS-1' },
      ],
    });
  });

  it('treats locks already owned by the same task as idempotent', async () => {
    const { prisma, tx } = mockPrisma();
    tx.supervisorFileLock.findMany.mockResolvedValue([
      {
        path: 'apps/api/src/a.ts',
        taskId: 'ATLAS-1',
        acquiredAt: new Date('2026-08-30T00:00:00.000Z'),
      },
    ]);
    tx.supervisorFileLock.createMany.mockResolvedValue({ count: 1 });
    const store = new PrismaFileOwnershipStore(prisma as never);

    await store.acquire('ATLAS-1', ['apps/api/src/a.ts', 'apps/api/src/b.ts']);

    expect(tx.supervisorFileLock.createMany).toHaveBeenCalledWith({
      data: [{ path: 'apps/api/src/b.ts', taskId: 'ATLAS-1' }],
    });
  });

  it('rejects pre-existing locks owned by another task before creating anything', async () => {
    const { prisma, tx } = mockPrisma();
    tx.supervisorFileLock.findMany.mockResolvedValue([
      {
        path: 'apps/api/src/a.ts',
        taskId: 'ATLAS-2',
        acquiredAt: new Date('2026-08-30T00:00:00.000Z'),
      },
    ]);
    const store = new PrismaFileOwnershipStore(prisma as never);

    await expect(
      store.acquire('ATLAS-1', ['apps/api/src/a.ts', 'apps/api/src/b.ts']),
    ).rejects.toMatchObject({
      response: {
        code: 'file_ownership_conflict',
        conflicts: [{ path: 'apps/api/src/a.ts', owner: 'ATLAS-2' }],
      },
    });
    expect(tx.supervisorFileLock.createMany).not.toHaveBeenCalled();
  });

  it('translates a concurrent path unique conflict into file_ownership_conflict', async () => {
    const { prisma, tx } = mockPrisma();
    tx.supervisorFileLock.findMany.mockResolvedValue([]);
    tx.supervisorFileLock.createMany.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['path'] },
    });
    const store = new PrismaFileOwnershipStore(prisma as never);

    await expect(
      store.acquire('ATLAS-1', ['apps/api/src/a.ts', 'apps/api/src/b.ts']),
    ).rejects.toMatchObject({
      response: { code: 'file_ownership_conflict' },
    });
  });

  it('releases only locks owned by the requested task', async () => {
    const { prisma } = mockPrisma();
    prisma.supervisorFileLock.deleteMany.mockResolvedValue({ count: 2 });
    const store = new PrismaFileOwnershipStore(prisma as never);

    await expect(store.release('ATLAS-1')).resolves.toBeUndefined();
    expect(prisma.supervisorFileLock.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 'ATLAS-1' },
    });
  });

  it('preserves application ConflictException values', async () => {
    const { prisma } = mockPrisma();
    const existing = new ConflictException({ code: 'file_ownership_conflict' });
    prisma.$transaction.mockRejectedValue(existing);
    const store = new PrismaFileOwnershipStore(prisma as never);

    await expect(store.acquire('ATLAS-1', ['apps/api/src/a.ts'])).rejects.toBe(
      existing,
    );
  });

  it('wraps unknown database failures as supervisor_persistence_error', async () => {
    const { prisma } = mockPrisma();
    prisma.supervisorFileLock.findUnique.mockRejectedValue(new Error('database down'));
    const store = new PrismaFileOwnershipStore(prisma as never);

    await expect(store.findOwner('apps/api/src/a.ts')).rejects.toMatchObject({
      response: { code: 'supervisor_persistence_error' },
    });
  });
});
