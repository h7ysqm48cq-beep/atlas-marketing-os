"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const mainItems = [
  ["Dashboard", "⌂", "/"],
  ["Campaigns", "◉", "/campaigns"],
  ["Content History", "▤", "/content-history"],
  ["Automation", "↻", "/automation"],
  ["Calendar", "□", "/calendar"],
  ["AI Studio", "✦", "/ai-studio"],
  ["Brand Copilot", "◎", "/copilot"],
  ["Analytics", "⌁", "/ai-usage"],
];

const resourceItems = [
  ["Asset Library", "◇", "/assets"],
  ["Prompt Library", "≡", "/prompts"],
  ["Brand Brain", "◆", "/brand-brain"],
  ["Knowledge", "◈", "/knowledge"],
  ["Settings", "⚙", "/settings"],
];

type WorkspaceOption = {
  id: string;
  name: string;
  _count?: {
    brands?: number;
    socialChannels?: number;
  };
};

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaces() {
      try {
        setWorkspaceLoading(true);

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/automation/workspaces`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error(
            `Workspace request failed with HTTP ${response.status}`,
          );
        }

        const data = (await response.json()) as WorkspaceOption[];

        if (cancelled) {
          return;
        }

        setWorkspaces(data);

        const stored = window.localStorage.getItem("atlas:workspace-id");

        const selected =
          data.find((workspace) => workspace.id === stored) ?? data[0] ?? null;

        if (selected) {
          setWorkspaceId(selected.id);
          window.localStorage.setItem("atlas:workspace-id", selected.id);
        }
      } catch (error) {
        console.error("Unable to load workspaces:", error);
      } finally {
        if (!cancelled) {
          setWorkspaceLoading(false);
        }
      }
    }

    void loadWorkspaces();

    return () => {
      cancelled = true;
    };
  }, []);

  function changeWorkspace(nextWorkspaceId: string) {
    const workspace = workspaces.find((item) => item.id === nextWorkspaceId);

    if (!workspace) {
      return;
    }

    setWorkspaceId(workspace.id);

    window.localStorage.setItem("atlas:workspace-id", workspace.id);

    window.dispatchEvent(
      new CustomEvent("atlas:workspace-changed", {
        detail: {
          workspaceId: workspace.id,
          workspace,
        },
      }),
    );

    closeMobileNavigation();
  }

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

  function renderItems(items: string[][]) {
    return items.map(([label, icon, href]) => {
      const active = isActive(href);

      return (
        <a
          className={`nav-item${active ? " active" : ""}`}
          href={href}
          key={label}
          aria-current={active ? "page" : undefined}
          onClick={closeMobileNavigation}
        >
          <span className="nav-icon">{icon}</span>
          <span>{label}</span>
        </a>
      );
    });
  }

  return (
    <>
      <button
        type="button"
        className={`mobile-nav-overlay${mobileOpen ? " visible" : ""}`}
        aria-label="Close navigation"
        onClick={closeMobileNavigation}
      />

      <aside
        className={`sidebar${mobileOpen ? " mobile-open" : ""}`}
        aria-label="Main navigation"
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
            aria-label="Close navigation"
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
          <div className="nav-section-label">Workspace</div>

          <nav className="nav-list">{renderItems(mainItems)}</nav>

          <div className="nav-section-label">Resources</div>

          <nav className="nav-list">{renderItems(resourceItems)}</nav>
        </div>

        <div className="sidebar-bottom">
          <div className="workspace-card">
            <div className="workspace-label">Current workspace</div>

            <select
              className="workspace-selector"
              value={workspaceId}
              disabled={workspaceLoading || workspaces.length === 0}
              onChange={(event) => changeWorkspace(event.target.value)}
              aria-label="Current workspace"
            >
              {workspaceLoading ? (
                <option value="">Loading...</option>
              ) : workspaces.length === 0 ? (
                <option value="">No workspace</option>
              ) : (
                workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))
              )}
            </select>

            <div className="workspace-meta">
              {workspaceId
                ? `${
                    workspaces.find((workspace) => workspace.id === workspaceId)
                      ?._count?.socialChannels ?? 0
                  } connected channels`
                : "Workspace unavailable"}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
