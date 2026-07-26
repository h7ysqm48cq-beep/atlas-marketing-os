import styles from "../CampaignDashboard.module.css";
import { DashboardMetrics } from "./campaign-dashboard.types";
import { DashboardProgress } from "./DashboardShared";

export function CampaignPipeline({
  metrics,
}: {
  metrics: DashboardMetrics;
}) {
  return (
    <article className={styles.panel}>
      <p className={styles.eyebrow}>Execution Pipeline</p>
      <h3>Campaign progress</h3>

      <DashboardProgress
        label="Planning"
        value={metrics.ideas}
        total={metrics.ideas}
      />

      <DashboardProgress
        label="Generation"
        value={metrics.generated}
        total={metrics.ideas}
      />

      <DashboardProgress
        label="Approval"
        value={metrics.approved}
        total={metrics.generated}
      />

      <DashboardProgress
        label="Publishing"
        value={metrics.published}
        total={metrics.approved}
      />
    </article>
  );
}
