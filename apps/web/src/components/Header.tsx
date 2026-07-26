'use client';

export function Header() {
  function toggleMobileNavigation() {
    window.dispatchEvent(
      new CustomEvent('atlas:toggle-mobile-navigation'),
    );
  }

  return (
    <header className="header">
      <button
        type="button"
        className="mobile-menu-button"
        aria-label="Open navigation"
        onClick={toggleMobileNavigation}
      >
        <span />
        <span />
        <span />
      </button>

      <label className="search-box">
        <span>⌕</span>
        <input placeholder="Search content, campaigns or prompts..." />
        <span>⌘ K</span>
      </label>

      <div className="mobile-header-brand">
        <div className="mobile-header-mark">A</div>
        <span>Atlas</span>
      </div>

      <div className="header-actions">
        <button
          className="icon-button"
          aria-label="Notifications"
        >
          ◌
        </button>

        <div className="user-chip">
          <div className="avatar">L</div>

          <div className="user-details">
            <div className="user-name">Loh</div>
            <div className="user-role">Administrator</div>
          </div>
        </div>
      </div>
    </header>
  );
}
