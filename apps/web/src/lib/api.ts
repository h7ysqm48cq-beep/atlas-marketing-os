const configuredApiUrl =
  process.env.NEXT_PUBLIC_API_URL?.trim();

function resolveApiUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/atlas`;
  }

  const configured =
    configuredApiUrl ||
    "http://localhost:3001";

  try {
    const url =
      new URL(configured);

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
