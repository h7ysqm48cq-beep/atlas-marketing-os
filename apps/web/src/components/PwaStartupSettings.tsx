"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_PWA_STARTUP,
  PWA_STARTUP_OPTIONS,
  readLastPwaRoute,
  readPwaStartupSettings,
  savePwaStartupSettings,
  type PwaStartupMode,
  type PwaStartupSettings,
} from "@/components/pwaStartupConfig";

export function PwaStartupSettings() {
  const [settings, setSettings] =
    useState<PwaStartupSettings>(DEFAULT_PWA_STARTUP);

  const [lastRoute, setLastRoute] = useState<string | null>(null);

  useEffect(() => {
    setSettings(readPwaStartupSettings());

    setLastRoute(readLastPwaRoute());
  }, []);

  function update(next: PwaStartupSettings) {
    setSettings(next);
    savePwaStartupSettings(next);
  }

  function setMode(mode: PwaStartupMode) {
    update({
      ...settings,
      mode,
    });
  }

  const preset = PWA_STARTUP_OPTIONS.find(
    (option) => option.path === settings.path,
  );

  return (
    <section className="atlas-pwa-startup">
      <div className="atlas-pwa-startup__heading">
        <div>
          <strong>App Behaviour</strong>

          <span>
            Choose where Atlas opens when launched from your Home Screen.
          </span>
        </div>

        <label className="atlas-pwa-startup__toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) =>
              update({
                ...settings,
                enabled: event.target.checked,
              })
            }
          />

          <span>{settings.enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>

      <div className="atlas-pwa-startup__modes">
        <button
          type="button"
          disabled={!settings.enabled}
          className={settings.mode === "fixed" ? "is-active" : ""}
          onClick={() => setMode("fixed")}
        >
          <strong>Fixed page</strong>

          <span>Always open the page selected below.</span>
        </button>

        <button
          type="button"
          disabled={!settings.enabled}
          className={settings.mode === "last-page" ? "is-active" : ""}
          onClick={() => setMode("last-page")}
        >
          <strong>Remember last page</strong>

          <span>Continue where you last used Atlas.</span>
        </button>
      </div>

      <label className="atlas-pwa-startup__field">
        <span>Default / fallback page</span>

        <select
          disabled={!settings.enabled}
          value={preset ? preset.path : "__custom__"}
          onChange={(event) => {
            if (event.target.value === "__custom__") {
              return;
            }

            update({
              ...settings,
              path: event.target.value,
            });
          }}
        >
          {PWA_STARTUP_OPTIONS.map((option) => (
            <option key={option.path} value={option.path}>
              {option.label}
            </option>
          ))}

          <option value="__custom__">Custom path</option>
        </select>
      </label>

      <label className="atlas-pwa-startup__field">
        <span>Custom path</span>

        <input
          type="text"
          disabled={!settings.enabled}
          value={settings.path}
          placeholder="/ai-studio"
          onChange={(event) =>
            update({
              ...settings,
              path: event.target.value,
            })
          }
        />
      </label>

      {settings.mode === "last-page" ? (
        <div className="atlas-pwa-startup__last">
          <span>Last remembered page</span>

          <strong>{lastRoute || "No page remembered yet"}</strong>
        </div>
      ) : null}

      <p className="atlas-pwa-startup__note">
        Direct links remain unchanged. Startup behaviour only applies to a
        normal Atlas Home Screen launch.
      </p>

      <button
        type="button"
        className="atlas-pwa-startup__reset"
        onClick={() =>
          update({
            ...DEFAULT_PWA_STARTUP,
          })
        }
      >
        Reset app behaviour
      </button>
    </section>
  );
}
