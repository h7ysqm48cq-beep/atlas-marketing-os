const actions = [
  ["✦", "Generate viral post"],
  ["▶", "Create Reels script"],
  ["◈", "Build image prompt"],
  ["↗", "Draft Telegram post"],
];

export function QuickActions() {
  return (
    <article className="card panel-card">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Quick actions</h2>
          <div className="panel-subtitle">Start your next task</div>
        </div>
      </div>

      <div className="quick-actions-grid">
        {actions.map(([icon, title]) => (
          <button className="quick-action" key={title}>
            <div className="quick-action-icon">{icon}</div>
            <div className="quick-action-title">{title}</div>
          </button>
        ))}
      </div>
    </article>
  );
}
