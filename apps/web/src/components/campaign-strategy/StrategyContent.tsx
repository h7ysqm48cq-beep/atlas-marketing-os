import styles from "../CampaignStrategy.module.css";
import { CampaignStrategyResult } from "./campaign-strategy.types";
import { Detail, Metric, StrategyCard } from "./StrategyShared";

export function StrategyContent({
  result,
  copied,
  onCopy,
}: {
  result: CampaignStrategyResult;
  copied: boolean;
  onCopy: () => void;
}) {
  const strategy = result.strategy;

  return (
    <div className={styles.strategy}>
      <section className={styles.summaryCard}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Strategy Overview</p>
            <h3>{result.campaign.name}</h3>
          </div>

          <button type="button" onClick={onCopy}>
            {copied ? "Copied ✓" : "Copy strategy"}
          </button>
        </div>

        <p>{strategy.campaignSummary}</p>

        <div className={styles.memoryGrid}>
          <Metric
            label="Memory Sample"
            value={String(result.memoryUsed.learningSampleSize)}
          />
          <Metric
            label="Preferred Style"
            value={result.memoryUsed.preferredStyle || "—"}
          />
          <Metric
            label="Best Platform"
            value={result.memoryUsed.bestPlatform || "—"}
          />
          <Metric
            label="Best Time"
            value={result.memoryUsed.bestPostingTime || "—"}
          />
        </div>
      </section>

      <section className={styles.twoColumnGrid}>
        <StrategyCard title="Objective">
          <p>{strategy.objective}</p>
        </StrategyCard>

        <StrategyCard title="Core Message">
          <p>{strategy.coreMessage}</p>
        </StrategyCard>
      </section>

      <StrategyCard title="Audience Strategy">
        <div className={styles.audienceGrid}>
          <Detail
            label="Primary Audience"
            value={strategy.audienceStrategy.primaryAudience}
          />
          <Detail
            label="Audience Insight"
            value={strategy.audienceStrategy.audienceInsight}
          />
          <Detail
            label="Motivation"
            value={strategy.audienceStrategy.motivation}
          />
          <Detail
            label="Barrier"
            value={strategy.audienceStrategy.barrier}
          />
        </div>
      </StrategyCard>

      <StrategyCard title="Content Pillars">
        <div className={styles.pillarGrid}>
          {strategy.contentPillars.map((pillar) => (
            <article key={pillar.name}>
              <h4>{pillar.name}</h4>
              <p>{pillar.purpose}</p>

              <ul>
                {pillar.exampleTopics.map((topic) => (
                  <li key={topic}>{topic}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </StrategyCard>

      <StrategyCard title="Platform Strategy">
        <div className={styles.platformGrid}>
          {strategy.platformStrategy.map((platform) => (
            <article key={platform.platform}>
              <div>
                <h4>{platform.platform}</h4>
                <span>{platform.frequency}</span>
              </div>

              <p>{platform.role}</p>
              <small>{platform.contentFormat}</small>
              <strong>{platform.recommendation}</strong>
            </article>
          ))}
        </div>
      </StrategyCard>

      <section className={styles.twoColumnGrid}>
        <StrategyCard title="Content Mix">
          <div className={styles.mixList}>
            {strategy.contentMix.map((item) => (
              <article key={item.category}>
                <div>
                  <strong>{item.category}</strong>
                  <span>{item.percentage}%</span>
                </div>

                <div className={styles.mixTrack}>
                  <i style={{ width: `${item.percentage}%` }} />
                </div>

                <p>{item.purpose}</p>
              </article>
            ))}
          </div>
        </StrategyCard>

        <StrategyCard title="Posting Recommendations">
          <div className={styles.simpleList}>
            {strategy.postingRecommendations.map((item) => (
              <article key={item.platform}>
                <strong>{item.platform}</strong>
                <span>{item.recommendedTime}</span>
                <p>{item.rationale}</p>
              </article>
            ))}
          </div>
        </StrategyCard>
      </section>

      <section className={styles.twoColumnGrid}>
        <StrategyCard title="Success Metrics">
          <div className={styles.simpleList}>
            {strategy.successMetrics.map((item) => (
              <article key={item.metric}>
                <strong>{item.metric}</strong>
                <span>{item.targetDirection}</span>
                <p>{item.reason}</p>
              </article>
            ))}
          </div>
        </StrategyCard>

        <StrategyCard title="Risks & Mitigation">
          <div className={styles.simpleList}>
            {strategy.risks.map((item) => (
              <article key={item.risk}>
                <strong>{item.risk}</strong>
                <p>{item.mitigation}</p>
              </article>
            ))}
          </div>
        </StrategyCard>
      </section>

      <StrategyCard title="Next Actions">
        <ol className={styles.nextActions}>
          {strategy.nextActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ol>
      </StrategyCard>

      <footer className={styles.generatedMeta}>
        Generated{" "}
        {new Intl.DateTimeFormat("en-MY", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(result.generatedAt))}
      </footer>
    </div>
  );
}
