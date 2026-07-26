import styles from "../CampaignDashboard.module.css";
import { DashboardMemory } from "./campaign-dashboard.types";
import { DashboardSignal } from "./DashboardShared";

export function MemoryInsights({
  memory,
}: {
  memory: DashboardMemory | null;
}) {
  return (
    <article className={styles.panel}>
      <p className={styles.eyebrow}>Atlas Memory</p>
      <h3>Learned campaign signals</h3>

      <div className={styles.signalList}>
        <DashboardSignal
          label="Preferred style"
          value={memory?.preferredStyle || "Not learned yet"}
        />

        <DashboardSignal
          label="Best platform"
          value={memory?.bestPlatform || "Not learned yet"}
        />

        <DashboardSignal
          label="Best posting time"
          value={memory?.bestPostingTime || "Not learned yet"}
        />

        <DashboardSignal
          label="Learning samples"
          value={String(memory?.learningSampleSize || 0)}
        />

        <DashboardSignal
          label="Discussion score"
          value={String(memory?.averageScores.discussion || 0)}
        />

        <DashboardSignal
          label="Brand-fit score"
          value={String(memory?.averageScores.brandFit || 0)}
        />
      </div>
    </article>
  );
}
