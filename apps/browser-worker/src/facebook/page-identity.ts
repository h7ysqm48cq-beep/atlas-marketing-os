export const facebookPageSwitchActionPattern =
  /^switch(?: now)?$/i;

export function hasFacebookPageSwitchPrompt(
  value: string,
) {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return (
    normalized.includes(
      "switch into",
    ) &&
    (
      normalized.includes(
        "switch now",
      ) ||
      normalized.includes(
        "page to take more actions",
      )
    )
  );
}
