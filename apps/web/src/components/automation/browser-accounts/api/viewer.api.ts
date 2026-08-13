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


export async function createBrowserViewerSession() {
  const response =
    await fetch(
      "/api/browser-viewer/session",
      {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      },
    );

  const body =
    await readJson(response);

  const token =
    typeof body.token === "string"
      ? body.token
      : "";

  if (!response.ok || !token) {
    throw new Error(
      getErrorMessage(
        body,
        "Unable to authorize Live Browser.",
      ),
    );
  }

  return token;
}
