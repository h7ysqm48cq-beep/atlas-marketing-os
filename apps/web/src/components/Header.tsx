export function Header() {
  return (
    <header className="header">
      <label className="search-box">
        <span>⌕</span>
        <input placeholder="Search content, campaigns or prompts..." />
        <span>⌘ K</span>
      </label>

      <div className="header-actions">
        <button className="icon-button" aria-label="Notifications">◌</button>
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
