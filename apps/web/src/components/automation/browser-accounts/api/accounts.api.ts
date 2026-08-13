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


export async function getBrowserAccounts() {
  const response =
    await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts`,
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
        "Unable to load browser accounts.",
      ),
    );
  }

  return Array.isArray(body)
    ? body
    : [];
}


export async function getBrands() {
  const response =
    await fetch(
      `${getBrowserRuntimeApiUrl()}/brands`,
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
        "Unable to load Brands.",
      ),
    );
  }

  if (Array.isArray(body)) {
    return body;
  }

  return Array.isArray(body.brands)
    ? body.brands
    : [];
}


export async function updateBrowserAccount(
  accountId: string,
  payload: unknown,
) {
  const response =
    await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts/${accountId}`,
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
        "Unable to update browser account.",
      ),
    );
  }

  return body;
}


export async function createBrowserAccount(
  payload: unknown,
) {
  const response =
    await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

  const body =
    await response.json().catch(
      () => ({}),
    );

  if (!response.ok) {
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : "Unable to create browser account.",
    );
  }

  return body;
}
