import {
  getBrowserRuntimeApiUrl,
} from "../utils/browser-url";


export async function getTimeline(
  accountId: string,
) {
  const response =
    await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts/${accountId}/timeline`,
      {
        cache: "no-store",
      },
    );

  const body =
    await response.json().catch(
      () => [],
    );

  if (!response.ok) {
    throw new Error(
      "Unable to load timeline.",
    );
  }

  return Array.isArray(body)
    ? body
    : [];
}
