import { ConfigService } from '@nestjs/config';
import { BrowserRuntimeBridgeService } from './browser-runtime-bridge.service';
import { BrowserAccountService } from './browser-account.service';
import { RuntimeProfileService } from './runtime-profile.service';

jest.mock('./runtime-profile.service', () => ({
  RuntimeProfileService: class RuntimeProfileService {},
}));

describe('BrowserRuntimeBridgeService screenshot proxy', () => {
  it('fetches screenshot bytes with the worker token', async () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'BROWSER_WORKER_URL') {
          return 'http://worker.test:4010';
        }

        if (key === 'BROWSER_WORKER_TOKEN') {
          return 'worker-token';
        }

        return undefined;
      }),
    } as unknown as ConfigService;

    const service = new BrowserRuntimeBridgeService(
      config,
      {} as RuntimeProfileService,
      {} as BrowserAccountService,
    );
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          Uint8Array.from([0xff, 0xd8, 0xff]).buffer,
      } as Response);

    await expect(
      service.requestBuffer(
        '/screenshots?path=%2Fdata%2Fcapture.jpg',
        { method: 'GET' },
      ),
    ).resolves.toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];

    expect(url).toBe(
      'http://worker.test:4010/screenshots?path=%2Fdata%2Fcapture.jpg',
    );
    expect(options.method).toBe('GET');
    expect(
      (options.headers as Headers).get('Accept'),
    ).toBe('image/jpeg');
    expect(
      (options.headers as Headers).get('Authorization'),
    ).toBe('Bearer worker-token');

    fetchMock.mockRestore();
  });
});
