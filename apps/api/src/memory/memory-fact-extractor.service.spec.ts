import {
  BrandMemoryFactType,
} from '../generated/prisma/client';
import { MemoryFactExtractorService } from './memory-fact-extractor.service';

describe('MemoryFactExtractorService', () => {
  const service =
    new MemoryFactExtractorService(
      {} as never,
      {} as never,
    );

  it('ignores one-time requests', () => {
    expect(
      service.detectCandidates(
        '帮我生成一张电影感图片',
      ),
    ).toEqual([]);
  });

  it('extracts a long-term cinematic preference', () => {
    const result =
      service.detectCandidates(
        '以后全部图片都要电影感',
      );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: BrandMemoryFactType.VISUAL,
          key: 'default_image_style',
          value: 'Cinematic',
        }),
      ]),
    );
  });

  it('extracts Simplified Chinese preference', () => {
    const result =
      service.detectCandidates(
        '以后都用简体中文，不要再用繁体',
      );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'default_language',
          value: 'Simplified Chinese',
        }),
      ]),
    );
  });

  it('extracts logo size and position', () => {
    const result =
      service.detectCandidates(
        '以后品牌字眼都放小一点，放在底部中间',
      );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'logo_size',
          value: 'Small',
        }),
        expect.objectContaining({
          key: 'logo_position',
          value: 'Bottom center',
        }),
      ]),
    );
  });

  it('extracts soft-sell preference', () => {
    const result =
      service.detectCandidates(
        '以后内容不要太像广告，不要硬销',
      );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'promotion_tone',
          value: 'Soft-sell',
        }),
      ]),
    );
  });
});
