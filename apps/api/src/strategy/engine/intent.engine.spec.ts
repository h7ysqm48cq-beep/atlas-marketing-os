import { IntentEngine } from './intent.engine';
import { IntentType } from '../types/intent';

describe('IntentEngine', () => {
  const engine = new IntentEngine();

  it.each([
    [
      '帮我做世界杯 Campaign',
      IntentType.CAMPAIGN_CREATION,
    ],
    [
      '帮我优化这段文案',
      IntentType.COPYWRITING,
    ],
    [
      '为什么这个广告没人留言？帮我分析',
      IntentType.ANALYTICS,
    ],
    [
      '帮我优化 SEO keywords',
      IntentType.SEO,
    ],
    [
      '帮我设计一张 Facebook 海报',
      IntentType.IMAGE,
    ],
  ])(
    'classifies "%s" as %s',
    (prompt, expectedIntent) => {
      const result = engine.classify(prompt);

      expect(result.intent).toBe(expectedIntent);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.reason).toBeTruthy();
    },
  );

  it('returns UNKNOWN for an unsupported request', () => {
    const result = engine.classify(
      '今天天气好像不错',
    );

    expect(result.intent).toBe(IntentType.UNKNOWN);
  });

  it('returns zero confidence for an empty request', () => {
    const result = engine.classify('   ');

    expect(result.intent).toBe(IntentType.UNKNOWN);
    expect(result.confidence).toBe(0);
  });
});
