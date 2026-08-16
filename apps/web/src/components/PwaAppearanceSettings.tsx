"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_PWA_APPEARANCE,
  readPwaAppearanceSettings,
  savePwaAppearanceSettings,
  type PwaAppearanceSettings,
} from "@/components/pwaAppearanceConfig";

export function PwaAppearanceSettings() {
  const [settings, setSettings] = useState<PwaAppearanceSettings>(
    DEFAULT_PWA_APPEARANCE,
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate client-only appearance settings from localStorage after mount.
    setSettings(readPwaAppearanceSettings());
  }, []);

  function update(next: PwaAppearanceSettings) {
    setSettings(next);
    savePwaAppearanceSettings(next);
  }

  function reset() {
    update({
      ...DEFAULT_PWA_APPEARANCE,
    });
  }

  return (
    <section className="atlas-pwa-appearance">
      <div className="atlas-pwa-appearance__heading">
        <div>
          <strong>App Appearance</strong>

          <span>Customize the installed Atlas PWA interface.</span>
        </div>
      </div>

      <div className="atlas-pwa-appearance__options">
        <label className="atlas-pwa-appearance__row">
          <div>
            <strong>Top Header</strong>

            <span>Show the Atlas header inside the PWA.</span>
          </div>

          <input
            type="checkbox"
            checked={settings.showHeader}
            onChange={(event) =>
              update({
                ...settings,
                showHeader: event.target.checked,
              })
            }
          />
        </label>

        <label className="atlas-pwa-appearance__field">
          <span>Bottom Dock Style</span>

          <select
            value={settings.dockStyle}
            onChange={(event) =>
              update({
                ...settings,
                dockStyle: event.target
                  .value as PwaAppearanceSettings["dockStyle"],
              })
            }
          >
            <option value="floating">Floating</option>

            <option value="edge">Edge-to-edge</option>

            <option value="compact">Compact</option>
          </select>
        </label>

        <label className="atlas-pwa-appearance__row">
          <div>
            <strong>Dock Labels</strong>

            <span>Show text below navigation icons.</span>
          </div>

          <input
            type="checkbox"
            checked={settings.showLabels}
            onChange={(event) =>
              update({
                ...settings,
                showLabels: event.target.checked,
              })
            }
          />
        </label>
      </div>

      <div
        className={`atlas-pwa-appearance__demo atlas-pwa-appearance__demo--${settings.dockStyle}`}
      >
        <span>⌂</span>
        <span>✦</span>
        <span>◇</span>
        <span>↻</span>
        <span>•••</span>
      </div>

      <button
        type="button"
        className="atlas-pwa-appearance__reset"
        onClick={reset}
      >
        Reset appearance
      </button>
    </section>
  );
}
