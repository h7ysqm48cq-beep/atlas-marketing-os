import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InstagramConnectorService } from './instagram-connector.service';

describe('InstagramConnectorService', () => {
  it('keeps API fallback credentials explicit', async () => {
    const service = new InstagramConnectorService({ get: () => 'v25.0' } as unknown as ConfigService);
    await expect(service.publish({ instagramUserId: '', accessToken: '', caption: 'Atlas', mediaUrls: ['https://example.com/image.jpg'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publishes a multi-image carousel through the Graph API fallback', async () => {
    const service = new InstagramConnectorService({ get: () => 'v25.0' } as unknown as ConfigService);
    const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ id: 'child-1' }))
      .mockResolvedValueOnce(response({ id: 'child-2' }))
      .mockResolvedValueOnce(response({ id: 'carousel-container' }))
      .mockResolvedValueOnce(response({ id: 'published-media' }))
      .mockResolvedValueOnce(response({ permalink: 'https://www.instagram.com/p/abc123/' }));

    await expect(service.publish({
      instagramUserId: '17840000000000000',
      accessToken: 'token',
      caption: 'Atlas carousel',
      mediaUrls: ['https://cdn.example.com/one.jpg', 'https://cdn.example.com/two.jpg'],
    })).resolves.toEqual({
      id: 'published-media',
      creationId: 'carousel-container',
      permalink: 'https://www.instagram.com/p/abc123/',
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('is_carousel_item=true');
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('is_carousel_item=true');
    expect(String(fetchMock.mock.calls[2][1]?.body)).toContain('media_type=CAROUSEL');
    expect(String(fetchMock.mock.calls[2][1]?.body)).toContain('children=child-1%2Cchild-2');
    fetchMock.mockRestore();
  });
});
