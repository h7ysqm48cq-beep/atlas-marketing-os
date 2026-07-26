'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const mainItems = [
  ['Dashboard', '⌂', '/'],
  ['Campaigns', '◉', '/campaigns'],
  ['Content History', '▤', '/content-history'],
  ['Automation', '↻', '/automation'],
  ['Calendar', '□', '/calendar'],
  ['AI Studio', '✦', '/ai-studio'],
  ['Brand Copilot', '◎', '/copilot'],
  ['Analytics', '⌁', '/ai-usage'],
];

const resourceItems = [
  ['Asset Library', '◇', '/assets'],
  ['Prompt Library', '≡', '/prompts'],
  ['Brand Brain', '◆', '/brand-brain'],
  ['Knowledge', '◈', '/knowledge'],
  ['Settings', '⚙', '/settings'],
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function toggleSidebar() {
      setMobileOpen((current) => !current);
    }

    function closeSidebar() {
      setMobileOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeSidebar();
      }
    }

    window.addEventListener(
      'atlas:toggle-mobile-navigation',
      toggleSidebar,
    );
    window.addEventListener(
      'atlas:close-mobile-navigation',
      closeSidebar,
    );
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener(
        'atlas:toggle-mobile-navigation',
        toggleSidebar,
      );
      window.removeEventListener(
        'atlas:close-mobile-navigation',
        closeSidebar,
      );
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle(
      'mobile-nav-open',
      mobileOpen,
    );

    return () => {
      document.body.classList.remove('mobile-nav-open');
    };
  }, [mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function isActive(href: string) {
    if (href === '/') {
      return pathname === '/';
    }

    if (href === '#') {
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
          className={`nav-item${active ? ' active' : ''}`}
          href={href}
          key={label}
          aria-current={active ? 'page' : undefined}
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
        className={`mobile-nav-overlay${
          mobileOpen ? ' visible' : ''
        }`}
        aria-label="Close navigation"
        onClick={closeMobileNavigation}
      />

      <aside
        className={`sidebar${
          mobileOpen ? ' mobile-open' : ''
        }`}
        aria-label="Main navigation"
      >
        <div className="sidebar-mobile-header">
          <div className="brand sidebar-mobile-brand">
            <div className="brand-mark">A</div>

            <div>
              <div className="brand-title">Atlas</div>
              <div className="brand-subtitle">
                AI Marketing Suite
              </div>
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
            <div className="brand-subtitle">
              AI Marketing Suite
            </div>
          </div>
        </div>

        <div className="sidebar-scroll-area">
          <div className="nav-section-label">Workspace</div>

          <nav className="nav-list">
            {renderItems(mainItems)}
          </nav>

          <div className="nav-section-label">Resources</div>

          <nav className="nav-list">
            {renderItems(resourceItems)}
          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="workspace-card">
            <div className="workspace-label">
              Current workspace
            </div>
            <div className="workspace-name">MGMBETMYR</div>
            <div className="workspace-meta">
              Enterprise plan
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
