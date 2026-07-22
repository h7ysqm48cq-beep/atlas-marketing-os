const mainItems = [
  ["Dashboard", "⌂"],
  ["Content Center", "▤"],
  ["Campaigns", "◉"],
  ["Calendar", "□"],
  ["AI Factory", "✦"],
  ["Analytics", "⌁"],
];

const resourceItems = [
  ["Asset Library", "◇"],
  ["Prompt Library", "≡"],
  ["Brand Knowledge", "◆"],
  ["Settings", "⚙"],
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div>
          <div className="brand-title">Atlas</div>
          <div className="brand-subtitle">AI Marketing Suite</div>
        </div>
      </div>

      <div className="nav-section-label">Workspace</div>
      <nav className="nav-list">
        {mainItems.map(([label, icon], index) => (
          <a className={`nav-item ${index === 0 ? "active" : ""}`} href="#" key={label}>
            <span className="nav-icon">{icon}</span>
            <span>{label}</span>
          </a>
        ))}
      </nav>

      <div className="nav-section-label">Resources</div>
      <nav className="nav-list">
        {resourceItems.map(([label, icon]) => (
          <a className="nav-item" href="#" key={label}>
            <span className="nav-icon">{icon}</span>
            <span>{label}</span>
          </a>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="workspace-card">
          <div className="workspace-label">Current workspace</div>
          <div className="workspace-name">MGMBETMYR</div>
          <div className="workspace-meta">Enterprise plan</div>
        </div>
      </div>
    </aside>
  );
}
