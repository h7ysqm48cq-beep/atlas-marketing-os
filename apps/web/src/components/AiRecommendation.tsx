export function AiRecommendation() {
  return (
    <article className="card panel-card ai-card">
      <div className="ai-content">
        <span className="ai-badge">✦ Atlas AI recommendation</span>
        <h2 className="ai-topic">Publish a Hong Kong drama nostalgia post tonight.</h2>
        <p className="ai-description">
          Nostalgia content has produced the highest share rate this week. A character-led post
          with a direct memory question is predicted to outperform your current average.
        </p>

        <div className="ai-stats">
          <div className="ai-stat">
            <div className="ai-stat-value">9.6 / 10</div>
            <div className="ai-stat-label">Predicted score</div>
          </div>
          <div className="ai-stat">
            <div className="ai-stat-value">+32%</div>
            <div className="ai-stat-label">Expected engagement</div>
          </div>
          <div className="ai-stat">
            <div className="ai-stat-value">8:30 PM</div>
            <div className="ai-stat-label">Best posting time</div>
          </div>
        </div>

        <button className="secondary-button">Generate content →</button>
      </div>
    </article>
  );
}
