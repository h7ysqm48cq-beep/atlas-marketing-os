const schedule = [
  ["10:00", "Facebook lifestyle post", "Facebook · Scheduled"],
  ["13:00", "Telegram daily roundup", "Telegram · Draft"],
  ["20:30", "Hong Kong drama nostalgia", "Facebook · Recommended"],
];

export function TodaySchedule() {
  return (
    <article className="card panel-card">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Today&apos;s schedule</h2>
          <div className="panel-subtitle">3 planned publications</div>
        </div>
        <button className="text-button">View calendar</button>
      </div>

      <div className="schedule-list">
        {schedule.map(([time, title, meta]) => (
          <div className="schedule-item" key={`${time}-${title}`}>
            <div className="schedule-time">{time}</div>
            <div className="schedule-content">
              <div className="schedule-title">{title}</div>
              <div className="schedule-meta">{meta}</div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
