export const PWA_STARTUP_STORAGE_KEY = "atlas.pwa.startup";

export const PWA_STARTUP_CHANGE_EVENT = "atlas:pwa-startup-changed";

export const PWA_LAST_ROUTE_KEY = "atlas.pwa.last-route";

export type PwaStartupMode = "fixed" | "last-page";

export type PwaStartupSettings = {
  enabled: boolean;
  mode: PwaStartupMode;
  path: string;
};

export const DEFAULT_PWA_STARTUP: PwaStartupSettings = {
  enabled: false,
  mode: "fixed",
  path: "/",
};

export const PWA_STARTUP_OPTIONS = [
  { label: "Dashboard", path: "/" },
  { label: "AI Studio", path: "/ai-studio" },
  { label: "Assets", path: "/assets" },
  { label: "Automation", path: "/automation" },
  { label: "Campaigns", path: "/campaigns" },
  { label: "Calendar", path: "/calendar" },
  {
    label: "Content History",
    path: "/content-history",
  },
  { label: "Copilot", path: "/copilot" },
  { label: "Brand Brain", path: "/brand-brain" },
  { label: "Knowledge", path: "/knowledge" },
  { label: "Settings", path: "/settings" },
] as const;

function normalizePath(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "/";
  }

  if (!trimmed.startsWith("/")) {
    return `/${trimmed}`;
  }

  return trimmed;
}

export function readPwaStartupSettings(): PwaStartupSettings {
  if (typeof window === "undefined") {
    return DEFAULT_PWA_STARTUP;
  }

  try {
    const raw = window.localStorage.getItem(PWA_STARTUP_STORAGE_KEY);

    if (!raw) {
      return DEFAULT_PWA_STARTUP;
    }

    const parsed = JSON.parse(raw) as Partial<PwaStartupSettings>;

    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,

      mode: parsed.mode === "last-page" ? "last-page" : "fixed",

      path: typeof parsed.path === "string" ? normalizePath(parsed.path) : "/",
    };
  } catch {
    return DEFAULT_PWA_STARTUP;
  }
}

export function savePwaStartupSettings(settings: PwaStartupSettings) {
  if (typeof window === "undefined") {
    return;
  }

  const normalized: PwaStartupSettings = {
    enabled: settings.enabled,
    mode: settings.mode === "last-page" ? "last-page" : "fixed",
    path: normalizePath(settings.path),
  };

  window.localStorage.setItem(
    PWA_STARTUP_STORAGE_KEY,
    JSON.stringify(normalized),
  );

  window.dispatchEvent(new CustomEvent(PWA_STARTUP_CHANGE_EVENT));
}

export function readLastPwaRoute() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const route = window.localStorage.getItem(PWA_LAST_ROUTE_KEY);

    if (!route || !route.startsWith("/")) {
      return null;
    }

    return route;
  } catch {
    return null;
  }
}

export function saveLastPwaRoute(route: string) {
  if (typeof window === "undefined") {
    return;
  }

  if (!route || !route.startsWith("/")) {
    return;
  }

  try {
    window.localStorage.setItem(PWA_LAST_ROUTE_KEY, route);
  } catch {
    // Storage may be unavailable.
  }
}
