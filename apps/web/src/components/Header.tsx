"use client";
import { useEffect, useState } from "react";
import { PreferencesControls, usePreferences } from "@/components/preferences";
import { UserMenu } from "@/components/UserMenu";

export function Header() {
  const { t } = usePreferences();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    setNotificationsEnabled(
      localStorage.getItem("atlas.notifications.enabled") === "true" &&
        (typeof Notification === "undefined" ||
          Notification.permission === "granted"),
    );
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

  function toggleMobileNavigation() {
    window.dispatchEvent(new CustomEvent("atlas:toggle-mobile-navigation"));
  }

  return (
    <header className="header">
      <button
        type="button"
        className="mobile-icon-button mobile-menu-button"
        aria-label={t("mainNavigation")}
        onClick={toggleMobileNavigation}
      >
        <span className="mobile-menu-line" />
        <span className="mobile-menu-line" />
        <span className="mobile-menu-line" />
      </button>

      <label className="search-box">
        <span>⌕</span>
        <input placeholder={t("searchPlaceholder")} />
        <span>⌘ K</span>
      </label>

      <div className="mobile-header-brand">
        <div className="mobile-header-mark">A</div>
        <span>Atlas</span>
      </div>

      <div className="header-actions">
        <button
          className="icon-button"
          aria-label={
            notificationsEnabled
              ? "Disable notifications"
              : "Enable notifications"
          }
          aria-pressed={notificationsEnabled}
          title={notificationsEnabled ? "通知已开启" : "开启发布通知"}
          onClick={() => void toggleNotifications()}
        >
          {notificationsEnabled ? "🔔" : "◌"}
        </button>

        <PreferencesControls />
        <UserMenu />
      </div>
    </header>
  );
}
