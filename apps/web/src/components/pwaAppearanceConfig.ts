export const PWA_APPEARANCE_STORAGE_KEY = "atlas.pwa.appearance";

export const PWA_APPEARANCE_CHANGE_EVENT = "atlas:pwa-appearance-changed";

export type PwaDockStyle = "floating" | "edge" | "compact";

export type PwaAppearanceSettings = {
  showHeader: boolean;
  dockStyle: PwaDockStyle;
  showLabels: boolean;
};

export const DEFAULT_PWA_APPEARANCE: PwaAppearanceSettings = {
  showHeader: true,
  dockStyle: "floating",
  showLabels: true,
};

export function readPwaAppearanceSettings(): PwaAppearanceSettings {
  if (typeof window === "undefined") {
    return DEFAULT_PWA_APPEARANCE;
  }

  try {
    const raw = window.localStorage.getItem(PWA_APPEARANCE_STORAGE_KEY);

    if (!raw) {
      return DEFAULT_PWA_APPEARANCE;
    }

    const parsed = JSON.parse(raw) as Partial<PwaAppearanceSettings>;

    const dockStyle: PwaDockStyle =
      parsed.dockStyle === "edge" ||
      parsed.dockStyle === "compact" ||
      parsed.dockStyle === "floating"
        ? parsed.dockStyle
        : "floating";

    return {
      showHeader:
        typeof parsed.showHeader === "boolean" ? parsed.showHeader : true,

      dockStyle,

      showLabels:
        typeof parsed.showLabels === "boolean" ? parsed.showLabels : true,
    };
  } catch {
    return DEFAULT_PWA_APPEARANCE;
  }
}

export function savePwaAppearanceSettings(settings: PwaAppearanceSettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    PWA_APPEARANCE_STORAGE_KEY,
    JSON.stringify(settings),
  );

  window.dispatchEvent(new CustomEvent(PWA_APPEARANCE_CHANGE_EVENT));
}
