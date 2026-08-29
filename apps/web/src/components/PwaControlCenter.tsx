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
import {
  DEFAULT_NOTIFICATION_TYPES,
  readNotificationTypes,
  saveNotificationTypes,
  type NotificationTypes,
} from "@/components/notificationPreferences";

const STARTUP_SESSION_KEY = "atlas.pwa.startup.applied";

export function PwaControlCenter() {
  const [settings, setSettings] =
    useState<PwaControlSettings>(DEFAULT_PWA_CONTROL);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationTypes, setNotificationTypes] = useState<NotificationTypes>(
    DEFAULT_NOTIFICATION_TYPES,
  );

  const [message, setMessage] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate client-only PWA controls from localStorage after mount.
    setSettings(readPwaControlSettings());
    setNotificationsEnabled(
      localStorage.getItem("atlas.notifications.enabled") === "true" &&
        typeof Notification !== "undefined" &&
      Notification.permission === "granted",
    );
    setNotificationTypes(readNotificationTypes());
  }, []);

  async function toggleNotifications() {
    if (notificationsEnabled) {
      localStorage.setItem("atlas.notifications.enabled", "false");
      setNotificationsEnabled(false);
      window.dispatchEvent(new CustomEvent("atlas:notifications-changed"));
      return;
    }

    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    const enabled = permission === "granted";
    localStorage.setItem("atlas.notifications.enabled", String(enabled));
    setNotificationsEnabled(enabled);
    window.dispatchEvent(new CustomEvent("atlas:notifications-changed"));
  }

  function updateNotificationType(
    key: keyof NotificationTypes,
    checked: boolean,
  ) {
    const next = { ...notificationTypes, [key]: checked };
    setNotificationTypes(next);
    saveNotificationTypes(next);
  }

  function update(next: PwaControlSettings) {
    setSettings(next);
    savePwaControlSettings(next);
  }

  function broadcastReset() {
    window.dispatchEvent(new CustomEvent(PWA_NAV_CHANGE_EVENT));

    window.dispatchEvent(new CustomEvent(PWA_APPEARANCE_CHANGE_EVENT));

    window.dispatchEvent(new CustomEvent(PWA_STARTUP_CHANGE_EVENT));

    window.dispatchEvent(new CustomEvent(PWA_CONTROL_CHANGE_EVENT));

    window.dispatchEvent(new CustomEvent("atlas:notifications-changed"));
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

      window.localStorage.removeItem("atlas.notifications.types");

      window.sessionStorage.removeItem(STARTUP_SESSION_KEY);
    } catch {
      // Storage may be unavailable.
    }

    setSettings(DEFAULT_PWA_CONTROL);
    setNotificationTypes(DEFAULT_NOTIFICATION_TYPES);

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

      <div className="atlas-pwa-control__status">
        <div>
          <strong>通知类型</strong>
          <span>选择要接收的 Atlas 通知。</span>
        </div>
        <div className="atlas-pwa-control__notification-types">
          {([
            ["published", "发布成功"],
            ["failed", "发布失败（含自动重试）"],
            ["system", "系统异常与部署状态"],
          ] as const).map(([key, label]) => (
            <label key={key} className="atlas-pwa-control__toggle">
              <input
                type="checkbox"
                checked={notificationTypes[key]}
                onChange={(event) =>
                  updateNotificationType(key, event.target.checked)
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="atlas-pwa-control__status">
        <div>
          <strong>发布通知</strong>
          <span>发布成功、失败和自动重试都会通知。</span>
        </div>
        <label className="atlas-pwa-control__toggle">
          <input
            type="checkbox"
            checked={notificationsEnabled}
            onChange={() => void toggleNotifications()}
          />
          <span>{notificationsEnabled ? "已开启" : "未开启"}</span>
        </label>
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
