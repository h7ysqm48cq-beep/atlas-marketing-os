"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_PWA_NAVIGATION,
  PWA_NAV_ROUTES,
  readPwaNavigationSettings,
  savePwaNavigationSettings,
  type PwaNavigationSettings,
} from "@/components/pwaNavigationSettings";

export function PwaAppSettings() {
  const [settings, setSettings] = useState<PwaNavigationSettings>(
    DEFAULT_PWA_NAVIGATION,
  );

  useEffect(() => {
    setSettings(readPwaNavigationSettings());
  }, []);

  const previewRoutes = useMemo(
    () =>
      settings.quickLinks
        .map((id) => PWA_NAV_ROUTES.find((route) => route.id === id))
        .filter(Boolean),
    [settings.quickLinks],
  );

  function update(next: PwaNavigationSettings) {
    setSettings(next);
    savePwaNavigationSettings(next);
  }

  function changeSlot(index: number, routeId: string) {
    const nextLinks = [...settings.quickLinks];

    /*
     * If the selected route already exists in
     * another slot, swap both positions.
     */
    const existingIndex = nextLinks.indexOf(routeId);

    if (existingIndex !== -1 && existingIndex !== index) {
      const current = nextLinks[index];

      nextLinks[existingIndex] = current;
    }

    nextLinks[index] = routeId;

    update({
      ...settings,
      quickLinks: nextLinks,
    });
  }

  function reset() {
    update({
      enabled: DEFAULT_PWA_NAVIGATION.enabled,
      quickLinks: [...DEFAULT_PWA_NAVIGATION.quickLinks],
    });
  }

  return (
    <section className="atlas-pwa-settings">
      <div className="atlas-pwa-settings__heading">
        <div>
          <strong>PWA Navigation</strong>

          <span>Customize your installed Atlas app.</span>
        </div>

        <label className="atlas-pwa-settings__toggle">
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

      <div className="atlas-pwa-settings__slots">
        {settings.quickLinks.map((routeId, index) => (
          <label key={index} className="atlas-pwa-settings__slot">
            <span>Quick Link {index + 1}</span>

            <select
              value={routeId}
              disabled={!settings.enabled}
              onChange={(event) => changeSlot(index, event.target.value)}
            >
              {PWA_NAV_ROUTES.map((route) => (
                <option value={route.id} key={route.id}>
                  {route.icon} {route.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="atlas-pwa-settings__preview">
        <span className="atlas-pwa-settings__preview-label">Preview</span>

        <div className="atlas-pwa-settings__preview-dock">
          {settings.enabled ? (
            <>
              {previewRoutes.map((route) =>
                route ? (
                  <div
                    key={route.id}
                    className="atlas-pwa-settings__preview-item"
                  >
                    <strong>{route.icon}</strong>
                    <span>{route.label}</span>
                  </div>
                ) : null,
              )}

              <div className="atlas-pwa-settings__preview-item">
                <strong>•••</strong>
                <span>More</span>
              </div>
            </>
          ) : (
            <span className="atlas-pwa-settings__disabled">
              Bottom navigation is disabled.
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        className="atlas-pwa-settings__reset"
        onClick={reset}
      >
        Reset to default
      </button>
    </section>
  );
}
