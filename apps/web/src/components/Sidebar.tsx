"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { usePreferences } from "@/components/preferences";
import type { TranslationKey } from "@/components/preferences/translations";

type NavigationItem = [TranslationKey, string, string];

const SIDEBAR_STATE_KEY = "atlas.sidebar.collapsed";

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
  const { t, language } = usePreferences();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [resourcesOpen, setResourcesOpen] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    setCollapsed(saved === "true");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("atlas-sidebar-collapsed", collapsed);
    window.localStorage.setItem(SIDEBAR_STATE_KEY, String(collapsed));

    return () => {
      document.documentElement.classList.remove("atlas-sidebar-collapsed");
    };
  }, [collapsed]);

  useEffect(() => {
    function toggleSidebar() {
      if (window.matchMedia("(max-width: 780px)").matches) {
        setMobileOpen((current) => !current);
        return;
      }

      setCollapsed((current) => !current);
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

    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function closeMobileNavigation() {
    setMobileOpen(false);
  }

  function toggleDesktopSidebar() {
    setCollapsed((current) => !current);
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
          aria-label={collapsed ? t(label) : undefined}
          title={collapsed ? t(label) : undefined}
          onClick={closeMobileNavigation}
        >
          <span className="nav-icon">{icon}</span>
          <span className="nav-item-label">{t(label)}</span>
        </a>
      );
    });
  }

  const imageEditorActive = isActive("/image-editor");
  const imageEditorLabel =
    language === "zh" ? "图片编辑与 Logo" : "Image Editor & Logo";

  return (
    <>
      <button
        type="button"
        className={`mobile-nav-overlay${mobileOpen ? " visible" : ""}`}
        aria-label={t("closeNavigation")}
        onClick={closeMobileNavigation}
      />

      <aside
        className={`sidebar${mobileOpen ? " mobile-open" : ""}${collapsed ? " desktop-collapsed" : ""}`}
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
            className="mobile-icon-button sidebar-close-button"
            aria-label={t("closeNavigation")}
            onClick={closeMobileNavigation}
          >
            <span className="mobile-close-line mobile-close-line-first" />
            <span className="mobile-close-line mobile-close-line-second" />
          </button>
        </div>

        <div className="desktop-sidebar-header">
          <div className="brand desktop-sidebar-brand">
            <div className="brand-mark">A</div>

            <div className="desktop-brand-copy">
              <div className="brand-title">Atlas</div>
              <div className="brand-subtitle">AI Marketing Suite</div>
            </div>
          </div>

          <button
            type="button"
            className="desktop-sidebar-toggle"
            onClick={toggleDesktopSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span />
            <span />
            <span />
          </button>
        </div>

        <div className="sidebar-scroll-area">
          <section className="sidebar-nav-section">
            <button
              type="button"
              className="nav-section-toggle"
              onClick={() => setWorkspaceOpen((current) => !current)}
              aria-expanded={workspaceOpen}
              title={collapsed ? t("workspace") : undefined}
            >
              <span className="nav-section-label">{t("workspace")}</span>
              <span className="nav-section-chevron">
                {workspaceOpen ? "⌃" : "⌄"}
              </span>
            </button>

            {workspaceOpen ? (
              <nav className="nav-list">{renderItems(mainItems)}</nav>
            ) : null}
          </section>

          <section className="sidebar-nav-section">
            <button
              type="button"
              className="nav-section-toggle"
              onClick={() => setResourcesOpen((current) => !current)}
              aria-expanded={resourcesOpen}
              title={collapsed ? t("resources") : undefined}
            >
              <span className="nav-section-label">{t("resources")}</span>
              <span className="nav-section-chevron">
                {resourcesOpen ? "⌃" : "⌄"}
              </span>
            </button>

            {resourcesOpen ? (
              <nav className="nav-list">
                <a
                  className={`nav-item${imageEditorActive ? " active" : ""}`}
                  href="/image-editor"
                  aria-current={imageEditorActive ? "page" : undefined}
                  aria-label={collapsed ? imageEditorLabel : undefined}
                  title={collapsed ? imageEditorLabel : undefined}
                  onClick={closeMobileNavigation}
                >
                  <span className="nav-icon">✧</span>
                  <span className="nav-item-label">{imageEditorLabel}</span>
                </a>

                {renderItems(resourceItems)}
              </nav>
            ) : null}
          </section>
        </div>

        <div className="sidebar-bottom">
          <div className="workspace-card">
            <div className="workspace-card-icon">M</div>
            <div className="workspace-card-copy">
              <div className="workspace-label">Current workspace</div>
              <div className="workspace-name">MGMBETMYR</div>
              <div className="workspace-meta">Enterprise plan</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
