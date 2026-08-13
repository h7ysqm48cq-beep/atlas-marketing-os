"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_PWA_NAVIGATION,
  PWA_NAV_ICONS,
  PWA_NAV_ROUTES,
  readPwaNavigationSettings,
  savePwaNavigationSettings,
  type PwaNavigationSettings,
} from "@/components/pwaNavigationSettings";

export function PwaAppSettings() {
  const [settings, setSettings] = useState<PwaNavigationSettings>({
    ...DEFAULT_PWA_NAVIGATION,
    quickLinks: [...DEFAULT_PWA_NAVIGATION.quickLinks],
    customizations: {},
  });

  useEffect(() => {
    setSettings(readPwaNavigationSettings());
  }, []);

  const previewRoutes = useMemo(
    () =>
      settings.quickLinks
        .map((id) => PWA_NAV_ROUTES.find((route) => route.id === id))
        .filter((route): route is (typeof PWA_NAV_ROUTES)[number] =>
          Boolean(route),
        ),
    [settings.quickLinks],
  );

  function update(next: PwaNavigationSettings) {
    setSettings(next);
    savePwaNavigationSettings(next);
  }

  function changeSlot(index: number, routeId: string) {
    const nextLinks = [...settings.quickLinks];

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

  function moveSlot(index: number, direction: -1 | 1) {
    const target = index + direction;

    if (target < 0 || target >= settings.quickLinks.length) {
      return;
    }

    const nextLinks = [...settings.quickLinks];

    [nextLinks[index], nextLinks[target]] = [
      nextLinks[target],
      nextLinks[index],
    ];

    update({
      ...settings,
      quickLinks: nextLinks,
    });
  }

  function customizeRoute(
    routeId: string,
    field: "label" | "icon",
    value: string,
  ) {
    const previous = settings.customizations[routeId] || {};

    const nextCustomization = {
      ...previous,
      [field]: field === "label" ? value.slice(0, 12) : value,
    };

    update({
      ...settings,

      customizations: {
        ...settings.customizations,

        [routeId]: nextCustomization,
      },
    });
  }

  function reset() {
    update({
      enabled: DEFAULT_PWA_NAVIGATION.enabled,

      quickLinks: [...DEFAULT_PWA_NAVIGATION.quickLinks],

      customizations: {},
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
        {settings.quickLinks.map((routeId, index) => {
          const selectedRoute = PWA_NAV_ROUTES.find(
            (route) => route.id === routeId,
          );

          return (
            <div
              key={`${routeId}-${index}`}
              className="atlas-pwa-settings__slot"
            >
              <span>Quick Link {index + 1}</span>

              <div className="atlas-pwa-settings__slot-controls">
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

                <div className="atlas-pwa-settings__move">
                  <button
                    type="button"
                    disabled={!settings.enabled || index === 0}
                    aria-label={`Move Quick Link ${index + 1} left`}
                    title="Move left"
                    onClick={() => moveSlot(index, -1)}
                  >
                    ←
                  </button>

                  <button
                    type="button"
                    disabled={
                      !settings.enabled ||
                      index === settings.quickLinks.length - 1
                    }
                    aria-label={`Move Quick Link ${index + 1} right`}
                    title="Move right"
                    onClick={() => moveSlot(index, 1)}
                  >
                    →
                  </button>
                </div>
              </div>

              <div className="atlas-pwa-settings__customize">
                <input
                  type="text"
                  maxLength={12}
                  value={settings.customizations[routeId]?.label || ""}
                  placeholder={
                    selectedRoute
                      ? `Label: ${selectedRoute.label}`
                      : "Custom label"
                  }
                  disabled={!settings.enabled}
                  onChange={(event) =>
                    customizeRoute(routeId, "label", event.target.value)
                  }
                />

                <select
                  value={settings.customizations[routeId]?.icon || ""}
                  disabled={!settings.enabled}
                  onChange={(event) =>
                    customizeRoute(routeId, "icon", event.target.value)
                  }
                >
                  <option value="">Default icon</option>

                  {PWA_NAV_ICONS.map((icon) => (
                    <option key={icon} value={icon}>
                      {icon}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <div className="atlas-pwa-settings__preview">
        <span className="atlas-pwa-settings__preview-label">Preview</span>

        <div className="atlas-pwa-settings__preview-dock">
          {settings.enabled ? (
            <>
              {previewRoutes.map((route) => {
                const customization = settings.customizations[route.id];

                return (
                  <div
                    key={route.id}
                    className="atlas-pwa-settings__preview-item"
                  >
                    <strong>{customization?.icon || route.icon}</strong>

                    <span>{customization?.label || route.label}</span>
                  </div>
                );
              })}

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
