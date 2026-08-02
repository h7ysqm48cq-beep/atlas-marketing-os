import styles from "../CampaignDashboard.module.css";

export function DashboardMetric({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  href?: string;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      {href ? <i aria-hidden="true">→</i> : null}
    </>
  );

  return href ? (
    <a className={`${styles.metric} ${styles.metricLink}`} href={href}>
      {content}
    </a>
  ) : (
    <article className={styles.metric}>{content}</article>
  );
}

export function DashboardSignal({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className={styles.signal}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function DashboardProgress({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const safeTotal = Math.max(total, 1);
  const percentage = Math.min(
    100,
    Math.round((value / safeTotal) * 100),
  );

  return (
    <div className={styles.progressRow}>
      <div>
        <span>{label}</span>
        <strong>
          {value}/{total}
        </strong>
      </div>

      <div className={styles.progressTrack}>
        <i style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
