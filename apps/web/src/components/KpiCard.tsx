type KpiCardProps = {
  label: string;
  value: string;
  change: string;
  icon: string;
};

export function KpiCard({ label, value, change, icon }: KpiCardProps) {
  return (
    <article className="card kpi-card">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon">{icon}</span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-change">{change}</div>
    </article>
  );
}
