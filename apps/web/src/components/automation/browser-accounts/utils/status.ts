export function normalizeStatus(
  value?: string | null,
) {
  return (
    value?.trim().toUpperCase() ||
    "UNKNOWN"
  );
}

export function readableStatus(
  value?: string | null,
) {
  return normalizeStatus(value).replaceAll("_"," ");
}
