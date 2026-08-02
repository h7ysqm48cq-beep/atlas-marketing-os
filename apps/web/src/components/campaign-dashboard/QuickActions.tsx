import styles from "../CampaignDashboard.module.css";

export function QuickActions({
  campaignId,
  onOpenStrategy,
  onOpenIdeas,
  onOpenAssets,
}: {
  campaignId: string;
  onOpenStrategy: () => void;
  onOpenIdeas: () => void;
  onOpenAssets: () => void;
}) {
  return (
    <article className={styles.panel}>
      <p className={styles.eyebrow}>Quick Actions</p>
      <h3>Continue campaign work</h3>

      <div className={styles.quickActions}>
        <button type="button" onClick={onOpenIdeas}>
          Generate ideas
        </button>

        <button type="button" onClick={onOpenStrategy}>
          Open strategy
        </button>

        <a
          href={`/ai-studio?campaignId=${encodeURIComponent(campaignId)}`}
        >
          Open AI Studio
        </a>

        <button type="button" onClick={onOpenAssets}>
          Open campaign assets
        </button>

        <a
          href={`/content-history?campaignId=${encodeURIComponent(campaignId)}`}
        >
          View content history
        </a>
      </div>
    </article>
  );
}
