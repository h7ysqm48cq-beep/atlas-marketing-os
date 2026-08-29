export function resolvePublisherChannelIds(
  value: string | undefined,
): string[] | null {
  if (value === undefined) {
    return null;
  }

  return [
    ...new Set(
      value
        .split(',')
        .map((channelId) => channelId.trim())
        .filter(Boolean),
    ),
  ];
}
