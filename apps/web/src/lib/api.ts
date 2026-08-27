const configuredApiUrl =
  process.env.NEXT_PUBLIC_API_URL?.trim();

function resolveApiUrl(): string {
  const configured =
    configuredApiUrl ||
    "http://localhost:3001";

  try {
    const url =
      new URL(configured);

    /*
     * Local-network development:
     *
     * When Atlas Web is opened from another device,
     * e.g. http://192.168.101.3:3000,
     * "localhost" would incorrectly point to that
     * device itself.
     *
     * Keep the configured API port/protocol but use
     * the hostname that served the Atlas Web app.
     */
    if (
      typeof window !== "undefined" &&
      (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1"
      ) &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      url.hostname =
        window.location.hostname;
    }

    return url.toString();
  } catch {
    return configured;
  }
}

export const API_URL =
  resolveApiUrl().replace(/\/+$/, "");

export function apiUrl(
  path: string,
): string {
  const normalizedPath =
    path.startsWith("/")
      ? path
      : `/${path}`;

  return `${API_URL}${normalizedPath}`;
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(
    apiUrl(path),
    init,
  );
}
