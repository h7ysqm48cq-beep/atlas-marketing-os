export const PWA_NAV_STORAGE_KEY = "atlas.pwa.navigation";

export const PWA_NAV_CHANGE_EVENT = "atlas:pwa-navigation-settings-changed";

export type PwaNavRoute = {
  id: string;
  label: string;
  href: string;
  icon: string;
};

export type PwaNavigationCustomization = {
  label?: string;
  icon?: string;
};

export type PwaNavigationSettings = {
  enabled: boolean;
  quickLinks: string[];
  customizations: Record<string, PwaNavigationCustomization>;
};

export const PWA_NAV_ROUTES: PwaNavRoute[] = [
  { id: "home", label: "Home", href: "/", icon: "⌂" },
  {
    id: "ai-studio",
    label: "AI Studio",
    href: "/ai-studio",
    icon: "✦",
  },
  {
    id: "assets",
    label: "Assets",
    href: "/assets",
    icon: "◇",
  },
  {
    id: "automation",
    label: "Automation",
    href: "/automation",
    icon: "↻",
  },
  {
    id: "campaigns",
    label: "Campaigns",
    href: "/campaigns",
    icon: "◉",
  },
  {
    id: "calendar",
    label: "Calendar",
    href: "/calendar",
    icon: "□",
  },
  {
    id: "content-history",
    label: "Content",
    href: "/content-history",
    icon: "▤",
  },
  {
    id: "copilot",
    label: "Copilot",
    href: "/copilot",
    icon: "◎",
  },
  {
    id: "brand-brain",
    label: "Brand Brain",
    href: "/brand-brain",
    icon: "◆",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    href: "/knowledge",
    icon: "◈",
  },
  {
    id: "engineering",
    label: "Engineering",
    href: "/engineering",
    icon: "⌘",
  },
  {
    id: "ai-usage",
    label: "AI Usage",
    href: "/ai-usage",
    icon: "⌁",
  },
  {
    id: "prompts",
    label: "Prompts",
    href: "/prompts",
    icon: "≡",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: "⚙",
  },
];

export const PWA_NAV_ICONS = [
  "⌂",
  "✦",
  "◇",
  "↻",
  "◉",
  "□",
  "▤",
  "◎",
  "◆",
  "◈",
  "⌘",
  "⌁",
  "≡",
  "⚙",
] as const;

export const DEFAULT_PWA_NAVIGATION: PwaNavigationSettings = {
  enabled: true,
  quickLinks: ["home", "ai-studio", "assets", "automation"],
  customizations: {},
};

export function readPwaNavigationSettings(): PwaNavigationSettings {
  if (typeof window === "undefined") {
    return {
      ...DEFAULT_PWA_NAVIGATION,
      quickLinks: [...DEFAULT_PWA_NAVIGATION.quickLinks],
      customizations: {},
    };
  }

  try {
    const raw = window.localStorage.getItem(PWA_NAV_STORAGE_KEY);

    if (!raw) {
      return {
        ...DEFAULT_PWA_NAVIGATION,
        quickLinks: [...DEFAULT_PWA_NAVIGATION.quickLinks],
        customizations: {},
      };
    }

    const parsed = JSON.parse(raw) as Partial<PwaNavigationSettings>;

    const validIds = new Set(PWA_NAV_ROUTES.map((route) => route.id));

    const quickLinks = Array.isArray(parsed.quickLinks)
      ? parsed.quickLinks
          .filter(
            (id): id is string => typeof id === "string" && validIds.has(id),
          )
          .slice(0, 4)
      : [];

    const customizations =
      parsed.customizations && typeof parsed.customizations === "object"
        ? parsed.customizations
        : {};

    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
      quickLinks:
        quickLinks.length === 4
          ? quickLinks
          : [...DEFAULT_PWA_NAVIGATION.quickLinks],
      customizations,
    };
  } catch {
    return {
      ...DEFAULT_PWA_NAVIGATION,
      quickLinks: [...DEFAULT_PWA_NAVIGATION.quickLinks],
      customizations: {},
    };
  }
}

export function savePwaNavigationSettings(settings: PwaNavigationSettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PWA_NAV_STORAGE_KEY, JSON.stringify(settings));

  window.dispatchEvent(new CustomEvent(PWA_NAV_CHANGE_EVENT));
}
