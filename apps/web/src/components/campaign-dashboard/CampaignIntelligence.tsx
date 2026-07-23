import styles from "../CampaignDashboard.module.css";
import {
  DashboardMemory,
  DashboardMetrics,
} from "./campaign-dashboard.types";

type ScoreKey =
  | "viral"
  | "discussion"
  | "shareability"
  | "brandFit";

const SCORE_LABELS: Record<ScoreKey, string> = {
  viral: "Viral potential",
  discussion: "Discussion",
  shareability: "Shareability",
  brandFit: "Brand fit",
};

export function CampaignIntelligence({
  metrics,
  memory,
}: {
  metrics: DashboardMetrics;
  memory: DashboardMemory | null;
}) {
  const strongestSignal = getStrongestSignal(memory);
  const recommendations = buildRecommendations(metrics, memory);

  return (
    <section className={styles.intelligencePanel}>
      <div className={styles.intelligenceHeading}>
        <div>
          <p className={styles.eyebrow}>Atlas Intelligence</p>
          <h3>Campaign decision signals</h3>
          <p>
            Recommendations are based on confirmed campaign activity and
            learned Atlas Memory.
          </p>
        </div>

        <div className={styles.intelligenceConfidence}>
          <span>Memory confidence</span>
          <strong>{memory?.confidence || 0}%</strong>
          <small>
            {getConfidenceLabel(memory?.confidence || 0)}
          </small>
        </div>
      </div>

      <div className={styles.intelligenceGrid}>
        <article className={styles.intelligenceMetric}>
          <span>Strongest signal</span>
          <strong>{strongestSignal.label}</strong>
          <b>{strongestSignal.value}</b>
          <small>Highest current average score</small>
        </article>

        <article className={styles.intelligenceMetric}>
          <span>Preferred direction</span>
          <strong>{memory?.preferredStyle || "Not learned"}</strong>
          <b>{memory?.bestPlatform || "No platform"}</b>
          <small>Style and platform learned from history</small>
        </article>

        <article className={styles.intelligenceMetric}>
          <span>Execution gap</span>
          <strong>{getExecutionGap(metrics)}</strong>
          <b>{metrics.health}% health</b>
          <small>Largest incomplete workflow stage</small>
        </article>

        <article className={styles.intelligenceMetric}>
          <span>Best testing window</span>
          <strong>{memory?.bestPostingTime || "Not learned"}</strong>
          <b>{memory?.learningSampleSize || 0} samples</b>
          <small>Validate using actual publishing results</small>
        </article>
      </div>

      <div className={styles.intelligenceRecommendations}>
        <div className={styles.intelligenceRecommendationsHeader}>
          <h4>Recommended actions</h4>
          <span>{recommendations.length} signals</span>
        </div>

        <div className={styles.intelligenceRecommendationGrid}>
          {recommendations.map((recommendation, index) => (
            <article key={`${recommendation}-${index}`}>
              <span>{index + 1}</span>
              <p>{recommendation}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function getStrongestSignal(memory: DashboardMemory | null) {
  if (!memory) {
    return {
      label: "Not learned",
      value: "0",
    };
  }

  const entries = Object.entries(memory.averageScores) as Array<
    [ScoreKey, number]
  >;

  const strongest = entries.reduce(
    (current, item) =>
      item[1] > current[1] ? item : current,
    entries[0],
  );

  return {
    label: SCORE_LABELS[strongest[0]],
    value: String(strongest[1]),
  };
}

function getExecutionGap(metrics: DashboardMetrics) {
  if (metrics.ideas === 0) return "Planning";
  if (metrics.generated < metrics.ideas) return "Generation";
  if (metrics.approved < metrics.generated) return "Approval";
  if (metrics.published < metrics.approved) return "Publishing";
  return "Performance review";
}

function getConfidenceLabel(confidence: number) {
  if (confidence >= 75) return "Strong";
  if (confidence >= 40) return "Developing";
  return "Still learning";
}

function buildRecommendations(
  metrics: DashboardMetrics,
  memory: DashboardMemory | null,
) {
  const recommendations: string[] = [];

  if (!memory || memory.confidence < 40) {
    recommendations.push(
      "Approve and publish more strong content to improve Atlas Memory confidence.",
    );
  }

  if (metrics.generated < metrics.ideas) {
    recommendations.push(
      `Convert ${metrics.ideas - metrics.generated} remaining planned ideas into content workspaces.`,
    );
  }

  if (metrics.approved < metrics.generated) {
    recommendations.push(
      `Review ${metrics.generated - metrics.approved} generated items that have not completed approval.`,
    );
  }

  if (metrics.published < metrics.approved) {
    recommendations.push(
      `Move ${metrics.approved - metrics.published} approved items into the publishing workflow.`,
    );
  }

  if (memory?.bestPlatform) {
    recommendations.push(
      `Prioritise ${memory.bestPlatform} for the first execution test while maintaining cross-platform consistency.`,
    );
  }

  if (memory?.preferredStyle) {
    recommendations.push(
      `Use ${memory.preferredStyle} as the primary creative direction, then compare it against one alternative style.`,
    );
  }

  if (memory?.bestPostingTime) {
    recommendations.push(
      `Test ${memory.bestPostingTime} as the initial publishing window and validate it using real performance data.`,
    );
  }

  return recommendations.slice(0, 6);
}
