import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrowserRuntimeBridgeService } from './browser-runtime-bridge.service';
import { RuntimeProfileService } from './runtime-profile.service';

jest.mock('./runtime-profile.service', () => ({
  RuntimeProfileService: class RuntimeProfileService {},
}));

type NormalizePrepareInput = (input: {
  caption: string;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
}) => {
  caption: string;
  imageUrl: string | null;
  imageUrls: string[];
};

describe('BrowserRuntimeBridgeService Facebook media input', () => {
  const service = new BrowserRuntimeBridgeService(
    {} as ConfigService,
    {} as RuntimeProfileService,
  );
  const normalizePrepareInput = (
    service as unknown as {
      normalizePrepareInput: NormalizePrepareInput;
    }
  ).normalizePrepareInput.bind(service);

  it('normalizes, de-duplicates and preserves all Facebook image URLs', () => {
    expect(
      normalizePrepareInput({
        caption: ' Test post ',
        imageUrl: 'https://cdn.example.com/one.jpg',
        imageUrls: [
          ' https://cdn.example.com/one.jpg ',
          'https://cdn.example.com/two.png',
        ],
      }),
    ).toMatchObject({
      caption: 'Test post',
      imageUrl: 'https://cdn.example.com/one.jpg',
      imageUrls: [
        'https://cdn.example.com/one.jpg',
        'https://cdn.example.com/two.png',
      ],
    });
  });

  it('rejects a non-http Facebook image URL', () => {
    expect(() =>
      normalizePrepareInput({
        caption: 'Test post',
        imageUrls: ['file:///tmp/image.jpg'],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects more than ten Facebook images', () => {
    expect(() =>
      normalizePrepareInput({
        caption: 'Test post',
        imageUrls: Array.from(
          { length: 11 },
          (_, index) => `https://cdn.example.com/${index}.jpg`,
        ),
      }),
    ).toThrow('Facebook posts support at most 10 images.');
  });
});
