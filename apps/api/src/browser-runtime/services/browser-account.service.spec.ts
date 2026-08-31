jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../generated/prisma/client', () => require('../../generated/prisma/enums'));
import { BrowserAccountService } from './browser-account.service';

describe('BrowserAccountService.syncFacebookPages', () => {
  it.each(['NATIVE_API', 'AUTOMATIC', 'BROWSER_RUNTIME'])(
    'preserves an existing channel publishing choice (%s) across repeated Page syncs',
    async (publishingPreference) => {
      let stored = {
        id: 'sports-channel', name: 'Sports News', platform: 'FACEBOOK',
        externalId: '123456789', username: null, status: 'CONNECTED',
        publishingPreference, accessTokenEncrypted: 'existing-encrypted-token',
      };
      const tx = {
        socialChannel: {
          findMany: jest.fn(async () => [{ ...stored }]),
          update: jest.fn(async ({ data }) => (stored = { ...stored, ...data })),
          create: jest.fn(),
        },
        browserAccountChannel: {
          findUnique: jest.fn().mockResolvedValue({ channelId: stored.id }),
          create: jest.fn(),
        },
        browserAccount: { update: jest.fn() },
      };
      const prisma = {
        browserAccount: { findUnique: jest.fn().mockResolvedValue({
          id: 'judy', platform: 'FACEBOOK', brandId: 'brand', workspaceId: 'workspace',
        }) },
        brand: { findUnique: jest.fn().mockResolvedValue({ id: 'brand', workspaceId: 'workspace' }) },
        $transaction: jest.fn(async (action) => action(tx)),
      };
      const service = new BrowserAccountService(prisma as never, {} as never);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await service.syncFacebookPages('judy', {
          pages: [{ pageId: '123456789', name: 'Sports News' }],
        });
        expect(result).toMatchObject({ success: true, reused: 1, created: 0 });
        expect(stored.publishingPreference).toBe(publishingPreference);
      }
      expect(stored.accessTokenEncrypted).toBe('existing-encrypted-token');
      expect(tx.socialChannel.create).not.toHaveBeenCalled();
    },
  );
});
