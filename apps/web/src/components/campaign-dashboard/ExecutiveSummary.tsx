import styles from "../CampaignDashboard.module.css";
import { DashboardCampaign } from "./campaign-dashboard.types";
import { formatDashboardDate } from "./campaign-dashboard.utils";

export function ExecutiveSummary({
  campaign,
  health,
}: {
  campaign: DashboardCampaign;
  health: number;
}) {
  const healthLabel =
    health >= 80
      ? "Healthy"
      : health >= 55
        ? "Developing"
        : "Needs attention";

  return (
    <section className={styles.hero}>
      <div>
        <p className={styles.eyebrow}>Campaign Overview</p>
        <h2>{campaign.name}</h2>
        <p>
          {campaign.description ||
            "Monitor strategy, content execution and campaign progress."}
        </p>

        <div className={styles.heroDetails}>
          <div>
            <span>Objective</span>
            <strong>
              {campaign.objective || "Not configured"}
            </strong>
          </div>

          <div>
            <span>Duration</span>
            <strong>
              {formatDashboardDate(campaign.startDate)} —{" "}
              {formatDashboardDate(campaign.endDate)}
            </strong>
          </div>

          <div>
            <span>Status</span>
            <strong>{campaign.status}</strong>
          </div>
        </div>
      </div>

      <div className={styles.health}>
        <span>Campaign health</span>
        <strong>{health}%</strong>
        <small>{healthLabel}</small>
      </div>
    </section>
  );
}
