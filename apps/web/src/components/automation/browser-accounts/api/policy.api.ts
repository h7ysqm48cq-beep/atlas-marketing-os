import {
  getBrowserRuntimeApiUrl,
} from "../utils/browser-url";


async function readJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const text =
    await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      message: text,
    };
  }
}


function getErrorMessage(
  body: Record<string, unknown>,
  fallback: string,
) {
  return typeof body.message === "string" &&
    body.message.trim()
    ? body.message
    : fallback;
}


export async function getAutomationPolicy(
  accountId: string,
) {
  const response =
    await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts/${accountId}/automation-policy`,
      {
        cache: "no-store",
      },
    );

  const body =
    await readJson(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        body,
        "Unable to load automation policy.",
      ),
    );
  }

  return body;
}


export async function updateAutomationPolicy(
  accountId: string,
  payload: unknown,
) {
  const response =
    await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts/${accountId}/automation-policy`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

  const body =
    await readJson(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        body,
        "Unable to update automation policy.",
      ),
    );
  }

  return body;
}
