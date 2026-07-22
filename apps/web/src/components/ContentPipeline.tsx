const rows = [
  ["Malaysia lifestyle meme series", "Funny / Local", "Facebook", "Scheduled"],
  ["Football teaches us: resilience", "Sports / Motivation", "Instagram", "Review"],
  ["Classic HK drama memories", "Nostalgia", "Facebook", "Draft"],
];

export function ContentPipeline() {
  return (
    <article className="card panel-card">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Content pipeline</h2>
          <div className="panel-subtitle">Latest content in production</div>
        </div>
        <button className="text-button">View all content</button>
      </div>

      <div className="pipeline-list">
        {rows.map(([title, meta, platform, status]) => (
          <div className="pipeline-row" key={title}>
            <div>
              <div className="pipeline-title">{title}</div>
              <div className="pipeline-meta">{meta}</div>
            </div>
            <span className="platform-pill">{platform}</span>
            <span className={`status-pill ${status === "Review" ? "review" : ""}`}>
              {status}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}
