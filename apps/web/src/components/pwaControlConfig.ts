export const PWA_CONTROL_STORAGE_KEY = "atlas.pwa.control";

export const PWA_CONTROL_CHANGE_EVENT = "atlas:pwa-control-changed";

export type PwaControlSettings = {
  customizationsEnabled: boolean;
};

export const DEFAULT_PWA_CONTROL: PwaControlSettings = {
  customizationsEnabled: true,
};

export function readPwaControlSettings(): PwaControlSettings {
  if (typeof window === "undefined") {
    return DEFAULT_PWA_CONTROL;
  }

  try {
    const raw = window.localStorage.getItem(PWA_CONTROL_STORAGE_KEY);

    if (!raw) {
      return DEFAULT_PWA_CONTROL;
    }

    const parsed = JSON.parse(raw) as Partial<PwaControlSettings>;

    return {
      customizationsEnabled:
        typeof parsed.customizationsEnabled === "boolean"
          ? parsed.customizationsEnabled
          : true,
    };
  } catch {
    return DEFAULT_PWA_CONTROL;
  }
}

export function savePwaControlSettings(settings: PwaControlSettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    PWA_CONTROL_STORAGE_KEY,
    JSON.stringify(settings),
  );

  window.dispatchEvent(new CustomEvent(PWA_CONTROL_CHANGE_EVENT));
}
