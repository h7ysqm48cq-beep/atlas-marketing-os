const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

function resolveApiUrl(): string {
  const configured = configuredApiUrl || "http://localhost:3001";

  if (typeof window === "undefined") {
    return configured;
  }

  try {
    const apiUrl = new URL(configured);

    if (apiUrl.hostname === "localhost" || apiUrl.hostname === "127.0.0.1") {
      apiUrl.hostname = window.location.hostname;
    }

    return apiUrl.toString();
  } catch {
    return configured;
  }
}

export const API_URL = resolveApiUrl().replace(/\/+$/, "");

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${API_URL}${normalizedPath}`;
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(apiUrl(path), init);
}
