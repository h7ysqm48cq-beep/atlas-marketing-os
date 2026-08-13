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
    return JSON.parse(
      text,
    ) as Record<string, unknown>;
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


export async function getBrowserStatus(
  accountId: string,
) {
  const response =
    await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts/${accountId}/browser/status`,
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
        "Unable to load browser status.",
      ),
    );
  }

  return body;
}


export async function openBrowser(
  accountId: string,
) {
  const response =
    await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts/${accountId}/browser/open`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          headless: false,
          startUrl:
            "https://www.facebook.com/",
        }),
      },
    );

  const body =
    await readJson(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        body,
        "Unable to open browser.",
      ),
    );
  }

  return body;
}


export async function closeBrowser(
  accountId: string,
) {
  const response =
    await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts/${accountId}/browser/close`,
      {
        method: "POST",
      },
    );

  const body =
    await readJson(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        body,
        "Unable to close browser.",
      ),
    );
  }

  return body;
}


export async function inspectBrowser(
  accountId: string,
) {
  const response =
    await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts/${accountId}/browser/inspect`,
      {
        method: "POST",
      },
    );

  const body =
    await readJson(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        body,
        "Unable to verify login.",
      ),
    );
  }

  return body;
}
