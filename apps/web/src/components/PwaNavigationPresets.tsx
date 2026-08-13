"use client";

import { useEffect, useMemo, useState } from "react";

import {
  PWA_NAV_CHANGE_EVENT,
  readPwaNavigationSettings,
  savePwaNavigationSettings,
  type PwaNavigationSettings,
} from "@/components/pwaNavigationSettings";

type PresetId = "default" | "content" | "operations" | "knowledge";

type Preset = {
  id: PresetId;
  label: string;
  description: string;
  quickLinks: string[];
};

const PRESETS: Preset[] = [
  {
    id: "default",
    label: "Default",
    description: "General Atlas workflow",
    quickLinks: ["home", "ai-studio", "assets", "automation"],
  },
  {
    id: "content",
    label: "Content",
    description: "Creation and publishing workflow",
    quickLinks: ["ai-studio", "content-history", "assets", "calendar"],
  },
  {
    id: "operations",
    label: "Operations",
    description: "Campaign and automation management",
    quickLinks: ["automation", "campaigns", "calendar", "settings"],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    description: "Brand and AI knowledge tools",
    quickLinks: ["knowledge", "brand-brain", "prompts", "copilot"],
  },
];

function sameLinks(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function PwaNavigationPresets() {
  const [settings, setSettings] = useState<PwaNavigationSettings | null>(null);

  useEffect(() => {
    const update = () => {
      setSettings(readPwaNavigationSettings());
    };

    update();

    window.addEventListener(PWA_NAV_CHANGE_EVENT, update);

    window.addEventListener("storage", update);

    return () => {
      window.removeEventListener(PWA_NAV_CHANGE_EVENT, update);

      window.removeEventListener("storage", update);
    };
  }, []);

  const activePreset = useMemo(() => {
    if (!settings) {
      return null;
    }

    return (
      PRESETS.find((preset) =>
        sameLinks(preset.quickLinks, settings.quickLinks),
      )?.id || "custom"
    );
  }, [settings]);

  function applyPreset(preset: Preset) {
    const current = readPwaNavigationSettings();

    const next: PwaNavigationSettings = {
      ...current,
      enabled: true,
      quickLinks: [...preset.quickLinks],

      /*
       * Presets control route selection only.
       * Existing custom labels/icons remain saved.
       */
      customizations: {
        ...current.customizations,
      },
    };

    setSettings(next);

    savePwaNavigationSettings(next);
  }

  return (
    <section className="atlas-pwa-presets">
      <div className="atlas-pwa-presets__heading">
        <div>
          <strong>Navigation Presets</strong>

          <span>Switch your Atlas dock for different workflows.</span>
        </div>

        <span className="atlas-pwa-presets__current">
          {activePreset === "custom"
            ? "Custom"
            : PRESETS.find((preset) => preset.id === activePreset)?.label}
        </span>
      </div>

      <div className="atlas-pwa-presets__grid">
        {PRESETS.map((preset) => {
          const active = activePreset === preset.id;

          return (
            <button
              key={preset.id}
              type="button"
              className={`atlas-pwa-presets__item${active ? " is-active" : ""}`}
              onClick={() => applyPreset(preset)}
            >
              <strong>{preset.label}</strong>

              <span>{preset.description}</span>

              <small>
                {preset.quickLinks
                  .map((id) =>
                    id
                      .replace("content-history", "Content")
                      .replace("ai-studio", "AI Studio")
                      .replace("brand-brain", "Brand Brain")
                      .replace("ai-usage", "AI Usage")
                      .replace(/^./, (value) => value.toUpperCase()),
                  )
                  .join(" · ")}
              </small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
