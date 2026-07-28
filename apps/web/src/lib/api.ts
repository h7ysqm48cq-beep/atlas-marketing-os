const configuredApiUrl =
  process.env.NEXT_PUBLIC_API_URL?.trim();

export const API_URL = (
  configuredApiUrl || 'http://localhost:3001'
).replace(/\/+$/, '');

export function apiUrl(path: string): string {
  const normalizedPath =
    path.startsWith('/') ? path : `/${path}`;

  return `${API_URL}${normalizedPath}`;
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(apiUrl(path), init);
}
