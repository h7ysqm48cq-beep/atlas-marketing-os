import { resolvePublisherChannelIds } from './publisher-scope';

describe('resolvePublisherChannelIds', () => {
  it('keeps the publisher unrestricted when the variable is absent', () => {
    expect(resolvePublisherChannelIds(undefined)).toBeNull();
  });

  it('normalizes and deduplicates configured channel ids', () => {
    expect(
      resolvePublisherChannelIds(' channel-a,channel-b, channel-a '),
    ).toEqual(['channel-a', 'channel-b']);
  });

  it('returns an empty allowlist for an explicitly empty variable', () => {
    expect(resolvePublisherChannelIds('   ')).toEqual([]);
  });
});
