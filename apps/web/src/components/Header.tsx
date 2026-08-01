"use client";
import { usePreferences } from "@/components/preferences";

export function Header() {
  const { t } = usePreferences();
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
        <button className="icon-button" aria-label="Notifications">
          ◌
        </button>

        <div className="user-chip">
          <div className="avatar">L</div>

          <div className="user-details">
            <div className="user-name">Loh</div>
            <div className="user-role">{t("administrator")}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
