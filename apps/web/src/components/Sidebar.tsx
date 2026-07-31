"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { usePreferences } from "@/components/preferences";
import type { TranslationKey } from "@/components/preferences/translations";

type NavigationItem = [TranslationKey, string, string];

const mainItems: NavigationItem[] = [
  ["dashboard", "⌂", "/"],
  ["campaigns", "◉", "/campaigns"],
  ["contentHistory", "▤", "/content-history"],
  ["automation", "↻", "/automation"],
  ["calendar", "□", "/calendar"],
  ["aiStudio", "✦", "/ai-studio"],
  ["brandCopilot", "◎", "/copilot"],
  ["analytics", "⌁", "/ai-usage"],
];

const resourceItems: NavigationItem[] = [
  ["assetLibrary", "◇", "/assets"],
  ["promptLibrary", "≡", "/prompts"],
  ["brandBrain", "◆", "/brand-brain"],
  ["knowledge", "◈", "/knowledge"],
  ["settings", "⚙", "/settings"],
];

export function Sidebar() {
  const pathname = usePathname();
  const { t } = usePreferences();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function toggleSidebar() {
      setMobileOpen((current) => !current);
    }

    function closeSidebar() {
      setMobileOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeSidebar();
      }
    }

    window.addEventListener("atlas:toggle-mobile-navigation", toggleSidebar);
    window.addEventListener("atlas:close-mobile-navigation", closeSidebar);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener(
        "atlas:toggle-mobile-navigation",
        toggleSidebar,
      );
      window.removeEventListener("atlas:close-mobile-navigation", closeSidebar);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("mobile-nav-open", mobileOpen);

    return () => {
      document.body.classList.remove("mobile-nav-open");
    };
  }, [mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function isActive(href: string) {
    if (href === "/") {
      return pathname === "/";
    }

    if (href === "#") {
      return false;
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function closeMobileNavigation() {
    setMobileOpen(false);
  }

  function renderItems(items: NavigationItem[]) {
    return items.map(([label, icon, href]) => {
      const active = isActive(href);

      return (
        <a
          className={`nav-item${active ? " active" : ""}`}
          href={href}
          key={href}
          aria-current={active ? "page" : undefined}
          onClick={closeMobileNavigation}
        >
          <span className="nav-icon">{icon}</span>
          <span>{t(label)}</span>
        </a>
      );
    });
  }

  return (
    <>
      <button
        type="button"
        className={`mobile-nav-overlay${mobileOpen ? " visible" : ""}`}
        aria-label={t("closeNavigation")}
        onClick={closeMobileNavigation}
      />

      <aside
        className={`sidebar${mobileOpen ? " mobile-open" : ""}`}
        aria-label={t("mainNavigation")}
      >
        <div className="sidebar-mobile-header">
          <div className="brand sidebar-mobile-brand">
            <div className="brand-mark">A</div>

            <div>
              <div className="brand-title">Atlas</div>
              <div className="brand-subtitle">AI Marketing Suite</div>
            </div>
          </div>

          <button
            type="button"
            className="sidebar-close-button"
            aria-label={t("closeNavigation")}
            onClick={closeMobileNavigation}
          >
            ×
          </button>
        </div>

        <div className="brand desktop-sidebar-brand">
          <div className="brand-mark">A</div>

          <div>
            <div className="brand-title">Atlas</div>
            <div className="brand-subtitle">AI Marketing Suite</div>
          </div>
        </div>

        <div className="sidebar-scroll-area">
          <div className="nav-section-label">{t("workspace")}</div>

          <nav className="nav-list">{renderItems(mainItems)}</nav>

          <div className="nav-section-label">{t("resources")}</div>

          <nav className="nav-list">{renderItems(resourceItems)}</nav>
        </div>

        <div className="sidebar-bottom">
          <div className="workspace-card">
            <div className="workspace-label">Current workspace</div>
            <div className="workspace-name">MGMBETMYR</div>
            <div className="workspace-meta">Enterprise plan</div>
          </div>
        </div>
      </aside>
    </>
  );
}
