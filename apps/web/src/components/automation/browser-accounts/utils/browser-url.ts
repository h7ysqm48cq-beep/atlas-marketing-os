import { API_URL } from "@/lib/api";

const DEFAULT_BROWSER_RUNTIME_API_URL =
  "https://api-production-7f7d.up.railway.app";

export function getBrowserRuntimeApiUrl() {
  const configured = process.env.NEXT_PUBLIC_BROWSER_RUNTIME_API_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  ) {
    return DEFAULT_BROWSER_RUNTIME_API_URL;
  }

  return API_URL.replace(/\/+$/, "");
}

export function buildNoVncUrl(viewerToken: string) {
  const configured =
    process.env.NEXT_PUBLIC_BROWSER_VIEW_URL ||
    "https://browser-worker-production-536a.up.railway.app/vnc.html";

  try {
    const url = new URL(configured);

    url.searchParams.set("autoconnect", "1");

    url.searchParams.set("resize", "scale");

    url.searchParams.set(
      "path",
      `websockify?token=${encodeURIComponent(viewerToken)}`,
    );

    url.searchParams.set("reconnect", "1");

    url.searchParams.set("reconnect_delay", "1000");

    return url.toString();
  } catch {
    return configured;
  }
}
