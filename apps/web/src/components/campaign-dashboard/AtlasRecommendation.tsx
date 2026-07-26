import styles from "../CampaignDashboard.module.css";

export function AtlasRecommendation({
  title,
  reason,
  priority,
}: {
  title: string;
  reason: string;
  priority: string;
}) {
  return (
    <article className={styles.panel}>
      <p className={styles.eyebrow}>Atlas Recommendation</p>
      <h3>{title}</h3>
      <p className={styles.recommendation}>{reason}</p>

      <div className={styles.recommendationMeta}>
        <span>Priority</span>
        <strong>{priority}</strong>
      </div>
    </article>
  );
}
