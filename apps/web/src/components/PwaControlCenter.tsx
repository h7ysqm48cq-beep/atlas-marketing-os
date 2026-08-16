"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_PWA_CONTROL,
  PWA_CONTROL_CHANGE_EVENT,
  PWA_CONTROL_STORAGE_KEY,
  readPwaControlSettings,
  savePwaControlSettings,
  type PwaControlSettings,
} from "@/components/pwaControlConfig";

import {
  PWA_NAV_CHANGE_EVENT,
  PWA_NAV_STORAGE_KEY,
} from "@/components/pwaNavigationSettings";

import {
  PWA_APPEARANCE_CHANGE_EVENT,
  PWA_APPEARANCE_STORAGE_KEY,
} from "@/components/pwaAppearanceConfig";

import {
  PWA_LAST_ROUTE_KEY,
  PWA_STARTUP_CHANGE_EVENT,
  PWA_STARTUP_STORAGE_KEY,
} from "@/components/pwaStartupConfig";

const STARTUP_SESSION_KEY = "atlas.pwa.startup.applied";

export function PwaControlCenter() {
  const [settings, setSettings] =
    useState<PwaControlSettings>(DEFAULT_PWA_CONTROL);

  const [message, setMessage] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate client-only PWA controls from localStorage after mount.
    setSettings(readPwaControlSettings());
  }, []);

  function update(next: PwaControlSettings) {
    setSettings(next);
    savePwaControlSettings(next);
  }

  function broadcastReset() {
    window.dispatchEvent(new CustomEvent(PWA_NAV_CHANGE_EVENT));

    window.dispatchEvent(new CustomEvent(PWA_APPEARANCE_CHANGE_EVENT));

    window.dispatchEvent(new CustomEvent(PWA_STARTUP_CHANGE_EVENT));

    window.dispatchEvent(new CustomEvent(PWA_CONTROL_CHANGE_EVENT));
  }

  function clearLastPage() {
    try {
      window.localStorage.removeItem(PWA_LAST_ROUTE_KEY);

      window.sessionStorage.removeItem(STARTUP_SESSION_KEY);
    } catch {
      // Storage may be unavailable.
    }

    setMessage("Last remembered page cleared.");

    window.setTimeout(() => setMessage(""), 2500);
  }

  function resetAll() {
    const confirmed = window.confirm(
      "Reset all Atlas PWA settings to default?",
    );

    if (!confirmed) {
      return;
    }

    try {
      window.localStorage.removeItem(PWA_NAV_STORAGE_KEY);

      window.localStorage.removeItem(PWA_APPEARANCE_STORAGE_KEY);

      window.localStorage.removeItem(PWA_STARTUP_STORAGE_KEY);

      window.localStorage.removeItem(PWA_LAST_ROUTE_KEY);

      window.localStorage.removeItem(PWA_CONTROL_STORAGE_KEY);

      window.sessionStorage.removeItem(STARTUP_SESSION_KEY);
    } catch {
      // Storage may be unavailable.
    }

    setSettings(DEFAULT_PWA_CONTROL);

    broadcastReset();

    setMessage("All PWA settings restored to default.");

    window.setTimeout(() => setMessage(""), 3000);
  }

  return (
    <section className="atlas-pwa-control">
      <div className="atlas-pwa-control__heading">
        <div>
          <strong>PWA Control Center</strong>

          <span>Manage Atlas app customizations and stored state.</span>
        </div>

        <label className="atlas-pwa-control__toggle">
          <input
            type="checkbox"
            checked={settings.customizationsEnabled}
            onChange={(event) =>
              update({
                customizationsEnabled: event.target.checked,
              })
            }
          />

          <span>{settings.customizationsEnabled ? "Custom" : "Default"}</span>
        </label>
      </div>

      <div className="atlas-pwa-control__status">
        <div>
          <span>App behaviour</span>

          <strong>
            {settings.customizationsEnabled
              ? "Custom settings enabled"
              : "Atlas defaults"}
          </strong>
        </div>

        <p>
          Turning custom settings off keeps the PWA installed, but uses the
          default Atlas navigation and appearance and disables startup
          overrides.
        </p>
      </div>

      <div className="atlas-pwa-control__actions">
        <button type="button" onClick={clearLastPage}>
          Clear last page
        </button>

        <button
          type="button"
          className="atlas-pwa-control__reset"
          onClick={resetAll}
        >
          Reset all PWA settings
        </button>
      </div>

      {message ? (
        <div className="atlas-pwa-control__message" role="status">
          {message}
        </div>
      ) : null}
    </section>
  );
}
